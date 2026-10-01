import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { sampleRegistry } from '@rdi/scene';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const scene = sampleRegistry['iot-telemetry']!;
const draft = { summary: 'v1', sceneProposed: scene, plan: [{ id: 't1', title: 'Do it', nodeRefs: [scene.nodes[0]!.id], acceptance: ['works'] }, { id: 't2', title: 'Test it' }] };
const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  const token = (await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/tokens`, headers: authed(owner), payload: { name: 'cc' } })).json().token as string;
  const solution = (await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/solutions`, headers: authed(owner), payload: { title: 'Rate limits', draft } })).json() as { id: string };
  return { owner, org, token, solution };
};
let rpcId = 0;
const rpc = (token: string | null, method: string, params: object = {}) =>
  ctx.app.inject({
    method: 'POST', url: '/mcp',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
const callTool = async (token: string, name: string, args: object) => (await rpc(token, 'tools/call', { name, arguments: args })).json().result as { content: { text: string }[]; isError?: boolean };

describe('MCP endpoint', () => {
  it('requires a valid token', async () => {
    expect((await rpc(null, 'tools/list')).statusCode).toBe(401);
    expect((await rpc('rdi_nope', 'tools/list')).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
  });

  it('lists the tools', async () => {
    const { token } = await setup();
    const tools = (await rpc(token, 'tools/list')).json().result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(['list_solutions', 'get_solution', 'query_graph', 'update_solution', 'report_task_progress']);
  });

  it('returns a solution with its plan, task status and piece context', async () => {
    const { token, solution } = await setup();
    expect(JSON.parse((await callTool(token, 'list_solutions', {})).content[0]!.text)).toEqual([expect.objectContaining({ id: solution.id, title: 'Rate limits', latestVersion: 1 })]);
    const detail = JSON.parse((await callTool(token, 'get_solution', { id: solution.id })).content[0]!.text);
    expect(detail).toMatchObject({ id: solution.id, version: 1, summary: 'v1', plan: [{ id: 't1', status: 'todo' }, { id: 't2', status: 'todo' }] });
    expect(detail.context[scene.nodes[0]!.id]).toMatchObject({ label: scene.nodes[0]!.label });
  });

  it('records versions and progress as Claude Code', async () => {
    const { owner, org, token, solution } = await setup();
    const update = await callTool(token, 'update_solution', { id: solution.id, summary: 'v2 from Claude Code' });
    expect(update.content[0]!.text).toBe('Saved version 2.');
    const progress = await callTool(token, 'report_task_progress', { id: solution.id, taskId: 't1', status: 'done', note: 'PR #12' });
    expect(progress.isError).toBeFalsy();
    const detail = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/solutions/${solution.id}`, headers: { cookie: owner.cookie } })).json();
    expect(detail).toMatchObject({ status: 'in_progress', version: { n: 2, author: 'claude-code', draft: { summary: 'v2 from Claude Code', plan: [{ id: 't1' }, { id: 't2' }] } }, tasks: { t1: { status: 'done', note: 'PR #12' } } });
  });

  it('refuses updates based on a stale version', async () => {
    const { token, solution } = await setup();
    await callTool(token, 'update_solution', { id: solution.id, summary: 'v2', baseVersion: 1 });
    const stale = await callTool(token, 'update_solution', { id: solution.id, summary: 'v3 from stale', baseVersion: 1 });
    expect(stale).toMatchObject({ isError: true, content: [{ text: 'The solution changed since version 1 (latest is 2). Call get_solution again and retry.' }] });
  });

  it('rejects invalid updates, unknown tasks and other organizations', async () => {
    const { token, solution } = await setup();
    expect(await callTool(token, 'update_solution', { id: solution.id, summary: 'x', plan: [{ id: 't1', title: 'A', dependsOn: ['zz'] }] })).toMatchObject({ isError: true });
    expect(await callTool(token, 'report_task_progress', { id: solution.id, taskId: 'nope', status: 'done' })).toMatchObject({ isError: true });
    const other = await setup();
    expect(await callTool(other.token, 'get_solution', { id: solution.id })).toMatchObject({ isError: true, content: [{ text: 'Solution not found.' }] });
    expect(await callTool(other.token, 'report_task_progress', { id: solution.id, taskId: 't1', status: 'done' })).toMatchObject({ isError: true });
  });

  it('works with the official MCP client over HTTP', async () => {
    const { token, solution } = await setup();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as { port: number }).port;
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const result = await client.callTool({ name: 'get_solution', arguments: { id: solution.id } });
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).title).toBe('Rate limits');
    await client.close();
  });
});
