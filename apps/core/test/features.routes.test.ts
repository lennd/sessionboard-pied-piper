import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeQuery } from '../src/agent/fakeQuery';
import type { QueryFn } from '../src/agent/sdkRunner';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createRunRegistry } from '../src/runs/registry';
import { fakeScene } from '../src/agent/fakeQuery';
import { writeSystemMap } from '../src/store/scenes';
import { validateScene } from '@rdi/scene';
import { parseSse } from './sse';

let home: string;
let apiRepo: string;
let webRepo: string;
let app: FastifyInstance;
let apiId: string;
let webId: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...args], { cwd }).toString();

const makeRepo = async (name: string) => {
  const base = await mkdtemp(join(tmpdir(), 'rdi-'));
  const path = join(base, name);
  await mkdir(join(path, 'src'), { recursive: true });
  await writeFile(join(path, 'src', 'index.ts'), `export const ${name.replace(/-/g, '_')} = 1;\n`);
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'init');
  return path;
};

const boot = async (queryFn: QueryFn) => {
  app = buildApp({ config: loadConfig({ RDI_HOME: home, RDI_FAKE_AGENT: 'true' }), queryFn, events: new EventEmitter(), runs: createRunRegistry(), now: () => new Date('2026-10-14T10:00:00Z') });
  await app.ready();
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rdi-home-'));
  apiRepo = await makeRepo('shop-api');
  webRepo = await makeRepo('shop-web');
  await boot(createFakeQuery());
  apiId = (await app.inject({ method: 'POST', url: '/api/repos', payload: { path: apiRepo } })).json().id;
  webId = (await app.inject({ method: 'POST', url: '/api/repos', payload: { path: webRepo } })).json().id;
});
afterEach(async () => {
  await app.close();
  for (const d of [home, join(apiRepo, '..'), join(webRepo, '..')]) await rm(d, { recursive: true, force: true });
});

const createFeature = async (brief = 'Add two-factor login.') =>
  (await app.inject({ method: 'POST', url: '/api/features', payload: { title: 'Checkout 2FA', repoIds: [apiId, webId], brief } })).json();

describe('features', () => {
  it('creates, lists, edits and deletes a feature that spans repositories', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/features', payload: { title: 'Checkout 2FA', repoIds: [apiId, webId, apiId] } });
    expect(created.statusCode).toBe(201);
    const feature = created.json();
    expect(feature).toMatchObject({ title: 'Checkout 2FA', status: 'draft', brief: '', repoIds: [apiId, webId], plan: null });
    expect(feature.repos.map((r: { name: string; available: boolean }) => [r.name, r.available])).toEqual([['shop-api', true], ['shop-web', true]]);
    expect((await app.inject({ method: 'POST', url: '/api/features', payload: { title: 'x', repoIds: ['nope'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/features' })).json()).toEqual([expect.objectContaining({ id: feature.id })]);
    const patched = await app.inject({ method: 'PATCH', url: `/api/features/${feature.id}`, payload: { brief: 'Users sign in with a code.', repoIds: [webId], status: 'planned' } });
    expect(patched.json()).toMatchObject({ brief: 'Users sign in with a code.', repoIds: [webId], status: 'planned' });
    expect(JSON.parse(await readFile(join(home, 'features', feature.id, 'feature.json'), 'utf8')).brief).toBe('Users sign in with a code.');
    await app.inject({ method: 'DELETE', url: `/api/repos/${webId}` });
    expect((await app.inject({ method: 'GET', url: `/api/features/${feature.id}` })).json().repos[0]).toMatchObject({ id: webId, available: false });
    expect((await app.inject({ method: 'DELETE', url: `/api/features/${feature.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/features/${feature.id}` })).statusCode).toBe(404);
  });

  it('serves code of any repository of the feature by name', async () => {
    const feature = await createFeature();
    const res = await app.inject({ method: 'GET', url: `/api/features/${feature.id}/code?repo=shop-web&path=src/index.ts` });
    expect(res.json()).toMatchObject({ repo: 'shop-web', snippet: expect.stringContaining('shop_web = 1') });
    expect((await app.inject({ method: 'GET', url: `/api/features/${feature.id}/code?repo=other&path=src/index.ts` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/features/${feature.id}/code?repo=shop-api&path=../x` })).statusCode).toBe(404);
  });

  it('plans across repositories in the chat: the agent reads every repo and the plan has a task per repo', async () => {
    const feature = await createFeature();
    const { id: conversationId } = (await app.inject({ method: 'POST', url: `/api/features/${feature.id}/conversations` })).json();
    const res = await app.inject({ method: 'POST', url: `/api/features/${feature.id}/conversations/${conversationId}/messages`, payload: { text: 'Plan it', mode: 'plan' } });
    const events = parseSse(res.body);
    const solution = events.find((e) => e.event === 'solution')!.data as { id: string };
    const detail = (await app.inject({ method: 'GET', url: `/api/features/${feature.id}/solutions/${solution.id}` })).json();
    expect(detail.version.draft.plan.map((t: { id: string; repo: string; dependsOn: string[] }) => [t.id, t.repo, t.dependsOn])).toEqual([['t1', 'shop-api', []], ['t2', 'shop-web', ['t1']]]);
    expect((await app.inject({ method: 'GET', url: `/api/features/${feature.id}` })).json().plan).toMatchObject({ id: solution.id, progress: { done: 0, total: 2 } });
    expect((await app.inject({ method: 'GET', url: `/api/features/${feature.id}/solutions` })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/api/repos/${apiId}/solutions` })).json()).toEqual([]);
  });

  it('runs the plan one repository at a time with a prompt limited to that repository', async () => {
    const prompts: { prompt: string; cwd: string; extra: string[]; mcp: unknown }[] = [];
    const fake = createFakeQuery();
    await app.close();
    await boot((params, local) => {
      prompts.push({ prompt: params.prompt, cwd: params.options.cwd ?? '', extra: params.options.additionalDirectories ?? [], mcp: params.options.mcpServers });
      return fake(params, local);
    });
    const feature = await createFeature();
    expect((await app.inject({ method: 'POST', url: `/api/features/${feature.id}/repos/${apiId}/run` })).statusCode).toBe(404);
    const { id: conversationId } = (await app.inject({ method: 'POST', url: `/api/features/${feature.id}/conversations` })).json();
    await app.inject({ method: 'POST', url: `/api/features/${feature.id}/conversations/${conversationId}/messages`, payload: { text: 'Plan it', mode: 'plan' } });
    expect(prompts[0]).toMatchObject({ cwd: apiRepo, extra: [webRepo] });
    expect(prompts[0]!.prompt).toContain('shop-web → ');
    expect(prompts[0]!.prompt).toContain('Add two-factor login.');
    const started = await app.inject({ method: 'POST', url: `/api/features/${feature.id}/repos/${webId}/run` });
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({ repoId: webId, featureId: feature.id });
    await new Promise((r) => setTimeout(r, 30));
    expect(prompts[1]!.cwd).toBe(webRepo);
    expect(prompts[1]!.prompt).toContain('Implement only the tasks whose repo is "shop-web"');
    expect(prompts[1]!.mcp).toEqual({ rdi: { type: 'http', url: expect.stringMatching(new RegExp(`/mcp/features/${feature.id}$`)) } });
    expect((await app.inject({ method: 'GET', url: `/api/features/${feature.id}/runs` })).json()).toEqual([expect.objectContaining({ repoId: webId })]);
    expect((await app.inject({ method: 'POST', url: `/api/features/${feature.id}/repos/nope/run` })).statusCode).toBe(404);
  });

  it('combines the cached maps of its repositories and overlays the changes of every repository', async () => {
    const feature = await createFeature();
    const missing = await app.inject({ method: 'GET', url: `/api/features/${feature.id}/system-map` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.missing.map((m: { name: string }) => m.name)).toEqual(['shop-api', 'shop-web']);
    const map = (name: string) => ({ ...fakeScene('en', `${name} map`, 'system-map'), nodes: fakeScene('en', 'x', 'system-map').nodes.map((n) => ({ ...n, code: { ...n.code, path: 'src/index.ts' } })) });
    await writeSystemMap(join(apiRepo, '.rdi'), git(apiRepo, 'rev-parse', 'HEAD').trim(), map('shop-api') as never);
    const partial = (await app.inject({ method: 'GET', url: `/api/features/${feature.id}/system-map` })).json();
    expect(partial.missing.map((m: { name: string }) => m.name)).toEqual(['shop-web']);
    await writeSystemMap(join(webRepo, '.rdi'), git(webRepo, 'rev-parse', 'HEAD').trim(), map('shop-web') as never);
    const combined = (await app.inject({ method: 'GET', url: `/api/features/${feature.id}/system-map` })).json();
    expect(combined.missing).toEqual([]);
    expect(validateScene(combined.scene).ok).toBe(true);
    expect(combined.scene.nodes.map((n: { id: string; repo: string }) => [n.id, n.repo])).toEqual(expect.arrayContaining([['shop-api:api', 'shop-api'], ['shop-web:api', 'shop-web']]));
    expect(combined.scene.edges.map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining(['shop-api:e1', 'shop-web:e1']));
    await writeFile(join(webRepo, 'src', 'index.ts'), 'changed\n');
    const impact = (await app.inject({ method: 'GET', url: `/api/features/${feature.id}/impact` })).json();
    expect(impact.touched).toEqual([{ path: 'src/index.ts', change: 'modified', repo: 'shop-web' }]);
    const changed = impact.scene.nodes.filter((n: { change?: string }) => n.change).map((n: { id: string }) => n.id);
    expect(changed).toEqual(expect.arrayContaining(['shop-web:api', 'shop-web:store', 'shop-web:web']));
    expect(changed.some((id: string) => id.startsWith('shop-api:'))).toBe(false);
  });

  it('exposes the feature plan to Claude Code through its own MCP endpoint', async () => {
    const feature = await createFeature();
    const res = await app.inject({ method: 'POST', url: `/mcp/features/${feature.id}`, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } });
    expect(res.json().result.tools.map((t: { name: string }) => t.name)).toEqual(['list_solutions', 'get_solution', 'get_system_map', 'update_solution', 'report_task_progress']);
    expect((await app.inject({ method: 'POST', url: '/mcp/features/nope', headers: { 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(404);
  });
});
