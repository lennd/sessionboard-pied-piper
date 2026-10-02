import { validateScene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import { buildPullRequestImpact, linkInputsFromGraph, linkRepos, type OrgGraph } from '../src/index';
import { graphFor } from './fixtures';

const orgGraph = async (): Promise<OrgGraph> => {
  const graphs = await Promise.all([graphFor('shop-web'), graphFor('shop-api'), graphFor('shop-worker')]);
  const nodes = [...new Map(graphs.flatMap((g) => g.nodes).map((n) => [n.id, n])).values()];
  return { nodes, edges: [...graphs.flatMap((g) => g.edges), ...linkRepos(linkInputsFromGraph(nodes))] };
};
const pull = { number: 12, title: 'Allow cancelling orders', author: 'ana', url: 'https://github.com/acme-demo/shop-api/pull/12', headRef: 'feature/cancel', baseRef: 'main', additions: 30, deletions: 4 };
const files = [
  { filename: 'src/orders.ts', status: 'modified', additions: 20, deletions: 4, patch: '@@ -10,3 +10,8 @@\n+export async function cancelOrderHandler(req, res) {}' },
  { filename: 'src/cancel.ts', status: 'added', additions: 10, deletions: 0, patch: '+export const cancel = () => {};' },
];

describe('buildPullRequestImpact', () => {
  it('builds a valid change diagram with what the pull request touches', async () => {
    const scene = buildPullRequestImpact({ graph: await orgGraph(), repoFullName: 'acme-demo/shop-api', pull, files });
    expect(validateScene(scene).ok).toBe(true);
    expect(scene).toMatchObject({ id: 'pr-acme-demo-shop-api-12', title: '#12 Allow cancelling orders', language: 'en' });
    const byLabel = new Map(scene.nodes.map((n) => [n.label, n]));
    expect(byLabel.get('shop-api')).toMatchObject({ role: 'compute', repo: 'acme-demo/shop-api', change: 'modified' });
    expect(byLabel.get('src/orders.ts')).toMatchObject({ change: 'modified', parent: byLabel.get('shop-api')!.id, code: { repo: 'acme-demo/shop-api', path: 'src/orders.ts' } });
    expect(byLabel.get('src/cancel.ts')).toMatchObject({ change: 'added' });
    expect(byLabel.get('src/cancel.ts')!.code).toBeUndefined();
    expect(byLabel.get('POST /api/orders')).toMatchObject({ kind: 'HTTP endpoint', change: 'modified' });
    expect(byLabel.get('GET /api/orders/:id')).toMatchObject({ kind: 'HTTP endpoint' });
    expect(scene.nodes.filter((n) => n.label === 'orders').map((n) => n.role).sort()).toEqual(['channel', 'storage']);
    expect(byLabel.get('shop-web')).toMatchObject({ role: 'compute', repo: 'acme-demo/shop-web' });
    const label = new Map(scene.nodes.map((n) => [n.id, n.label]));
    expect(scene.edges.map((e) => `${label.get(e.from)} -${e.kind}-> ${label.get(e.to)}`)).toEqual(expect.arrayContaining(['shop-web -sync-> POST /api/orders', 'src/orders.ts -async-> orders']));
  });

  it('walks through each changed file with its patch and flags the contract risk', async () => {
    const scene = buildPullRequestImpact({ graph: await orgGraph(), repoFullName: 'acme-demo/shop-api', pull, files });
    expect(scene.steps[0]).toMatchObject({ narration: expect.stringMatching(/^src\/orders\.ts: modified \(\+20 −4\)/), payload: { format: 'text', after: files[0]!.patch } });
    expect(scene.steps.map((s) => s.narration)).toEqual(expect.arrayContaining([expect.stringMatching(/^shop-web calls POST \/api\/orders/)]));
    expect(scene.risks.map((r) => [r.category, r.title])).toEqual(expect.arrayContaining([['reliability', 'Endpoints used by other repositories change']]));
  });

  it('flags security, migrations and size, caps files and stays deterministic', async () => {
    const graph = await orgGraph();
    const many = Array.from({ length: 80 }, (_, i) => ({ filename: `src/auth/sso-${String(i).padStart(2, '0')}.ts`, status: 'added', additions: 10, deletions: 0 }));
    const big = [...many, { filename: 'db/migrations/001-add-cancelled.js', status: 'added', additions: 5, deletions: 0 }];
    const scene = buildPullRequestImpact({ graph, repoFullName: 'acme-demo/shop-api', pull: { ...pull, additions: 805, deletions: 0 }, files: big });
    expect(validateScene(scene).ok).toBe(true);
    expect(scene.nodes.length).toBeLessThanOrEqual(150);
    expect(scene.nodes.filter((n) => n.kind === 'file')).toHaveLength(60);
    expect(scene.summary).toMatch(/60 of 81 files/);
    expect(scene.risks.map((r) => r.category).sort()).toEqual(expect.arrayContaining(['complexity', 'reliability', 'security']));
    expect(buildPullRequestImpact({ graph: { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, repoFullName: 'acme-demo/shop-api', pull, files })).toEqual(buildPullRequestImpact({ graph, repoFullName: 'acme-demo/shop-api', pull, files }));
  });

  it('works for repositories that are not indexed yet', () => {
    const scene = buildPullRequestImpact({ graph: { nodes: [], edges: [] }, repoFullName: 'acme/new', pull, files });
    expect(validateScene(scene).ok).toBe(true);
    expect(scene.nodes.filter((n) => n.change === 'added').map((n) => n.label).sort()).toEqual(['src/cancel.ts', 'src/orders.ts']);
  });
});
