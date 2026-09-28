import { computeVisible, flattenSteps, indexScene, projectEdges } from '@rdi/scene';
import { layoutScene } from '../../src/workspace/canvas/layout';
import { toFlow, type ContainerData, type FlowEdgeData, type PieceData } from '../../src/workspace/canvas/toFlow';
import { frameAt } from '../../src/workspace/engine/frame';
import { stepPhase } from '../../src/workspace/engine/phase';
import { risksByNode } from '../../src/workspace/engine/risks';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const byNode = risksByNode(scene);

const build = async (opts: { level?: Parameters<typeof computeVisible>[2]; cursor?: number; progress?: number; mode?: 'walkthrough' | 'risks' | 'changes'; riskId?: string; overlay?: boolean; selected?: string | null } = {}) => {
  const model = computeVisible(scene, index, opts.level ?? 'architecture', new Set());
  const projected = projectEdges(scene, model);
  const layout = await layoutScene(scene, index, model, projected.edges);
  const frame = frameAt(model, projected, flattenSteps(scene.steps, new Set()), opts.cursor ?? 0);
  return toFlow({
    scene, index, model, projected, layout, frame, phase: stepPhase(opts.progress ?? 0, frame.active !== null),
    mode: opts.mode ?? 'walkthrough', selectedNodeId: opts.selected ?? null,
    selectedRisk: scene.risks.find((r) => r.id === opts.riskId) ?? null, scaleOverlay: opts.overlay ?? false, byNode,
  });
};
const data = (nodes: Awaited<ReturnType<typeof build>>['nodes'], id: string) => nodes.find((n) => n.id === id)!.data as PieceData;

describe('toFlow', () => {
  it('emits groups before children with parent links and node types', async () => {
    const { nodes } = await build({ level: 'components' });
    const ids = nodes.map((n) => n.id);
    expect(ids.indexOf('group:svc')).toBeLessThan(ids.indexOf('worker'));
    expect(nodes.find((n) => n.id === 'worker')).toMatchObject({ type: 'container', parentId: 'group:svc', extent: 'parent' });
    expect(nodes.find((n) => n.id === 'reserve')).toMatchObject({ type: 'piece', parentId: 'worker' });
    expect(nodes.find((n) => n.id === 'group:svc')!.type).toBe('group-box');
  });

  it('marks focus, dimming, activation and the travelling token', async () => {
    const travelling = await build({ cursor: 0, progress: 0.2 });
    expect(data(travelling.nodes, 'api')).toMatchObject({ state: 'focused', active: false });
    expect(data(travelling.nodes, 'db').state).toBe('dim');
    const edge = travelling.edges.find((e) => e.id === 'client->api')!.data as FlowEdgeData;
    expect(edge).toMatchObject({ active: true, tokenLabel: 'POST' });
    expect(edge.tokenProgress).toBeCloseTo(0.2 / 0.55);
    const arrived = await build({ cursor: 0, progress: 0.9 });
    expect(data(arrived.nodes, 'api').active).toBe(true);
    expect((arrived.edges.find((e) => e.id === 'client->api')!.data as FlowEdgeData).tokenProgress).toBeNull();
  });

  it('aggregates risk severity and hidden children on collapsed pieces', async () => {
    const { nodes } = await build();
    expect(data(nodes, 'worker')).toMatchObject({ severity: 'high', hiddenChildren: 2 });
    expect(data(nodes, 'api').severity).toBe('critical');
  });

  it('highlights risk pieces in risks mode and changed pieces in changes mode', async () => {
    const risks = await build({ mode: 'risks', riskId: 'r1' });
    expect(data(risks.nodes, 'worker').state).toBe('focused');
    expect(data(risks.nodes, 'api').state).toBe('dim');
    const changes = await build({ mode: 'changes' });
    expect(data(changes.nodes, 'api')).toMatchObject({ state: 'normal', change: 'modified' });
    expect(data(changes.nodes, 'db').state).toBe('dim');
  });

  it('exposes scale only with the overlay and marks selection through representatives', async () => {
    expect(data((await build()).nodes, 'api').scaleWorst).toBeUndefined();
    const withOverlay = await build({ overlay: true, selected: 'lock' });
    expect(data(withOverlay.nodes, 'api').scaleWorst).toBe('saturated');
    expect(data(withOverlay.nodes, 'worker').selected).toBe(true);
  });

  it('renders repo boxes at system level', async () => {
    const { nodes, edges } = await build({ level: 'system' });
    expect(data(nodes, 'repo:svc')).toMatchObject({ glyph: '▣', label: 'svc', hiddenChildren: 3 });
    expect(edges.map((e) => e.id)).toEqual(['repo:web->repo:svc', 'repo:svc->pay']);
    expect((nodes.find((n) => n.id === 'repo:svc')!.data as ContainerData).severity).toBe('critical');
  });
});
