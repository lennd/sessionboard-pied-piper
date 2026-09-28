import { sampleRegistry } from '@rdi/scene';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeTool, sceneInputSchema, TOOL_NAMES, toolDefinitions, type ToolContext } from '../../src/agent/tools';
import { fixtureOrgGraph, fixtureSources } from './orgGraph';

let ctx: ToolContext;
beforeAll(async () => {
  const graph = await fixtureOrgGraph();
  const sources = await fixtureSources();
  ctx = {
    loadGraph: async () => graph,
    readSource: async (repo, path) => sources.get(`${repo}|${path}`) ?? null,
    prFiles: async (repo, number) => (repo === 'acme-demo/shop-api' && number === 7 ? [{ filename: 'src/orders.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }] : null),
  };
});
const run = async (name: string, input: unknown) => executeTool(name, input, ctx);
const json = (content: string) => JSON.parse(content);

describe('tool definitions', () => {
  it('declares every tool with an object input schema', () => {
    expect(toolDefinitions.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const tool of toolDefinitions) expect(tool.input_schema.type).toBe('object');
    expect(sceneInputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['id', 'title', 'language', 'nodes']) });
    expect(sceneInputSchema).not.toHaveProperty('$schema');
  });
});

describe('search_graph', () => {
  it('ranks pieces by name and summary matches and includes the repository', async () => {
    const result = json((await run('search_graph', { query: 'orders queue' })).content);
    expect(result[0]).toMatchObject({ id: 'queue:org-t:orders', label: 'Queue', name: 'orders' });
    const endpoint = result.find((r: { id: string }) => r.id === 'ep:shop-api:POST /api/orders');
    expect(endpoint).toMatchObject({ repo: 'acme-demo/shop-api' });
  });

  it('filters by label and reports invalid input as an error', async () => {
    const result = json((await run('search_graph', { query: 'orders', labels: ['Table'] })).content);
    expect(result.map((r: { label: string }) => r.label)).toEqual(['Table']);
    expect(await run('search_graph', { query: '' })).toMatchObject({ isError: true });
  });
});

describe('get_neighbors and find_path', () => {
  it('lists typed neighbours in both directions', async () => {
    const result = json((await run('get_neighbors', { id: 'queue:org-t:orders' })).content);
    expect(result.node).toMatchObject({ id: 'queue:org-t:orders' });
    expect(result.edges).toEqual(expect.arrayContaining([
      { type: 'PUBLISHES', direction: 'in', other: { id: 'file:shop-api:src/orders.ts', label: 'File', name: 'src/orders.ts' } },
      { type: 'CONSUMES', direction: 'in', other: { id: 'file:shop-worker:worker.py', label: 'File', name: 'worker.py' } },
    ]));
    expect(await run('get_neighbors', { id: 'nope' })).toMatchObject({ isError: true, content: 'Unknown piece id "nope".' });
  });

  it('finds a path across repositories', async () => {
    const result = json((await run('find_path', { from: 'file:shop-web:src/api.ts', to: 'ext:org-t:api.stripe.com' })).content);
    expect(result.path[0]).toBe('file:shop-web:src/api.ts');
    expect(result.path.at(-1)).toBe('ext:org-t:api.stripe.com');
    expect(result.edges[0]).toBe('CALLS_HTTP');
  });
});

describe('read_code', () => {
  it('returns numbered lines and caps the window', async () => {
    const outcome = await run('read_code', { repo: 'acme-demo/shop-api', path: 'src/server.ts', startLine: 6, endLine: 7 });
    expect(outcome.content).toBe("acme-demo/shop-api/src/server.ts (typescript)\n6: app.post('/api/orders', createOrderHandler);\n7: app.get('/api/orders/:id', getOrderHandler);");
    expect(await run('read_code', { repo: 'acme-demo/shop-api', path: 'missing.ts' })).toMatchObject({ isError: true });
  });
});

describe('get_pr_diff', () => {
  it('maps changed files to graph pieces', async () => {
    const result = json((await run('get_pr_diff', { repo: 'acme-demo/shop-api', number: 7 })).content);
    expect(result.files).toEqual([{ filename: 'src/orders.ts', status: 'modified', pieceId: 'file:shop-api:src/orders.ts', patch: '@@ -1 +1 @@\n-a\n+b' }]);
    expect(await run('get_pr_diff', { repo: 'acme-demo/shop-web', number: 1 })).toMatchObject({ isError: true });
  });
});

describe('emit_scene', () => {
  it('accepts a valid scene and returns it', async () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const outcome = await run('emit_scene', scene);
    expect(outcome.isError).toBeFalsy();
    expect(outcome.scene?.id).toBe('iot-telemetry');
    expect(outcome.content).toMatch(/^Scene "IoT telemetry ingestion" rendered/);
  });

  it('returns validation errors for an invalid scene', async () => {
    const outcome = await run('emit_scene', { id: 'x', title: 'X', language: 'en', nodes: [{ id: 'a', label: 'A', role: 'compute', kind: 'svc', summary: 's' }], edges: [{ id: 'e', from: 'a', to: 'ghost', kind: 'sync' }] });
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).toMatch(/ghost/);
    expect(outcome.scene).toBeUndefined();
  });

  it('rejects unknown tools', async () => {
    expect(await run('rm_rf', {})).toMatchObject({ isError: true, content: 'Unknown tool "rm_rf".' });
  });
});

describe('tool failures', () => {
  it('turns exceptions into error results the model can recover from', async () => {
    const failing: ToolContext = { ...ctx, prFiles: async () => { throw new Error('GitHub API 404: Not Found'); } };
    expect(await executeTool('get_pr_diff', { repo: 'acme-demo/shop-api', number: 99 }, failing)).toMatchObject({ isError: true, content: 'Tool get_pr_diff failed: GitHub API 404: Not Found' });
  });
});

