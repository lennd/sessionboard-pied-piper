import type { EdgeKind, Scene, SceneNode } from './schema';

export const LEVELS = ['system', 'architecture', 'components', 'detail'] as const;
export type Level = (typeof LEVELS)[number];

export const repoBoxId = (repo: string): string => `repo:${repo}`;
const REPO_GROUP_PREFIX = 'group:';

export type SceneIndex = {
  byId: Map<string, SceneNode>;
  children: Map<string, string[]>;
  depth: Map<string, number>;
  topLevel: string[];
};

export const indexScene = (scene: Scene): SceneIndex => {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>(scene.nodes.map((n) => [n.id, []]));
  scene.nodes.forEach((n) => {
    if (n.parent) children.get(n.parent)?.push(n.id);
  });
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const parent = byId.get(id)?.parent;
    const value = parent ? depthOf(parent) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  scene.nodes.forEach((n) => depthOf(n.id));
  return { byId, children, depth, topLevel: scene.nodes.filter((n) => !n.parent).map((n) => n.id) };
};

export const ancestorsOf = (index: SceneIndex, id: string): string[] => {
  const result: string[] = [];
  let cursor = index.byId.get(id)?.parent;
  while (cursor) {
    result.push(cursor);
    cursor = index.byId.get(cursor)?.parent;
  }
  return result;
};

export const descendantsOf = (index: SceneIndex, id: string): string[] =>
  (index.children.get(id) ?? []).flatMap((child) => [child, ...descendantsOf(index, child)]);

export type VisibleModel = {
  level: Level;
  expanded: Set<string>;
  visible: Set<string>;
  repoBoxes: Map<string, string[]>;
  representative: Map<string, string>;
};

const hasChildren = (index: SceneIndex, id: string) => (index.children.get(id)?.length ?? 0) > 0;

const systemModel = (scene: Scene, index: SceneIndex): VisibleModel => {
  const repoBoxes = new Map<string, string[]>();
  const visible = new Set<string>();
  index.topLevel.forEach((id) => {
    const repo = index.byId.get(id)?.repo;
    if (!repo) {
      visible.add(id);
      return;
    }
    const box = repoBoxId(repo);
    repoBoxes.set(box, [...(repoBoxes.get(box) ?? []), id]);
  });
  const representative = new Map<string, string>();
  scene.nodes.forEach((n) => {
    const top = [n.id, ...ancestorsOf(index, n.id)].at(-1) as string;
    const repo = index.byId.get(top)?.repo;
    representative.set(n.id, repo ? repoBoxId(repo) : top);
  });
  return { level: 'system', expanded: new Set(), visible, repoBoxes, representative };
};

export const computeVisible = (
  scene: Scene,
  index: SceneIndex,
  level: Level,
  localExpanded: ReadonlySet<string>,
  localCollapsed: ReadonlySet<string> = new Set(),
): VisibleModel => {
  if (level === 'system') return systemModel(scene, index);

  const expanded = new Set<string>();
  scene.nodes.forEach((n) => {
    if (!hasChildren(index, n.id)) return;
    if (level === 'detail' || (level === 'components' && index.depth.get(n.id) === 0)) expanded.add(n.id);
  });
  localExpanded.forEach((id) => {
    if (!index.byId.has(id) || !hasChildren(index, id)) return;
    expanded.add(id);
    ancestorsOf(index, id).forEach((a) => expanded.add(a));
  });
  localCollapsed.forEach((id) => expanded.delete(id));

  const visible = new Set(scene.nodes.filter((n) => ancestorsOf(index, n.id).every((a) => expanded.has(a))).map((n) => n.id));
  const representative = new Map<string, string>();
  scene.nodes.forEach((n) => {
    const chain = [n.id, ...ancestorsOf(index, n.id)];
    representative.set(n.id, chain.find((id) => visible.has(id)) as string);
  });
  return { level, expanded, visible, repoBoxes: new Map(), representative };
};

export type ProjectedEdge = { key: string; from: string; to: string; kind: EdgeKind; label?: string; edgeIds: string[] };
export type ProjectedEdges = { edges: ProjectedEdge[]; keyOf: Map<string, string> };

export const projectEdges = (scene: Scene, model: VisibleModel): ProjectedEdges => {
  const byKey = new Map<string, ProjectedEdge>();
  const keyOf = new Map<string, string>();
  scene.edges.forEach((edge) => {
    const from = model.representative.get(edge.from);
    const to = model.representative.get(edge.to);
    if (!from || !to || from === to) return;
    const key = `${from}->${to}`;
    keyOf.set(edge.id, key);
    const existing = byKey.get(key);
    if (existing) {
      existing.edgeIds.push(edge.id);
      return;
    }
    byKey.set(key, { key, from, to, kind: edge.kind, label: edge.label, edgeIds: [edge.id] });
  });
  return { edges: [...byKey.values()], keyOf };
};

export type TopGroup = { id: string; label: string; nodeIds: string[] };

export const topLevelGroups = (scene: Scene, visibleTop: string[]): TopGroup[] => {
  const visible = new Set(visibleTop);
  if (scene.groups.length > 0) {
    return scene.groups
      .map((g) => ({ id: g.id, label: g.label, nodeIds: g.nodeIds.filter((id) => visible.has(id)) }))
      .filter((g) => g.nodeIds.length > 0);
  }
  const byRepo = new Map<string, string[]>();
  const repoOf = new Map(scene.nodes.map((n) => [n.id, n.repo]));
  visibleTop.forEach((id) => {
    const repo = repoOf.get(id);
    if (repo) byRepo.set(repo, [...(byRepo.get(repo) ?? []), id]);
  });
  return [...byRepo.entries()].map(([repo, nodeIds]) => ({ id: `${REPO_GROUP_PREFIX}${repo}`, label: repo, nodeIds }));
};
