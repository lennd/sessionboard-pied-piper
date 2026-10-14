// @vitest-environment node
import { computeVisible, indexScene, projectEdges } from '@rdi/scene';
import { absoluteRect, layoutScene, layoutSignature, PIECE_HEIGHT, PIECE_WIDTH } from '../../src/workspace/canvas/layout';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const run = async (level: Parameters<typeof computeVisible>[2]) => {
  const model = computeVisible(scene, index, level, new Set());
  return { model, layout: await layoutScene(scene, index, model, projectEdges(scene, model).edges) };
};

describe('layoutScene', () => {
  it('nests repo groups, containers and pieces with parents first', async () => {
    const { layout } = await run('components');
    expect(layout.boxes.get('group:svc')).toMatchObject({ kind: 'group', parent: null, label: 'svc' });
    expect(layout.boxes.get('worker')).toMatchObject({ kind: 'container', parent: 'group:svc' });
    expect(layout.boxes.get('reserve')).toMatchObject({ kind: 'piece', parent: 'worker', width: PIECE_WIDTH, height: PIECE_HEIGHT });
    expect(layout.boxes.get('pay')).toMatchObject({ kind: 'piece', parent: null });
    expect(layout.order.indexOf('group:svc')).toBeLessThan(layout.order.indexOf('worker'));
    expect(layout.order.indexOf('worker')).toBeLessThan(layout.order.indexOf('reserve'));
    expect(layout.boxes.get('worker')!.width).toBeGreaterThan(PIECE_WIDTH);
  });

  it('lays out left to right in absolute coordinates', async () => {
    const { layout } = await run('architecture');
    expect(absoluteRect(layout, 'client')!.x).toBeLessThan(absoluteRect(layout, 'api')!.x);
    expect(absoluteRect(layout, 'api')!.x).toBeLessThan(absoluteRect(layout, 'worker')!.x);
    expect(absoluteRect(layout, 'ghost')).toBeNull();
  });

  it('draws repo boxes at system level without groups', async () => {
    const { layout } = await run('system');
    expect(layout.boxes.get('repo:svc')).toMatchObject({ kind: 'repoBox', parent: null, label: 'svc' });
    expect([...layout.boxes.values()].some((b) => b.kind === 'group')).toBe(false);
  });

  it('returns an orthogonal route in absolute coordinates for every edge', async () => {
    const { layout, model } = await run('architecture');
    const edges = projectEdges(scene, model).edges;
    expect(layout.routes.size).toBe(edges.length);
    const route = layout.routes.get(edges[0]!.key)!;
    expect(route.length).toBeGreaterThanOrEqual(2);
    const from = absoluteRect(layout, edges[0]!.from)!;
    expect(Math.round(route[0]!.x)).toBe(Math.round(from.x + from.width));
  });

  it('produces a signature that changes with level and expansion', () => {
    const a = layoutSignature('fx', computeVisible(scene, index, 'architecture', new Set()));
    const b = layoutSignature('fx', computeVisible(scene, index, 'architecture', new Set(['worker'])));
    expect(a).not.toBe(b);
  });
});
