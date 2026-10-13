import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeQuery } from '../src/agent/fakeQuery';
import { fakeScene } from '../src/agent/fakeQuery';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createRunRegistry } from '../src/runs/registry';
import { gitChanges, gitDiff } from '../src/git/git';
import { projectDirFor } from '../src/observer/transcripts';
import { writeSystemMap } from '../src/store/scenes';
import { transcript } from './observer.test';

let home: string;
let claudeHome: string;
let repoPath: string;
let app: FastifyInstance;
let repoId: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...args], { cwd }).toString();

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rdi-home-'));
  claudeHome = await mkdtemp(join(tmpdir(), 'rdi-claude-'));
  repoPath = await mkdtemp(join(tmpdir(), 'rdi-repo-'));
  await mkdir(join(repoPath, 'apps/core/src/store'), { recursive: true });
  await writeFile(join(repoPath, 'apps/core/src/store/json.ts'), 'export const a = 1;\n');
  await writeFile(join(repoPath, 'apps/core/src/app.ts'), 'export const app = 1;\n');
  git(repoPath, 'init', '-q');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-qm', 'init');
  app = buildApp({ config: loadConfig({ RDI_HOME: home, RDI_CLAUDE_HOME: claudeHome, RDI_FAKE_AGENT: 'true' }), queryFn: createFakeQuery(), events: new EventEmitter(), runs: createRunRegistry() });
  await app.ready();
  repoId = (await app.inject({ method: 'POST', url: '/api/repos', payload: { path: repoPath } })).json().id;
  const dir = projectDirFor(claudeHome, repoPath);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sess1.jsonl'), `${transcript.map((l) => l.replaceAll('/work/repo', repoPath).replaceAll('src/auth.ts', 'apps/core/src/store/json.ts')).join('\n')}\n`);
});
afterEach(async () => {
  await app.close();
  for (const d of [home, claudeHome, repoPath]) await rm(d, { recursive: true, force: true });
});

describe('sessions', () => {
  it('lists and reads Claude Code sessions of the repository with their touched files', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/sessions` })).json();
    expect(list).toEqual([expect.objectContaining({ id: 'sess1', title: 'Fix the login bug', slug: 'fix-login' })]);
    const detail = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/sessions/sess1` })).json();
    expect(detail.events.map((e: { kind: string }) => e.kind)).toContain('edit');
    expect(detail.touched).toEqual([{ path: 'apps/core/src/store/json.ts', change: 'modified' }, { path: 'src/new.ts', change: 'added' }]);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/sessions/nope` })).statusCode).toBe(404);
  });

  it('overlays a session and the working tree on the cached system map', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/sessions/sess1/impact` })).statusCode).toBe(404);
    const head = git(repoPath, 'rev-parse', 'HEAD').trim();
    await writeSystemMap(join(repoPath, '.rdi'), head, fakeScene('en', 'Map', 'system-map') as never);
    const impact = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/sessions/sess1/impact` })).json();
    expect(impact.id).toBe('impact-sess1');
    expect(impact.nodes.find((n: { id: string }) => n.id === 'store').change).toBe('modified');
    expect(impact.nodes.find((n: { id: string }) => n.id === 'api').change).toBeUndefined();
    expect(impact.risks.map((r: { id: string }) => r.id)).toContain('impact-api');
    await writeFile(join(repoPath, 'apps/core/src/app.ts'), 'export const app = 2;\n');
    await writeFile(join(repoPath, 'apps/core/src/fresh.ts'), 'new\n');
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/changes` })).json()).toEqual({ touched: [{ path: 'apps/core/src/app.ts', change: 'modified' }, { path: 'apps/core/src/fresh.ts', change: 'added' }] });
    const worktree = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/changes/impact` })).json();
    expect(worktree.nodes.find((n: { id: string }) => n.id === 'api').change).toBe('modified');
    expect(await gitDiff(repoPath)).toContain('+export const app = 2;');
    expect(await gitDiff(repoPath, 20)).toContain('diff truncated');
    expect(await gitChanges('/nonexistent-dir-xyz')).toEqual([]);
  });

  it('asks the agent to explain a session or the working tree and stores the scene', async () => {
    const explained = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/impact/explain`, payload: { sessionId: 'sess1', language: 'es' } });
    expect(explained.statusCode).toBe(201);
    expect(explained.json()).toMatchObject({ scene: { id: 'impact-sess1-explained', language: 'es' }, text: expect.stringContaining('store changed') });
    expect(explained.json().scene.nodes.find((n: { id: string }) => n.id === 'store').change).toBe('modified');
    const worktree = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/impact/explain`, payload: {} });
    expect(worktree.json().scene.id).toBe('impact-worktree-explained');
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/impact/explain`, payload: { sessionId: 'nope' } })).statusCode).toBe(404);
  });
});
