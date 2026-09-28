import type { Scene } from '@rdi/scene';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 72;

export type Box = { x: number; y: number; width: number; height: number };
export type SceneLayout = { nodes: Record<string, Box & { parentId?: string }>; groups: Record<string, Box> };

const elk = new ELK();

const ROOT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
};
const GROUP_OPTIONS = { 'elk.padding': '[top=40,left=20,bottom=20,right=20]' };

const leaf = (id: string): ElkNode => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT });

const boxOf = (n: ElkNode): Box => ({ x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? NODE_WIDTH, height: n.height ?? NODE_HEIGHT });

export const layoutScene = async (scene: Scene): Promise<SceneLayout> => {
  const grouped = new Set(scene.groups.flatMap((g) => g.nodeIds));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: ROOT_OPTIONS,
    children: [
      ...scene.groups.map((g) => ({ id: g.id, layoutOptions: GROUP_OPTIONS, children: g.nodeIds.map(leaf) })),
      ...scene.nodes.filter((n) => !grouped.has(n.id)).map((n) => leaf(n.id)),
    ],
    edges: scene.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };

  const result = await elk.layout(graph);
  const layout: SceneLayout = { nodes: {}, groups: {} };
  const groupIds = new Set(scene.groups.map((g) => g.id));
  (result.children ?? []).forEach((child) => {
    if (!groupIds.has(child.id)) {
      layout.nodes[child.id] = boxOf(child);
      return;
    }
    layout.groups[child.id] = boxOf(child);
    (child.children ?? []).forEach((inner) => {
      layout.nodes[inner.id] = { ...boxOf(inner), parentId: child.id };
    });
  });
  return layout;
};
