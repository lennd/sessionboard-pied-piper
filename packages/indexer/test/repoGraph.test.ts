import { describe, expect, it } from 'vitest';
import { buildRepoGraph, detect, linkInputsFromGraph, linkRepos, parseFile, type RepoGraph } from '../src/index';
import { graphFor } from './fixtures';

const edge = (g: RepoGraph, type: string) => g.edges.filter((e) => e.type === type).map((e) => `${e.from} -> ${e.to}`);

describe('buildRepoGraph', () => {
  it('creates repo, service, file and endpoint nodes with stable ids and summaries', async () => {
    const g = await graphFor('shop-api');
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['repo:shop-api', 'svc:shop-api', 'file:shop-api:src/orders.ts', 'ep:shop-api:POST /api/orders', 'ep:shop-api:GET /api/orders/:id']));
    const svc = g.nodes.find((n) => n.id === 'svc:shop-api')!;
    expect(svc).toMatchObject({ label: 'Service', name: 'shop-api', repoId: 'shop-api', props: { repo: 'acme-demo/shop-api', languages: ['TypeScript'] } });
    expect(svc.summary).toMatch(/2 HTTP endpoints/);
    expect(g.nodes.find((n) => n.id === 'ep:shop-api:POST /api/orders')!.summary).toBe('Handles POST /api/orders in src/server.ts.');
  });

  it('links files, endpoints, queues, tables and config', async () => {
    const g = await graphFor('shop-api');
    expect(edge(g, 'CONTAINS')).toEqual(expect.arrayContaining(['repo:shop-api -> svc:shop-api', 'svc:shop-api -> file:shop-api:src/db.ts', 'svc:shop-api -> ep:shop-api:POST /api/orders']));
    expect(edge(g, 'HANDLES')).toEqual(['ep:shop-api:POST /api/orders -> file:shop-api:src/server.ts', 'ep:shop-api:GET /api/orders/:id -> file:shop-api:src/server.ts']);
    expect(edge(g, 'IMPORTS')).toEqual(['file:shop-api:src/orders.ts -> file:shop-api:src/db.ts', 'file:shop-api:src/server.ts -> file:shop-api:src/orders.ts']);
    expect(edge(g, 'PUBLISHES')).toEqual(['file:shop-api:src/orders.ts -> queue:org-1:orders']);
    expect(edge(g, 'WRITES')).toEqual(['file:shop-api:src/orders.ts -> table:org-1:orders']);
    expect(edge(g, 'READS')).toEqual(['file:shop-api:src/orders.ts -> table:org-1:orders']);
    expect(edge(g, 'USES_CONFIG')).toEqual(['file:shop-api:src/db.ts -> cfg:shop-api:DATABASE_URL', 'file:shop-api:src/server.ts -> cfg:shop-api:PORT']);
  });

  it('marks shared nodes without repo id and keeps relative outbound calls on files', async () => {
    const worker = await graphFor('shop-worker');
    expect(worker.nodes.find((n) => n.id === 'queue:org-1:orders')).toMatchObject({ label: 'Queue', repoId: null });
    expect(worker.nodes.find((n) => n.id === 'ext:org-1:api.stripe.com')).toMatchObject({ label: 'External', repoId: null });
    expect(edge(worker, 'CONSUMES')).toEqual(['file:shop-worker:worker.py -> queue:org-1:orders']);
    expect(edge(worker, 'CALLS')).toEqual(['file:shop-worker:worker.py -> ext:org-1:api.stripe.com']);
    const web = await graphFor('shop-web');
    expect(web.nodes.find((n) => n.id === 'file:shop-web:src/api.ts')!.props.outbound).toEqual(['POST /api/orders', 'GET /api/orders/${}']);
    expect(new Set(web.nodes.map((n) => n.id)).size).toBe(web.nodes.length);
  });
});

describe('templated hosts', () => {
  it('treats URLs with a templated host as internal calls instead of failing', async () => {
    const content = "export const load = () => fetch(`http://localhost:${process.env.PORT}/api/orders/${id}`);\n";
    const facts = [await parseFile({ path: 'src/client.ts', language: 'typescript', loc: 1, content })];
    const walk = { files: [], totalLoc: 1, truncated: false, languages: ['TypeScript'], packageName: 'client' };
    const g = buildRepoGraph({ orgId: 'org-1', repoId: 'client', fullName: 'acme/client', walk, facts, detections: detect(facts) });
    expect(g.nodes.some((n) => n.label === 'External')).toBe(false);
    const api = await graphFor('shop-api');
    const links = linkRepos(linkInputsFromGraph([...g.nodes, ...api.nodes]));
    expect(links.map((l) => l.to)).toEqual(['ep:shop-api:GET /api/orders/:id']);
  });
});

