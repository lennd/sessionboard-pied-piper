import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleRegistry } from '@rdi/scene';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendMessages, createConversation, findConversation, listConversations, recordRun, totalUsage } from '../src/store/conversations';
import { readJson, withLock, writeJson } from '../src/store/json';
import { readPrefs, updatePrefs } from '../src/store/prefs';
import { addRepo, findRepo, listRepos, removeRepo, repoDir, RepoError } from '../src/store/repos';
import { findScene, insertScene, listConversationScenes, readSystemMap, writeSystemMap } from '../src/store/scenes';
import { addVersion, createSolution, findSolution, latestVersion, listSolutions, progressOf, updateSolutionFile } from '../src/store/solutions';

let home: string;
let repoPath: string;
const now = new Date('2026-10-13T10:00:00Z');
const later = new Date('2026-10-13T11:00:00Z');
const scene = sampleRegistry['iot-telemetry']!;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rdi-home-'));
  repoPath = await mkdtemp(join(tmpdir(), 'rdi-repo-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(repoPath, { recursive: true, force: true });
});

describe('json helpers', () => {
  it('reads fallbacks, writes atomically and serialises locked work', async () => {
    const file = join(home, 'x.json');
    expect(await readJson(file, { a: 1 })).toEqual({ a: 1 });
    await writeJson(file, { b: 2 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ b: 2 });
    const order: number[] = [];
    await Promise.all([
      withLock('k', async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); }),
      withLock('k', async () => { order.push(2); }),
    ]);
    expect(order).toEqual([1, 2]);
  });
});

describe('repos index', () => {
  it('adds directories once, lists, finds and removes them', async () => {
    const repo = await addRepo(home, repoPath, now);
    expect(repo).toMatchObject({ path: repoPath, addedAt: now.toISOString() });
    expect(repo.id).toHaveLength(12);
    expect(await addRepo(home, repoPath, later)).toEqual(repo);
    expect(await listRepos(home)).toEqual([repo]);
    expect(await findRepo(home, repo.id)).toEqual(repo);
    expect(repoDir(repo)).toBe(join(repoPath, '.rdi'));
    expect(await readFile(join(repoPath, '.rdi', '.gitignore'), 'utf8')).toBe('*\n');
    await expect(addRepo(home, join(repoPath, 'missing'), now)).rejects.toBeInstanceOf(RepoError);
    expect(await removeRepo(home, repo.id)).toBe(true);
    expect(await removeRepo(home, repo.id)).toBe(false);
    expect(await listRepos(home)).toEqual([]);
  });
});

describe('prefs', () => {
  it('returns defaults and merges patches', async () => {
    expect(await readPrefs(home)).toEqual({ uiLanguage: null, explanationLanguage: null, theme: null, initialLevel: null });
    await updatePrefs(home, { theme: 'paper' });
    expect(await updatePrefs(home, { uiLanguage: 'es' })).toMatchObject({ theme: 'paper', uiLanguage: 'es' });
  });
});

describe('conversations and scenes', () => {
  it('stores messages, runs, usage and scenes per conversation', async () => {
    const dir = join(repoPath, '.rdi');
    const c = await createConversation(dir, now);
    await appendMessages(dir, c.id, later, [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }]);
    await recordRun(dir, c.id, later, { sdkSessionId: 's1', usage: { input: 10, output: 5, costUsd: 0.5 } });
    await recordRun(dir, c.id, later, { sdkSessionId: null, usage: { input: 1, output: 1, costUsd: 0.1 } });
    const stored = await findConversation(dir, c.id);
    expect(stored).toMatchObject({ sdkSessionId: 's1', usage: { input: 11, output: 6, costUsd: 0.6 }, updatedAt: later.toISOString() });
    expect(stored!.messages).toHaveLength(2);
    expect((await listConversations(dir)).map((x) => x.id)).toEqual([c.id]);
    expect(await totalUsage(dir)).toEqual({ input: 11, output: 6, costUsd: 0.6 });
    const row = await insertScene(dir, now, { conversationId: c.id, sourceSceneId: null, turn: 1, scene });
    expect((await findScene(dir, row.id))!.scene.id).toBe(scene.id);
    expect((await listConversationScenes(dir, c.id)).map((s) => s.id)).toEqual([row.id]);
    expect(await readSystemMap(dir, 'abc')).toBeNull();
    await writeSystemMap(dir, 'abc', scene);
    expect((await readSystemMap(dir, 'abc'))!.id).toBe(scene.id);
    expect(await readSystemMap(dir, null)).toBeNull();
  });
});

describe('solutions', () => {
  it('appends versions under the lock, tracks tasks and progress', async () => {
    const dir = join(repoPath, '.rdi');
    const draft = { summary: 's', sceneCurrent: null, sceneProposed: scene, plan: [{ id: 't1', title: 'A', nodeRefs: [], acceptance: [], dependsOn: [] }], risks: [] };
    const s = await createSolution(dir, now, { title: 'T', conversationId: null, draft, author: 'web' });
    expect(latestVersion(s).n).toBe(1);
    await Promise.all([addVersion(dir, s.id, later, 'web', () => draft), addVersion(dir, s.id, later, 'claude-code', () => draft)]);
    const stored = await findSolution(dir, s.id);
    expect(stored!.versions.map((v) => v.n)).toEqual([1, 2, 3]);
    await updateSolutionFile(dir, s.id, later, (x) => ({ ...x, tasks: { t1: { status: 'done', note: null, updatedAt: later.toISOString() } } }));
    expect(progressOf((await findSolution(dir, s.id))!)).toEqual({ done: 1, total: 1 });
    expect((await listSolutions(dir)).map((x) => x.id)).toEqual([s.id]);
    expect(await addVersion(dir, 'missing', later, 'web', () => draft)).toBeNull();
  });
});
