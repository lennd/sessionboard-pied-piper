import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleRegistry } from '@rdi/scene';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeQuery } from '../src/agent/fakeQuery';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createRunRegistry } from '../src/runs/registry';
import { parseSse } from './sse';

let home: string;
let repoPath: string;
let app: FastifyInstance;
let repoId: string;
const scene = sampleRegistry['iot-telemetry']!;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rdi-home-'));
  repoPath = await mkdtemp(join(tmpdir(), 'rdi-repo-'));
  await mkdir(join(repoPath, 'src'), { recursive: true });
  await writeFile(join(repoPath, 'src', 'a.ts'), 'line1\nline2\nline3\n');
  app = buildApp({ config: loadConfig({ RDI_HOME: home, RDI_FAKE_AGENT: 'true' }), queryFn: createFakeQuery(), events: new EventEmitter(), runs: createRunRegistry(), now: () => new Date('2026-10-13T10:00:00Z') });
  await app.ready();
  const added = await app.inject({ method: 'POST', url: '/api/repos', payload: { path: repoPath } });
  repoId = added.json().id;
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
  await rm(repoPath, { recursive: true, force: true });
});

describe('repos and prefs', () => {
  it('registers folders, reports git state and refuses bad paths', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/repos' });
    expect(list.json()).toEqual([expect.objectContaining({ id: repoId, path: repoPath, head: null, branch: null, hasSystemMap: false })]);
    expect((await app.inject({ method: 'POST', url: '/api/repos', payload: { path: join(repoPath, 'nope') } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/repos/zzz' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/mcp-info` })).json()).toEqual({ url: `http://127.0.0.1:4040/mcp/${repoId}`, serverName: 'rdi' });
    expect((await app.inject({ method: 'DELETE', url: `/api/repos/${repoId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}` })).statusCode).toBe(404);
  });

  it('reads and patches preferences', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/prefs', payload: { theme: 'paper', uiLanguage: 'es' } })).json()).toMatchObject({ theme: 'paper', uiLanguage: 'es' });
    expect((await app.inject({ method: 'PATCH', url: '/api/prefs', payload: { theme: 'neon' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/prefs' })).json()).toMatchObject({ theme: 'paper' });
  });
});

describe('code', () => {
  it('serves file slices from the repository and refuses paths outside it', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/repos/${repoId}/code?path=src/a.ts&start=2&end=3` });
    expect(res.json()).toEqual({ repo: expect.any(String), path: 'src/a.ts', language: 'ts', startLine: 2, endLine: 3, snippet: 'line2\nline3' });
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/code?path=../etc/passwd` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/code?path=src/missing.ts` })).statusCode).toBe(404);
  });
});

describe('agent', () => {
  it('streams a scripted answer, stores the conversation, scenes, session and usage', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/agent` })).json()).toMatchObject({ enabled: true, model: 'fake-scripted' });
    const created = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/conversations` });
    const { id } = created.json();
    const res = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/conversations/${id}/messages`, payload: { text: 'How does login work?', language: 'es' } });
    expect(res.statusCode).toBe(200);
    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual(['text', 'tool', 'scene', 'tool', 'text', 'done']);
    expect(events.find((e) => e.event === 'scene')!.data).toMatchObject({ scene: { language: 'es' } });
    expect(events.at(-1)!.data).toMatchObject({ usage: { input: 100, output: 20 } });
    const detail = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/conversations/${id}` })).json();
    expect(detail.title).toBe('How does login work?');
    expect(detail.items).toEqual([{ role: 'user', text: 'How does login work?', turn: 1 }, { role: 'assistant', text: 'Looking at "How does login work?". Scripted answer.', turn: 1 }]);
    expect(detail.scenes).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/conversations` })).json()).toEqual([expect.objectContaining({ id, title: 'How does login work?' })]);
    const plan = parseSse((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/conversations/${id}/messages`, payload: { text: 'Add 2FA', mode: 'plan' } })).body);
    const solution = plan.find((e) => e.event === 'solution')!.data as { id: string };
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/solutions/${solution.id}` })).json()).toMatchObject({ conversationId: id, version: { n: 1, author: 'web' } });
  });

  it('generates, caches and translates the system map', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/system-map` })).statusCode).toBe(404);
    const generated = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/system-map`, payload: { language: 'es' } });
    expect(generated.statusCode).toBe(201);
    expect(generated.json()).toMatchObject({ cached: false, scene: { id: 'system-map', language: 'es' } });
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/system-map`, payload: {} })).json()).toMatchObject({ cached: true });
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/system-map` })).json()).toMatchObject({ id: 'system-map' });
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}` })).json()).toMatchObject({ hasSystemMap: true });
    const translated = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/scenes/system-map/translate`, payload: { language: 'pt' } });
    expect(translated.statusCode).toBe(201);
    expect(translated.json().scene.language).toBe('pt');
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/scenes/nope/translate`, payload: { language: 'pt' } })).statusCode).toBe(404);
  });
});

describe('solutions', () => {
  it('creates, versions, patches, reports tasks and emits events', async () => {
    const draft = { summary: 'Throttle', sceneProposed: scene, plan: [{ id: 't1', title: 'Limiter', nodeRefs: [scene.nodes[0]!.id] }] };
    const created = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/solutions`, payload: { title: 'Rate limits', draft } });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/solutions` })).json()).toEqual([expect.objectContaining({ id, status: 'draft', latestVersion: 1, progress: { done: 0, total: 1 } })]);
    const seen: unknown[] = [];
    app.inject({ method: 'GET', url: `/api/repos/${repoId}/solutions/${id}/events` }).then((res) => seen.push(...parseSse(res.body)));
    await new Promise((r) => setTimeout(r, 10));
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/solutions/${id}/versions`, payload: { draft: { ...draft, summary: 'v2' } } })).json()).toEqual({ n: 2 });
    expect((await app.inject({ method: 'PATCH', url: `/api/repos/${repoId}/solutions/${id}/tasks/t1`, payload: { status: 'done', note: 'ok' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PATCH', url: `/api/repos/${repoId}/solutions/${id}/tasks/zz`, payload: { status: 'done' } })).statusCode).toBe(404);
    const detail = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/solutions/${id}` })).json();
    expect(detail).toMatchObject({ status: 'done', version: { n: 2 }, tasks: { t1: { status: 'done', note: 'ok' } } });
    expect(detail.versions.map((v: { summary: string }) => v.summary)).toEqual(['Throttle', 'v2']);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/solutions/${id}?version=1` })).json().version.draft.summary).toBe('Throttle');
    expect((await app.inject({ method: 'PATCH', url: `/api/repos/${repoId}/solutions/${id}`, payload: { title: 'Renamed', status: 'archived' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/solutions`, payload: { title: 'x', draft: { summary: '' } } })).statusCode).toBe(422);
  });
});

describe('runs', () => {
  it('starts a run for a solution, exposes it and settles permissions and cancellation through the API', async () => {
    const draft = { summary: 'x', sceneProposed: scene, plan: [{ id: 't1', title: 'A' }] };
    const { id } = (await app.inject({ method: 'POST', url: `/api/repos/${repoId}/solutions`, payload: { title: 'S', draft } })).json();
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/solutions/00000000-0000-0000-0000-000000000000/run` })).statusCode).toBe(404);
    const started = await app.inject({ method: 'POST', url: `/api/repos/${repoId}/solutions/${id}/run` });
    expect(started.statusCode).toBe(201);
    const runId = started.json().id;
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/solutions/${id}/run` })).statusCode).toBe(409);
    await new Promise((r) => setTimeout(r, 30));
    const run = (await app.inject({ method: 'GET', url: `/api/repos/${repoId}/runs/${runId}` })).json();
    expect(run.pending).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/runs` })).json()).toEqual([expect.objectContaining({ id: runId, status: 'running' })]);
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/runs/${runId}/permissions/nope`, payload: { allow: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/runs/${runId}/permissions/${run.pending[0]}`, payload: { allow: true } })).statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 30));
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/runs/${runId}` })).json().status).toBe('done');
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/runs/${runId}/cancel` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/repos/${repoId}/runs/zzz/cancel` })).statusCode).toBe(404);
  });
});

describe('rules', () => {
  it('stores the team rules next to the scenes and counts the real lines', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/rules` })).json()).toEqual({ text: '', count: 0 });
    const saved = await app.inject({ method: 'PUT', url: `/api/repos/${repoId}/rules`, payload: { text: '# Security\r\n- No raw SQL in handlers\r\n\r\n2. Every endpoint validates its body\n   ' } });
    expect(saved.json()).toEqual({ text: '# Security\n- No raw SQL in handlers\n\n2. Every endpoint validates its body', count: 2 });
    expect((await app.inject({ method: 'GET', url: `/api/repos/${repoId}/rules` })).json().count).toBe(2);
    expect((await app.inject({ method: 'PUT', url: `/api/repos/${repoId}/rules`, payload: { text: 'x'.repeat(30000) } })).statusCode).toBe(400);
  });
});
