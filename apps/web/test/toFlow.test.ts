import { sampleSceneRegistry, simulateLoad } from '@rdi/scene';
import { frameAt } from '../src/engine/frame';
import { layoutScene } from '../src/canvas/layout';
import { toFlow, type SceneEdgeData, type SceneNodeData } from '../src/canvas/toFlow';

const nodeData = (nodes: ReturnType<typeof toFlow>['nodes'], id: string) =>
  nodes.find((n) => n.id === id)!.data as SceneNodeData;

describe('toFlow', () => {
  it('puts group nodes before their children with relative positions', async () => {
    const scene = sampleSceneRegistry['speaker-sync-flow']!;
    const layout = await layoutScene(scene);
    const { nodes } = toFlow({ scene, layout, frame: frameAt(scene, 0), progress: 0 });
    const groupIndex = nodes.findIndex((n) => n.id === 'g-api');
    const workerIndex = nodes.findIndex((n) => n.id === 'worker');
    expect(groupIndex).toBeLessThan(workerIndex);
    expect(nodes[workerIndex]).toMatchObject({ parentId: 'g-api', extent: 'parent', type: 'scene' });
    expect(nodes[groupIndex]!.type).toBe('sceneGroup');
  });

  it('marks focused, highlighted and dimmed nodes, zoomability and annotations', async () => {
    const scene = sampleSceneRegistry['speaker-sync-flow']!;
    const layout = await layoutScene(scene);
    const { nodes, edges } = toFlow({ scene, layout, frame: frameAt(scene, 4), progress: 0.5 });
    expect(nodeData(nodes, 'cvent').state).toBe('focused');
    expect(nodeData(nodes, 'worker').state).toBe('highlighted');
    expect(nodeData(nodes, 'speakers').state).toBe('dim');
    expect(nodeData(nodes, 'worker').zoomable).toBe(true);
    const active = edges.find((e) => e.id === 'k-c')!.data as SceneEdgeData;
    expect(active).toMatchObject({ active: true, progress: 0.5, tokenLabel: 'page 1..n' });
    expect((edges.find((e) => e.id === 'o-w')!.data as SceneEdgeData).visited).toBe(true);
  });

  it('dims unchanged nodes in diff-impact scenes', async () => {
    const scene = sampleSceneRegistry['pr-impact']!;
    const layout = await layoutScene(scene);
    const { nodes } = toFlow({ scene, layout, frame: frameAt(scene, 0), progress: 0 });
    expect(nodeData(nodes, 'web').state).toBe('dim');
    expect(nodeData(nodes, 'speaker-mapper').state).toBe('normal');
  });

  it('attaches load results to nodes', async () => {
    const scene = sampleSceneRegistry['speaker-sync-load']!;
    const layout = await layoutScene(scene);
    const load = simulateLoad(scene, 20);
    const { nodes } = toFlow({ scene, layout, frame: frameAt(scene, 0), progress: 0, load });
    expect(nodeData(nodes, 'queue').load?.saturated).toBe(true);
  });
});
