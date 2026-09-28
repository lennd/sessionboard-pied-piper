import { validateScene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import { buildSystemMap, linkInputsFromGraph, linkRepos, type GraphEdge, type GraphNode, type OrgGraph } from '../src/index';
import { graphFor } from './fixtures';

const orgGraph = async (): Promise<OrgGraph> => {
  const graphs = await Promise.all([graphFor('shop-web'), graphFor('shop-api'), graphFor('shop-worker')]);
  const nodes = [...new Map(graphs.flatMap((g) => g.nodes).map((n) => [n.id, n])).values()];
  return { nodes, edges: [...graphs.flatMap((g) => g.edges), ...linkRepos(linkInputsFromGraph(nodes))] };
};

describe('buildSystemMap', () => {
  it('returns null without services', () => {
    expect(buildSystemMap({ nodes: [], edges: [] })).toBeNull();
  });

  it('builds a valid scene with services, endpoints, queues, tables and externals', async () => {
    const scene = buildSystemMap(await orgGraph())!;
    expect(validateScene(scene)).toMatchObject({ ok: true });
    expect(scene).toMatchObject({ id: 'system-map', title: 'System map', language: 'en' });
    const byLabel = Object.fromEntries(scene.nodes.map((n) => [n.label, n]));
    expect(byLabel['shop-api']).toMatchObject({ role: 'compute', kind: 'service', repo: 'acme-demo/shop-api' });
    expect(byLabel['POST /api/orders']).toMatchObject({ role: 'compute', kind: 'HTTP endpoint', parent: byLabel['shop-api']!.id });
    expect(byLabel['orders']).toBeDefined();
    expect(scene.nodes.filter((n) => n.label === 'orders').map((n) => n.role).sort()).toEqual(['channel', 'storage']);
    expect(byLabel['api.stripe.com']).toMatchObject({ role: 'external' });
  });

  it('derives service-level edges including the cross-repo HTTP call', async () => {
    const scene = buildSystemMap(await orgGraph())!;
    const label = new Map(scene.nodes.map((n) => [n.id, `${n.label}${n.role === 'channel' ? '(q)' : n.role === 'storage' ? '(t)' : ''}`]));
    const edges = scene.edges.map((e) => `${label.get(e.from)} -${e.kind}-> ${label.get(e.to)}`);
    expect(edges).toEqual(expect.arrayContaining([
      'shop-web -sync-> POST /api/orders',
      'shop-web -sync-> GET /api/orders/:id',
      'shop-api -async-> orders(q)',
      'orders(q) -async-> shop-worker',
      'shop-api -write-> orders(t)',
      'shop-api -read-> orders(t)',
      'shop-worker -write-> orders(t)',
      'shop-worker -calls-> api.stripe.com',
    ]));
  });

  it('infers a walkthrough that follows the request through the system', async () => {
    const scene = buildSystemMap(await orgGraph())!;
    const narr = scene.steps.map((s) => s.narration);
    expect(narr[0]).toBe('shop-web calls POST /api/orders on shop-api.');
    expect(narr[1]).toBe('shop-api publishes a message to the "orders" queue.');
    expect(narr[2]).toBe('shop-worker picks up the message from "orders".');
    expect(narr).toContain('shop-worker calls the external service api.stripe.com.');
    expect(scene.steps.every((s) => s.travel)).toBe(true);
    expect(scene.steps.length).toBeLessThanOrEqual(12);
  });
});

describe('large organizations', () => {
  it('stays within the scene limits by folding endpoints and capping shared pieces', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const longRepo = `acme/${'x'.repeat(200)}`;
    for (let s = 0; s < 10; s++) {
      const svc = `svc:r${s}`;
      nodes.push({ id: svc, label: 'Service', name: `service-${s}`, summary: 'y'.repeat(5000), repoId: `r${s}`, props: { repo: longRepo } });
      nodes.push({ id: `file:r${s}:a.ts`, label: 'File', name: 'a.ts', summary: '', repoId: `r${s}`, props: {} });
      edges.push({ from: svc, to: `file:r${s}:a.ts`, type: 'CONTAINS', props: {} });
      for (let e = 0; e < 40; e++) {
        const ep = `ep:r${s}:GET /r/${e}`;
        nodes.push({ id: ep, label: 'Endpoint', name: `GET /r/${e}`, summary: 'endpoint', repoId: `r${s}`, props: {} });
        edges.push({ from: svc, to: ep, type: 'CONTAINS', props: {} });
      }
    }
    for (let q = 0; q < 60; q++) {
      nodes.push({ id: `table:o:t${q}`, label: 'Table', name: `t${q}`, summary: 'table', repoId: null, props: {} });
      edges.push({ from: 'file:r0:a.ts', to: `table:o:t${q}`, type: 'WRITES', props: {} });
    }
    edges.push({ from: 'file:r1:a.ts', to: 'ep:r0:GET /r/39', type: 'CALLS_HTTP', props: {} });
    const scene = buildSystemMap({ nodes, edges })!;
    expect(scene.nodes.length).toBeLessThanOrEqual(150);
    expect(scene.nodes.every((n) => n.summary.length <= 2000 && (n.repo ?? '').length <= 120)).toBe(true);
    const label = new Map(scene.nodes.map((n) => [n.id, n.label]));
    const parent = new Map(scene.nodes.map((n) => [n.id, n.parent]));
    const service0 = scene.nodes.find((n) => n.label === 'service-0')!.id;
    expect(scene.edges.some((e) => label.get(e.from) === 'service-1' && (e.to === service0 || parent.get(e.to) === service0))).toBe(true);
  });
});

