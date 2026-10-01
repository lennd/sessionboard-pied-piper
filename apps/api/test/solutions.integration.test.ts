import http from 'node:http';
import { sampleRegistry } from '@rdi/scene';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const scene = sampleRegistry['iot-telemetry']!;
const draft = (summary: string) => ({ summary, sceneProposed: scene, plan: [{ id: 't1', title: 'Do it', nodeRefs: [scene.nodes[0]!.id] }, { id: 't2', title: 'Test it', dependsOn: ['t1'] }] });
type Who = Awaited<ReturnType<typeof signupVerified>>;
const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};
const call = (who: Who, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: method === 'GET' ? { cookie: who.cookie } : authed(who), ...(payload ? { payload } : {}) });

describe('solutions API', () => {
  it('creates, versions, lists and reads solutions', async () => {
    const { owner, org } = await setup();
    const created = await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'Rate limits', draft: draft('v1') });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/solutions/${id}/versions`, { draft: draft('v2') })).json()).toEqual({ n: 2 });
    const detail = (await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).json();
    expect(detail).toMatchObject({ id, title: 'Rate limits', status: 'draft', version: { n: 2, author: 'web', draft: { summary: 'v2' } }, tasks: {} });
    expect(detail.versions.map((v: { n: number }) => v.n)).toEqual([1, 2]);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}?version=1`)).json().version.draft.summary).toBe('v1');
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/solutions`)).json()).toEqual([{ id, title: 'Rate limits', status: 'draft', latestVersion: 2, progress: { done: 0, total: 2 }, updatedAt: expect.any(String) }]);
  });

  it('rejects invalid drafts with readable errors', async () => {
    const { owner, org } = await setup();
    const res = await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: { summary: 'x', sceneProposed: scene, plan: [{ id: 't1', title: 'A', nodeRefs: ['ghost'] }] } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'invalid_draft', errors: ['plan.t1: nodeRefs "ghost" is not a piece of the current or proposed scene'] } });
  });

  it('tracks task progress and moves the solution status', async () => {
    const { owner, org } = await setup();
    const { id } = (await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: draft('v1') })).json();
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t1`, { status: 'in_progress' })).statusCode).toBe(204);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).json().status).toBe('in_progress');
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t1`, { status: 'done', note: 'merged' });
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t2`, { status: 'done' });
    const detail = (await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).json();
    expect(detail.status).toBe('done');
    expect(detail.tasks.t1).toMatchObject({ status: 'done', note: 'merged' });
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t9`, { status: 'done' })).json()).toEqual({ error: { code: 'unknown_task' } });
  });

  it('keeps the solution status consistent with its tasks and never revives archived solutions', async () => {
    const { owner, org } = await setup();
    const { id } = (await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: draft('v1') })).json();
    const status = async () => (await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).json().status;
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t1`, { status: 'done' });
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t2`, { status: 'done' });
    expect(await status()).toBe('done');
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t2`, { status: 'blocked' });
    expect(await status()).toBe('in_progress');
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t2`, { status: 'done' });
    const more = { ...draft('v2'), plan: [...draft('v2').plan, { id: 't3', title: 'Docs' }] };
    await call(owner, 'POST', `/api/orgs/${org.id}/solutions/${id}/versions`, { draft: more });
    expect(await status()).toBe('in_progress');
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}`, { status: 'archived' });
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t3`, { status: 'done' });
    expect(await status()).toBe('archived');
  });

  it('shares one Redis subscription across every open page and releases it', async () => {
    const { owner, org } = await setup();
    const { id } = (await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: draft('v1') })).json();
    if (!ctx.app.server.listening) await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as { port: number }).port;
    const subscribers = async () => Number(((await ctx.redis.pubsub('NUMSUB', `rdi:solution:${id}`)) as [string, number])[1]);
    const open = () => new Promise<http.ClientRequest>((resolve) => {
      const request = http.get({ host: '127.0.0.1', port, path: `/api/orgs/${org.id}/solutions/${id}/events`, headers: { cookie: owner.cookie } });
      request.on('response', (res) => res.once('data', () => resolve(request)));
    });
    const streams = [await open(), await open(), await open()];
    expect(await subscribers()).toBe(1);
    for (const stream of streams) stream.destroy();
    await new Promise((r) => setTimeout(r, 200));
    expect(await subscribers()).toBe(0);
  });

  it('keeps solutions inside the organization but shares them with members', async () => {
    const { owner, org } = await setup();
    const { id } = (await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: draft('v1') })).json();
    const colleague = await signupVerified(ctx);
    await ctx.pool.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'member')", [org.id, colleague.userId]);
    expect((await call(colleague, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).statusCode).toBe(200);
    const stranger = await setup();
    expect((await call(stranger.owner, 'GET', `/api/orgs/${stranger.org.id}/solutions/${id}`)).statusCode).toBe(404);
    expect((await call(stranger.owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).statusCode).toBe(404);
  });

  it('streams changes live to open solution pages', async () => {
    const { owner, org } = await setup();
    const { id } = (await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: draft('v1') })).json();
    if (!ctx.app.server.listening) await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as { port: number }).port;
    const received: string[] = [];
    const request = http.get({ host: '127.0.0.1', port, path: `/api/orgs/${org.id}/solutions/${id}/events`, headers: { cookie: owner.cookie } });
    const firstEvent = new Promise<void>((resolve) => {
      request.on('response', (res) => res.on('data', (chunk: Buffer) => {
        received.push(chunk.toString());
        if (received.join('').includes('event: solution')) resolve();
      }));
    });
    await new Promise((r) => setTimeout(r, 150));
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t1`, { status: 'done' });
    await firstEvent;
    request.destroy();
    expect(received.join('')).toContain('data: {"type":"task","taskId":"t1","status":"done"}');
  });
});
