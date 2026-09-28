import { validateScene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import { buildSystemMap, linkInputsFromGraph, linkRepos, type OrgGraph } from '../src/index';
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
