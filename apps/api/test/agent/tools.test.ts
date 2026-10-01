import { sampleRegistry } from '@rdi/scene';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { executeTool, sceneInputSchema, TOOL_NAMES, toolDefinitions, type ToolContext } from '../../src/agent/tools';
import { fixtureOrgGraph, fixtureSources } from './orgGraph';

let ctx: ToolContext;
beforeAll(async () => {
  const graph = await fixtureOrgGraph();
  const sources = await fixtureSources();
  ctx = {
    loadGraph: async () => graph,
    readSource: async (repo, path) => sources.get(`${repo}|${path}`) ?? null,
    upsertSolution: async () => ({ id: 'x', n: 1, title: 'x' }),
    searchCode: async (query, repo) => {
      const matches: { repo: string; path: string; line: number; text: string }[] = [];
      for (const [key, file] of sources) {
        const [fileRepo, path] = key.split('|') as [string, string];
        if (repo && fileRepo !== repo) continue;
        file.content.split('\n').forEach((text, i) => { if (text.toLowerCase().includes(query.toLowerCase())) matches.push({ repo: fileRepo, path, line: i + 1, text }); });
      }
      return matches;
    },
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

describe('upsert_solution', () => {
  it('validates the draft and stores it through the context', async () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const upsert = vi.fn().mockResolvedValue({ id: 'sol1', n: 1, title: 'Rate limits' });
    const outcome = await executeTool('upsert_solution', { title: 'Rate limits', summary: 'Throttle devices', sceneProposed: scene, plan: [{ id: 't1', title: 'Limiter', nodeRefs: [scene.nodes[0]!.id] }] }, { ...ctx, upsertSolution: upsert });
    expect(outcome).toMatchObject({ solution: { id: 'sol1', n: 1, title: 'Rate limits' } });
    expect(outcome.content).toBe('Solution "Rate limits" saved as version 1 (id sol1).');
    expect(upsert).toHaveBeenCalledWith({ title: 'Rate limits', solutionId: undefined, draft: expect.objectContaining({ summary: 'Throttle devices' }) });
  });

  it('returns the validation errors of an invalid draft without storing it', async () => {
    const upsert = vi.fn();
    const outcome = await executeTool('upsert_solution', { title: 'x', summary: 'x', plan: [{ id: 't1', title: 'A', dependsOn: ['nope'] }] }, { ...ctx, upsertSolution: upsert });
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).toContain('dependsOn "nope"');
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('search_code', () => {
  it('finds code lines by text across repositories', async () => {
    const outcome = await run('search_code', { query: 'createOrderHandler' });
    const result = json(outcome.content);
    expect(result.matches).toEqual(expect.arrayContaining([
      { repo: 'acme-demo/shop-api', path: 'src/server.ts', line: 6, text: "app.post('/api/orders', createOrderHandler);" },
    ]));
    expect(outcome.summary).toMatch(/^search_code "createOrderHandler" → \d+/);
    expect(json((await run('search_code', { query: 'createOrderHandler', repo: 'acme-demo/shop-web' })).content).matches).toEqual([]);
    expect(await run('search_code', { query: 'a' })).toMatchObject({ isError: true });
  });
});

describe('emit_scene repairs', () => {
  it('drops internal pieces from groups and complexity on non-logic pieces instead of rejecting the scene', async () => {
    const scene = {
      id: 'saml', title: 'SAML', language: 'en',
      nodes: [
        { id: 'api', label: 'API', role: 'compute', kind: 'svc', summary: 's', complexity: { time: 'O(1)' } },
        { id: 'router', label: 'Router', role: 'logic', kind: 'router', summary: 's', parent: 'api', complexity: { time: 'O(n)' } },
        { id: 'db', label: 'DB', role: 'storage', kind: 'pg', summary: 's' },
      ],
      groups: [{ id: 'g1', label: 'Backend', nodeIds: ['api', 'router'] }, { id: 'g2', label: 'Inner', nodeIds: ['router'] }],
    };
    const outcome = await run('emit_scene', scene);
    expect(outcome.isError).toBeFalsy();
    expect(outcome.scene!.groups).toEqual([{ id: 'g1', label: 'Backend', nodeIds: ['api'] }]);
    expect(outcome.scene!.nodes.find((n) => n.id === 'api')!.complexity).toBeUndefined();
    expect(outcome.scene!.nodes.find((n) => n.id === 'router')!.complexity).toEqual({ time: 'O(n)' });
    expect(outcome.content).toContain('Auto-fixed');
  });
});

