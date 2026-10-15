import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeQuery, fakeScene } from '../src/agent/fakeQuery';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createRunRegistry } from '../src/runs/registry';
import { matchPulls } from '../src/routes/reviews';
import { writeSystemMap } from '../src/store/scenes';
import { parseSse } from './sse';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...args], { cwd }).toString();
const PULL = { number: 7, title: 'Store rewrite', author: { login: 'ana' }, headRefName: 'feature/store', baseRefName: 'main', isDraft: false, updatedAt: '2026-10-13T10:00:00Z', url: 'https://github.com/acme/x/pull/7', additions: 3, deletions: 2, changedFiles: 1, reviewDecision: '', latestReviews: [] };
const OTHER = { ...PULL, number: 12, title: 'Unrelated', headRefName: 'chore/deps' };
const DIFF = ['diff --git a/src/index.ts b/src/index.ts', '--- a/src/index.ts', '+++ b/src/index.ts', '@@ -1,1 +1,2 @@', ' export const x = 1;', '+export const y = 2;'].join('\n');

/** One gh for both repositories: every repo has PR #7 on feature/store, so the two match; #12 lives on its own branch. */
const fakeGh = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rdi-gh-'));
  const script = join(dir, 'gh');
  await writeFile(script, `#!/bin/sh
case "$*" in
  "pr list"*) cat <<'JSON'
[${JSON.stringify(PULL)},${JSON.stringify(OTHER)}]
JSON
  ;;
  "pr view 7"*) cat <<'JSON'
${JSON.stringify({ ...PULL, body: 'Shared change.', files: [{ path: 'src/index.ts', additions: 1, deletions: 0 }] })}
JSON
  ;;
  "pr diff 7"*) cat <<'DIFF'
${DIFF}
DIFF
  ;;
  "api user --jq .login") echo me;;
  *) echo "unexpected: $*" >&2; exit 1;;
esac
`);
  await chmod(script, 0o755);
  return script;
};

const makeRepo = async (name: string) => {
  const base = await mkdtemp(join(tmpdir(), 'rdi-'));
  const path = join(base, name);
  await mkdir(join(path, 'src'), { recursive: true });
  await writeFile(join(path, 'src', 'index.ts'), 'export const x = 1;\n');
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'init');
  git(path, 'remote', 'add', 'origin', `https://github.com/acme/${name}.git`);
  await writeSystemMap(join(path, '.rdi'), git(path, 'rev-parse', 'HEAD').trim(), { ...fakeScene('en', `${name} map`, 'system-map'), nodes: [{ id: 'index', label: 'Index', role: 'logic', kind: 'module', summary: 's', code: { repo: name, path: 'src/index.ts', startLine: 1, endLine: 2, language: 'ts' } }], edges: [], steps: [], risks: [] } as never);
  return path;
};

let home: string;
let app: FastifyInstance;
let apiId: string;
let webId: string;
const prompts: string[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rdi-home-'));
  const fake = createFakeQuery();
  app = buildApp({ config: loadConfig({ RDI_HOME: home, RDI_FAKE_AGENT: 'true', RDI_GH_BIN: await fakeGh() }), queryFn: (params, local) => { prompts.push(params.prompt); return fake(params, local); }, events: new EventEmitter(), runs: createRunRegistry() });
  await app.ready();
  apiId = (await app.inject({ method: 'POST', url: '/api/repos', payload: { path: await makeRepo('shop-api') } })).json().id;
  webId = (await app.inject({ method: 'POST', url: '/api/repos', payload: { path: await makeRepo('shop-web') } })).json().id;
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

describe('matchPulls', () => {
  it('groups pull requests that share a branch across repositories', () => {
    const summary = (number: number, headRef: string) => ({ number, title: `pr ${number}`, headRef } as never);
    expect(matchPulls([{ repoId: 'a', pulls: [summary(1, 'feat/x'), summary(2, 'solo')] }, { repoId: 'b', pulls: [summary(9, 'feat/x')] }])).toEqual([{ headRef: 'feat/x', pulls: [{ repoId: 'a', number: 1, title: 'pr 1' }, { repoId: 'b', number: 9, title: 'pr 9' }] }]);
  });
});

describe('reviews', () => {
  it('suggests the pull requests that match across the chosen repositories', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/reviews/suggest?repoIds=${apiId},${webId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().repos.map((r: { name: string; pulls: unknown[] }) => [r.name, r.pulls.length])).toEqual([['shop-api', 2], ['shop-web', 2]]);
    expect(res.json().matches).toEqual([
      { headRef: 'feature/store', pulls: [{ repoId: apiId, number: 7, title: 'Store rewrite' }, { repoId: webId, number: 7, title: 'Store rewrite' }] },
      { headRef: 'chore/deps', pulls: [{ repoId: apiId, number: 12, title: 'Unrelated' }, { repoId: webId, number: 12, title: 'Unrelated' }] },
    ]);
  });

  it('creates a review, overlays every pull request on the combined map and explains them as one system', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/reviews', payload: { selections: [{ repoId: apiId, pull: 7 }, { repoId: webId, pull: 7 }] } });
    expect(created.statusCode).toBe(201);
    const review = created.json();
    expect(review.title).toBe('shop-api #7 + shop-web #7');
    expect(review.parts).toEqual([
      { repoId: apiId, name: 'shop-api', pull: 7, available: true, url: 'https://github.com/acme/shop-api/pull/7' },
      { repoId: webId, name: 'shop-web', pull: 7, available: true, url: 'https://github.com/acme/shop-web/pull/7' },
    ]);
    expect(review.explainedAt).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/reviews' })).json()).toHaveLength(1);

    const impact = await app.inject({ method: 'GET', url: `/api/reviews/${review.id}/impact` });
    expect(impact.statusCode).toBe(200);
    expect(impact.json().missing).toEqual([]);
    expect(impact.json().scene.nodes.map((n: { id: string; change?: string }) => [n.id, n.change])).toEqual([['shop-api:index', 'modified'], ['shop-web:index', 'modified']]);

    prompts.length = 0;
    const explained = parseSse((await app.inject({ method: 'POST', url: `/api/reviews/${review.id}/impact/explain`, payload: {} })).body);
    expect(explained.at(-1)!.event).toBe('done');
    expect(explained.some((e) => e.event === 'scene')).toBe(true);
    expect(prompts[0]).toContain('spans 2 repositories');
    expect(prompts[0]).toContain('Repository "shop-api"');
    expect(prompts[0]).toContain('Repository "shop-web"');
    expect(prompts[0]).toContain('contracts between repositories');
    const cached = await app.inject({ method: 'GET', url: `/api/reviews/${review.id}/explanation` });
    expect(cached.statusCode).toBe(200);
    expect(cached.json().scene.id).toBe(`review-impact-${review.id}-explained`);
    expect((await app.inject({ method: 'GET', url: `/api/reviews/${review.id}` })).json().explainedAt).not.toBeNull();

    const code = await app.inject({ method: 'GET', url: `/api/reviews/${review.id}/code?repo=shop-web&path=src/index.ts` });
    expect(code.json()).toMatchObject({ repo: 'shop-web', path: 'src/index.ts' });
    expect((await app.inject({ method: 'DELETE', url: `/api/reviews/${review.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/reviews/${review.id}` })).statusCode).toBe(404);
  });

  it('rejects unknown repositories', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/reviews', payload: { selections: [{ repoId: 'nope', pull: 1 }] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/reviews/suggest?repoIds=nope' })).statusCode).toBe(400);
  });
});
