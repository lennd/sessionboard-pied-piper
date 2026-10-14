import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
import { parseSse } from './sse';
import { writeSystemMap } from '../src/store/scenes';

const DIFF = [
  'diff --git a/apps/core/src/app.ts b/apps/core/src/app.ts', 'index 1..2 100644', '--- a/apps/core/src/app.ts', '+++ b/apps/core/src/app.ts', '@@ -1 +1 @@', '-a', '+b',
  'diff --git a/apps/core/src/store/fresh.ts b/apps/core/src/store/fresh.ts', 'new file mode 100644', '--- /dev/null', '+++ b/apps/core/src/store/fresh.ts', '@@ -0,0 +1 @@', '+x',
  'diff --git a/old.md b/old.md', 'deleted file mode 100644', '--- a/old.md', '+++ /dev/null',
  'diff --git a/a.ts b/b.ts', 'similarity index 90%', 'rename from a.ts', 'rename to b.ts',
].join('\n');
const PULL = { number: 7, title: 'Store rewrite', author: { login: 'ana' }, headRefName: 'feature/store', baseRefName: 'main', isDraft: false, updatedAt: '2026-10-13T10:00:00Z', url: 'https://github.com/acme/x/pull/7', additions: 3, deletions: 2, changedFiles: 4, reviewDecision: '', latestReviews: [{ author: { login: 'bob' }, state: 'APPROVED' }] };
const PULL8 = { ...PULL, number: 8, title: 'Mine approved', latestReviews: [{ author: { login: 'me' }, state: 'APPROVED' }] };
const PULL9 = { ...PULL, number: 9, title: 'Needs work', reviewDecision: 'CHANGES_REQUESTED', latestReviews: [{ author: { login: 'bob' }, state: 'CHANGES_REQUESTED' }] };
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
  "pr list"*) echo "$@" > "$(dirname "$0")/list-args.txt"; cat <<'JSON'
[${JSON.stringify(PULL)},${JSON.stringify(PULL8)},${JSON.stringify(PULL9)}]
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
  "api --method POST repos/{owner}/{repo}/pulls/7/reviews --input -") cat > "$(dirname "$0")/review.json"; echo '{"id": 55, "html_url": "https://github.com/acme/x/pull/7#pullrequestreview-55"}';;
  "pr review 7 --approve --body"*) echo "$@" > "$(dirname "$0")/approve.txt"; echo "Approved pull request #7";;
  "pr review 7 --request-changes --body"*) echo "You can not request changes on your own pull request" >&2; exit 1;;
  "api user --jq .login") echo me;;
  "repo clone acme/x "*) mkdir -p "$4" && git -C "$4" init -q && touch "$4/README.md" && git -C "$4" -c user.email=a@b.c -c user.name=t add . && git -C "$4" -c user.email=a@b.c -c user.name=t commit -qm init;;
  "api repos/{owner}/{repo}/pulls/7/reviews") echo '[{"id": 9, "html_url": "https://github.com/acme/x/pull/7#pullrequestreview-9", "state": "APPROVED"}]';;
  "gist create --public --desc"*) ls "$6" "$7" "$8" 2>/dev/null | sed 's#.*/##' > "$(dirname "$0")/gist-files.txt"; echo "https://gist.github.com/ana/abc123def456";;
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
    expect(list.pulls).toEqual([
      expect.objectContaining({ number: 7, title: 'Store rewrite', author: 'ana', headRef: 'feature/store', draft: false, review: { decision: 'approved', approvedByMe: false, approvals: 1, changesRequested: 0 } }),
      expect.objectContaining({ number: 8, review: { decision: 'approved', approvedByMe: true, approvals: 1, changesRequested: 0 } }),
      expect.objectContaining({ number: 9, review: { decision: 'changes_requested', approvedByMe: false, approvals: 0, changesRequested: 1 } }),
    ]);
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
    const explained = parseSse((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/impact/explain`, payload: { pull: 7 } })).body);
    expect((explained.find((e) => e.event === 'scene')!.data as { scene: { id: string } }).scene.id).toBe('impact-pr-7-explained');
    const branchExplained = parseSse((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/impact/explain`, payload: { pull: 'branch' } })).body);
    expect((branchExplained.find((e) => e.event === 'scene')!.data as { scene: { id: string } }).scene.id).toBe('impact-branch-explained');
  });

  it('anchors the risks of an impact scene to the pull request diff and posts them as a review', async () => {
    const scene = {
      ...fakeScene('en', 'Impact', 'impact'),
      nodes: [
        { id: 'api', label: 'API', role: 'compute', kind: 'k', summary: 's', code: { repo: 'r', path: 'apps/core/src/app.ts', startLine: 1, endLine: 1, language: 'ts' }, change: 'modified' },
        { id: 'web', label: 'Web', role: 'actor', kind: 'k', summary: 's' },
      ],
      edges: [], steps: [],
      risks: [
        { id: 'r1', title: 'Breaks callers', category: 'reliability', severity: 'high', explanation: 'The handler changed.', mitigation: 'Run the suite.', nodeIds: ['api'] },
        { id: 'r2', title: 'Unclear', category: 'complexity', severity: 'low', explanation: 'No code.', nodeIds: ['web'] },
      ],
    };
    const preview = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/pulls/7/risks`, payload: { scene } });
    expect(preview.json().risks).toEqual([
      expect.objectContaining({ id: 'r1', anchor: { path: 'apps/core/src/app.ts', line: 1 }, pieces: ['API'] }),
      expect.objectContaining({ id: 'r2', anchor: null }),
    ]);
    const posted = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/pulls/7/review`, payload: { scene, riskIds: ['r1', 'r2'], intro: 'Please check these.' } });
    expect(posted.statusCode).toBe(201);
    expect(posted.json()).toEqual({ id: 55, url: 'https://github.com/acme/x/pull/7#pullrequestreview-55', inline: 1, summary: 1, images: 2, logo: true, gistUrl: 'https://gist.github.com/ana/abc123def456' });
    const sent = JSON.parse(await readFile(join(dirname(bin), 'review.json'), 'utf8'));
    expect(sent.event).toBe('COMMENT');
    expect(sent.body.startsWith('Please check these.')).toBe(true);
    expect(sent.body).toContain('Unclear');
    expect(sent.body).toContain('![Web on the system map](https://gist.githubusercontent.com/ana/abc123def456/raw/risk-r2.svg)');
    expect(sent.body).toContain('<img src="https://gist.githubusercontent.com/ana/abc123def456/raw/pied-piper-mark.svg"');
    expect(sent.comments).toEqual([expect.objectContaining({ path: 'apps/core/src/app.ts', line: 1, side: 'RIGHT' })]);
    expect(sent.comments[0].body).toContain('Breaks callers');
    expect(sent.comments[0].body).toContain('raw/risk-r1.svg');
    expect(sent.comments[0].body).toContain('_Reviewed with Pied Piper_');
    expect((await readFile(join(dirname(bin), 'gist-files.txt'), 'utf8')).trim().split('\n').sort()).toEqual(['pied-piper-mark.svg', 'risk-r1.svg', 'risk-r2.svg']);
    expect(JSON.parse(await readFile(join(home, 'signature.json'), 'utf8'))).toEqual({ logoUrl: 'https://gist.githubusercontent.com/ana/abc123def456/raw/pied-piper-mark.svg' });
    const second = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/pulls/7/review`, payload: { scene, riskIds: ['r1'], evidence: false } });
    expect(second.json()).toMatchObject({ images: 0, logo: true });
    const sentAgain = JSON.parse(await readFile(join(dirname(bin), 'review.json'), 'utf8'));
    expect(sentAgain.comments[0].body).not.toContain('raw/risk-r1.svg');
    expect(sentAgain.comments[0].body).toContain('pied-piper-mark.svg');
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/pulls/7/review`, payload: { scene, riskIds: ['zz'] } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/pulls/7/risks`, payload: { scene: { id: 'bad' } } })).statusCode).toBe(404);
    const explainedId = (parseSse((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/impact/explain`, payload: { pull: 7 } })).body).at(-1)!.data as { id: string }).id;
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/pulls/7/risks`, payload: { sceneId: explainedId } })).json().risks).toHaveLength(1);
  });

  it('approves a pull request with a signed note and surfaces gh refusals', async () => {
    const approved = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/pulls/7/decision`, payload: { note: 'Ship it' } });
    expect(approved.statusCode).toBe(201);
    expect(approved.json()).toEqual({ id: 9, url: 'https://github.com/acme/x/pull/7#pullrequestreview-9', decision: 'approve' });
    const sent = await readFile(join(dirname(bin), 'approve.txt'), 'utf8');
    expect(sent).toContain('Ship it');
    expect(sent).toContain('Pied Piper');
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/pulls/7/decision`, payload: { decision: 'request_changes' } })).statusCode).toBe(502);
  });

  it('reviews a GitHub repository without cloning it, through -R, and can clone one into our folder', async () => {
    const remote = await app.inject({ method: 'POST', url: '/api/repos', payload: { remote: 'acme/x' } });
    expect(remote.statusCode).toBe(201);
    expect(remote.json()).toMatchObject({ kind: 'remote', remote: 'acme/x', name: 'x', head: null, hasSystemMap: false });
    const rid = remote.json().id;
    expect((await app.inject({ method: 'POST', url: '/api/repos', payload: { remote: 'not a repo' } })).statusCode).toBe(400);
    const list = (await app.inject({ method: 'GET', url: `/api/repos/${rid}/pulls` })).json();
    expect(list).toMatchObject({ available: true, branch: null });
    expect(list.pulls).toHaveLength(3);
    expect(await readFile(join(dirname(bin), 'list-args.txt'), 'utf8')).toContain('-R acme/x');
    const detail = (await app.inject({ method: 'GET', url: `/api/repos/${rid}/pulls/7` })).json();
    expect(detail.files).toHaveLength(4);
    const cloned = await app.inject({ method: 'POST', url: '/api/repos', payload: { remote: 'acme/x', clone: true } });
    expect(cloned.statusCode).toBe(201);
    expect(cloned.json()).toMatchObject({ kind: 'local', remote: null, name: 'acme__x', branch: expect.any(String) });
    expect(cloned.json().path).toBe(join(home, 'clones', 'acme__x'));
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
