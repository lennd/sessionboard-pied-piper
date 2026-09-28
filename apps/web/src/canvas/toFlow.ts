import type { LoadResult, NodeLoad, Scene, SceneEdge, SceneNode } from '@rdi/scene';
import type { Edge, Node } from '@xyflow/react';
import type { Frame } from '../engine/frame';
import type { SceneLayout } from './layout';

export type NodeVisualState = 'normal' | 'focused' | 'highlighted' | 'dim';

export type SceneNodeData = { node: SceneNode; state: NodeVisualState; annotation?: string; load?: NodeLoad; zoomable: boolean };

export type SceneEdgeData = {
  kind: SceneEdge['kind'];
  label?: string;
  active: boolean;
  visited: boolean;
  tokenLabel: string | null;
  progress: number;
};

type ToFlowInput = { scene: Scene; layout: SceneLayout; frame: Frame; progress: number; load?: LoadResult };

const visualState = (scene: Scene, node: SceneNode, frame: Frame): NodeVisualState => {
  if (frame.focused.has(node.id)) return 'focused';
  if (frame.highlighted.has(node.id)) return 'highlighted';
  if (frame.focused.size > 0) return 'dim';
  if (scene.kind === 'diff-impact' && !node.meta.change) return 'dim';
  return 'normal';
};

export const toFlow = ({ scene, layout, frame, progress, load }: ToFlowInput): { nodes: Node[]; edges: Edge[] } => {
  const groups: Node[] = scene.groups.map((g) => {
    const box = layout.groups[g.id] ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      id: g.id,
      type: 'sceneGroup',
      position: { x: box.x, y: box.y },
      data: { label: g.label },
      style: { width: box.width, height: box.height },
      className: 'scene-group',
      selectable: false,
    };
  });

  const nodes: Node[] = scene.nodes.map((node) => {
    const box = layout.nodes[node.id] ?? { x: 0, y: 0, width: 0, height: 0 };
    const data: SceneNodeData = {
      node,
      state: visualState(scene, node, frame),
      annotation: frame.annotations[node.id],
      load: load?.nodes[node.id],
      zoomable: Boolean(scene.zoom?.[node.id]),
    };
    return {
      id: node.id,
      type: 'scene',
      position: { x: box.x, y: box.y },
      data,
      ...(box.parentId ? { parentId: box.parentId, extent: 'parent' as const } : {}),
    };
  });

  const edges: Edge[] = scene.edges.map((edge) => {
    const active = frame.activeEdgeId === edge.id;
    const data: SceneEdgeData = {
      kind: edge.kind,
      label: edge.label,
      active,
      visited: frame.visitedEdgeIds.has(edge.id),
      tokenLabel: active ? frame.tokenLabel : null,
      progress: active ? progress : 0,
    };
    return { id: edge.id, source: edge.from, target: edge.to, type: 'scene', data };
  });

  return { nodes: [...groups, ...nodes], edges };
};
