import { topLevelGroups, type ProjectedEdge, type Scene, type SceneIndex, type VisibleModel } from '@rdi/scene';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Point, Rect } from './floating';

export const PIECE_WIDTH = 232;
export const PIECE_HEIGHT = 78;
const REPO_PREFIX = 'repo:';

export type BoxKind = 'group' | 'repoBox' | 'container' | 'piece';
export type LayoutBox = Rect & { parent: string | null; kind: BoxKind; label?: string };
/** `routes` holds the orthogonal path ELK found for each edge key, in root (absolute) coordinates. */
export type SceneLayout = { boxes: Map<string, LayoutBox>; order: string[]; routes: Map<string, Point[]> };

const elk = new ELK();

const ROOT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'org.eclipse.elk.json.edgeCoords': 'ROOT',
  'elk.spacing.nodeNode': '48',
  'elk.spacing.edgeNode': '28',
  'elk.spacing.edgeEdge': '18',
  'elk.layered.spacing.nodeNodeBetweenLayers': '120',
  'elk.layered.spacing.edgeNodeBetweenLayers': '36',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.mergeEdges': 'false',
};
const COMPOUND_OPTIONS = { 'elk.padding': '[top=44,left=20,bottom=20,right=20]' };

export const layoutSignature = (sceneId: string, model: VisibleModel): string =>
  `${sceneId}|${model.level}|${[...model.expanded].sort().join(',')}`;

export const layoutScene = async (scene: Scene, index: SceneIndex, model: VisibleModel, edges: ProjectedEdge[]): Promise<SceneLayout> => {
  const kinds = new Map<string, { kind: BoxKind; label?: string }>();
  const leaf = (id: string, kind: BoxKind, label?: string): ElkNode => {
    kinds.set(id, { kind, label });
    return { id, width: PIECE_WIDTH, height: PIECE_HEIGHT };
  };
  const build = (id: string): ElkNode => {
    if (!model.expanded.has(id)) return leaf(id, 'piece');
    kinds.set(id, { kind: 'container' });
    const children = (index.children.get(id) ?? []).filter((c) => model.visible.has(c)).map(build);
    return { id, layoutOptions: COMPOUND_OPTIONS, children };
  };

  let rootChildren: ElkNode[];
  if (model.level === 'system') {
    rootChildren = [
      ...[...model.repoBoxes.keys()].map((box) => leaf(box, 'repoBox', box.slice(REPO_PREFIX.length))),
      ...index.topLevel.filter((id) => model.visible.has(id)).map(build),
    ];
  } else {
    const visibleTop = index.topLevel.filter((id) => model.visible.has(id));
    const groups = topLevelGroups(scene, visibleTop);
    const grouped = new Set(groups.flatMap((g) => g.nodeIds));
    rootChildren = [
      ...groups.map((g) => {
        kinds.set(g.id, { kind: 'group', label: g.label });
        return { id: g.id, layoutOptions: COMPOUND_OPTIONS, children: g.nodeIds.map(build) };
      }),
      ...visibleTop.filter((id) => !grouped.has(id)).map(build),
    ];
  }

  const result = await elk.layout({
    id: 'root',
    layoutOptions: ROOT_OPTIONS,
    children: rootChildren,
    edges: edges.map((e) => ({ id: e.key, sources: [e.from], targets: [e.to] })),
  });

  const boxes = new Map<string, LayoutBox>();
  const order: string[] = [];
  const routes = new Map<string, Point[]>();
  const collectRoutes = (node: ElkNode) => {
    for (const edge of node.edges ?? []) {
      const section = edge.sections?.[0];
      if (section) routes.set(edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]);
    }
    (node.children ?? []).forEach(collectRoutes);
  };
  collectRoutes(result);
  const walk = (node: ElkNode, parent: string | null) => {
    const meta = kinds.get(node.id);
    if (meta) {
      boxes.set(node.id, {
        x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? PIECE_WIDTH, height: node.height ?? PIECE_HEIGHT,
        parent, kind: meta.kind, ...(meta.label ? { label: meta.label } : {}),
      });
      order.push(node.id);
    }
    (node.children ?? []).forEach((child) => walk(child, meta ? node.id : parent));
  };
  (result.children ?? []).forEach((child) => walk(child, null));
  return { boxes, order, routes };
};

export const absoluteRect = (layout: SceneLayout, id: string): Rect | null => {
  const box = layout.boxes.get(id);
  if (!box) return null;
  const parent = box.parent ? absoluteRect(layout, box.parent) : null;
  return { x: box.x + (parent?.x ?? 0), y: box.y + (parent?.y ?? 0), width: box.width, height: box.height };
};
