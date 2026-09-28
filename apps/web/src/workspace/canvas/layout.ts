import { topLevelGroups, type ProjectedEdge, type Scene, type SceneIndex, type VisibleModel } from '@rdi/scene';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Rect } from './floating';

export const PIECE_WIDTH = 190;
export const PIECE_HEIGHT = 64;
const REPO_PREFIX = 'repo:';

export type BoxKind = 'group' | 'repoBox' | 'container' | 'piece';
export type LayoutBox = Rect & { parent: string | null; kind: BoxKind; label?: string };
export type SceneLayout = { boxes: Map<string, LayoutBox>; order: string[] };

const elk = new ELK();

const ROOT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': '36',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
};
const COMPOUND_OPTIONS = { 'elk.padding': '[top=40,left=18,bottom=18,right=18]' };

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
  return { boxes, order };
};

export const absoluteRect = (layout: SceneLayout, id: string): Rect | null => {
  const box = layout.boxes.get(id);
  if (!box) return null;
  const parent = box.parent ? absoluteRect(layout, box.parent) : null;
  return { x: box.x + (parent?.x ?? 0), y: box.y + (parent?.y ?? 0), width: box.width, height: box.height };
};
