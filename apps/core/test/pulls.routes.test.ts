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
import { diffStatuses } from '../src/git/gh';
import { gitBranchCompare } from '../src/git/git';
import { createRunRegistry } from '../src/runs/registry';
import { writeSystemMap } from '../src/store/scenes';

const DIFF = [
  'diff --git a/apps/core/src/app.ts b/apps/core/src/app.ts', 'index 1..2 100644', '--- a/apps/core/src/app.ts', '+++ b/apps/core/src/app.ts', '@@ -1 +1 @@', '-a', '+b',
  'diff --git a/apps/core/src/store/fresh.ts b/apps/core/src/store/fresh.ts', 'new file mode 100644', '--- /dev/null', '+++ b/apps/core/src/store/fresh.ts', '@@ -0,0 +1 @@', '+x',
  'diff --git a/old.md b/old.md', 'deleted file mode 100644', '--- a/old.md', '+++ /dev/null',
  'diff --git a/a.ts b/b.ts', 'similarity index 90%', 'rename from a.ts', 'rename to b.ts',
].join('\n');
const PULL = { number: 7, title: 'Store rewrite', author: { login: 'ana' }, headRefName: 'feature/store', baseRefName: 'main', isDraft: false, updatedAt: '2026-10-13T10:00:00Z', url: 'https://github.com/acme/x/pull/7', additions: 3, deletions: 2, changedFiles: 4 };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...args], { cwd }).toString();

let home: string;
let repoPath: string;
let bin: string;
let app: FastifyInstance;
let repoId: string;

const fakeGh = async (mode: 'ok' | 'missing' | 'logged_out') => {
  const dir = await mkdtemp(join(tmpdir(), 'rdi-gh-'));
  const script = join(dir, 'gh');
  const body = mode === 'logged_out' ? 'echo "To get started with GitHub CLI, please run: gh auth login" >&2; exit 4' : `
case "$*" in
  "pr list"*) cat <<'JSON'
[${JSON.stringify(PULL)}]
JSON
  ;;
  "pr view 7"*) cat <<'JSON'
${JSON.stringify({ ...PULL, body: 'Rewrites the **store**.', files: [{ path: 'apps/core/src/app.ts', additions: 1, deletions: 1 }, { path: 'apps/core/src/store/fresh.ts', additions: 1, deletions: 0 }, { path: 'old.md', additions: 0, deletions: 1 }, { path: 'b.ts', additions: 1, deletions: 0 }] })}
JSON
  ;;
  "pr diff 7"*) cat <<'DIFF'
${DIFF}
DIFF
  ;;
  *) echo "no pull requests found" >&2; exit 1;;
esac`;
  await writeFile(script, `#!/bin/sh\n${body}\n`);
  await chmod(script, 0o755);
  return mode === 'missing' ? join(dir, 'nope') : script;
};

const boot = async (ghBin: string) => {
  app = buildApp({ config: loadConfig({ RDI_HOME: home, RDI_FAKE_AGENT: 'true', RDI_GH_BIN: ghBin }), queryFn: createFakeQuery(), events: new EventEmitter(), runs: createRunRegistry() });
  await app.ready();
  repoId = (await app.inject({ method: 'POST', url: '/api/repos', payload: { path: repoPath } })).json().id;
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rdi-home-'));
  repoPath = await mkdtemp(join(tmpdir(), 'rdi-repo-'));
  await mkdir(join(repoPath, 'apps/core/src/store'), { recursive: true });
  await writeFile(join(repoPath, 'apps/core/src/app.ts'), 'a\n');
  await writeFile(join(repoPath, 'apps/core/src/store/json.ts'), 'j\n');
  git(repoPath, 'init', '-q', '-b', 'main');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-qm', 'init');
  git(repoPath, 'remote', 'add', 'origin', 'https://github.com/acme/x.git');
  bin = await fakeGh('ok');
  await boot(bin);
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
  await rm(repoPath, { recursive: true, force: true });
});

describe('diffStatuses', () => {
  it('reads added, removed, renamed and modified files from diff headers', () => {
    expect(Object.fromEntries(diffStatuses(DIFF))).toEqual({ 'apps/core/src/app.ts': 'modified', 'apps/core/src/store/fresh.ts': 'added', 'old.md': 'removed', 'a.ts': 'removed', 'b.ts': 'added' });
  });
});

describe('pull requests', () => {
  it('lists open pull requests through gh and reads one with file statuses', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls` })).json();
    expect(list).toMatchObject({ available: true, branch: null });
    expect(list.pulls).toEqual([expect.objectContaining({ number: 7, title: 'Store rewrite', author: 'ana', headRef: 'feature/store', draft: false })]);
    const detail = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls/7` })).json();
    expect(detail.pull.body).toBe('Rewrites the **store**.');
    expect(detail.files.map((f: { path: string; change: string }) => [f.path, f.change])).toEqual([['apps/core/src/app.ts', 'modified'], ['apps/core/src/store/fresh.ts', 'added'], ['old.md', 'removed'], ['b.ts', 'added']]);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls/99` })).statusCode).toBe(502);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls/x` })).statusCode).toBe(404);
  });

  it('overlays a pull request and the current branch on the map and explains them', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls/7/impact` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/branch/impact` })).statusCode).toBe(404);
    git(repoPath, 'checkout', '-qb', 'feature/x');
    await writeFile(join(repoPath, 'apps/core/src/store/json.ts'), 'changed\n');
    await writeFile(join(repoPath, 'apps/core/src/store/extra.ts'), 'n\n');
    git(repoPath, 'add', '.');
    git(repoPath, 'commit', '-qm', 'work');
    expect(await gitBranchCompare(repoPath)).toEqual({ branch: 'feature/x', base: 'main', ahead: 1, touched: [{ path: 'apps/core/src/store/extra.ts', change: 'added' }, { path: 'apps/core/src/store/json.ts', change: 'modified' }] });
    await writeSystemMap(join(repoPath, '.rdi'), git(repoPath, 'rev-parse', 'HEAD').trim(), fakeScene('en', 'Map', 'system-map') as never);
    const pr = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls/7/impact` })).json();
    expect(pr.id).toBe('impact-pr-7');
    expect(pr.nodes.find((n: { id: string }) => n.id === 'api').change).toBe('modified');
    expect(pr.nodes.find((n: { id: string }) => n.id === 'store').change).toBe('modified');
    const branch = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/branch/impact` })).json();
    expect(branch).toMatchObject({ id: 'impact-branch', title: 'feature/x → main' });
    expect(branch.nodes.find((n: { id: string }) => n.id === 'store').change).toBe('modified');
    expect(branch.nodes.find((n: { id: string }) => n.id === 'api').change).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls` })).json().branch).toMatchObject({ branch: 'feature/x', base: 'main', ahead: 1 });
    const explained = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/impact/explain`, payload: { pull: 7 } });
    expect(explained.statusCode).toBe(201);
    expect(explained.json().scene.id).toBe('impact-pr-7-explained');
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/impact/explain`, payload: { pull: 'branch' } })).json().scene.id).toBe('impact-branch-explained');
  });

  it('reports why pull requests are unavailable instead of failing', async () => {
    await app.close();
    await boot(await fakeGh('logged_out'));
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls` })).json()).toMatchObject({ available: false, reason: 'gh_not_logged_in', pulls: [] });
    await app.close();
    await boot(await fakeGh('missing'));
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls` })).json()).toMatchObject({ available: false, reason: 'gh_missing' });
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls/7` })).statusCode).toBe(409);
    git(repoPath, 'remote', 'remove', 'origin');
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/pulls` })).json()).toMatchObject({ available: false, reason: 'no_remote' });
  });
});
