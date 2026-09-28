import { topLevelGroups, type Scene, type SceneIndex, type SceneRisk, type Severity, type VisibleModel } from '@rdi/scene';
import { REPO_GLYPH, ROLE_GLYPHS } from '../canvas/glyphs';
import { aggregateSeverity } from '../engine/risks';

export type TreeItem = { id: string; nodeId: string | null; label: string; glyph: string; depth: number; expandable: boolean; expanded: boolean; severity?: Severity };

const REPO_PREFIX = 'repo:';

export const buildExplorerTree = (scene: Scene, index: SceneIndex, model: VisibleModel, byNode: Map<string, SceneRisk[]>): TreeItem[] => {
  const items: TreeItem[] = [];
  const nodeItem = (id: string, depth: number, allowExpand: boolean) => {
    const node = index.byId.get(id)!;
    const hasChildren = (index.children.get(id)?.length ?? 0) > 0;
    const expanded = model.expanded.has(id);
    items.push({ id, nodeId: id, label: node.label, glyph: ROLE_GLYPHS[node.role], depth, expandable: allowExpand && hasChildren, expanded, severity: aggregateSeverity(index, byNode, [id]) });
    if (expanded) (index.children.get(id) ?? []).filter((c) => model.visible.has(c)).forEach((c) => nodeItem(c, depth + 1, allowExpand));
  };
  const groupItem = (id: string, label: string) => items.push({ id, nodeId: null, label, glyph: REPO_GLYPH, depth: 0, expandable: true, expanded: true });

  if (model.level === 'system') {
    model.repoBoxes.forEach((members, box) => {
      groupItem(box, box.slice(REPO_PREFIX.length));
      members.forEach((m) => nodeItem(m, 1, false));
    });
    index.topLevel.filter((id) => model.visible.has(id)).forEach((id) => nodeItem(id, 0, false));
    return items;
  }

  const visibleTop = index.topLevel.filter((id) => model.visible.has(id));
  const groups = topLevelGroups(scene, visibleTop);
  const grouped = new Set(groups.flatMap((g) => g.nodeIds));
  groups.forEach((g) => {
    groupItem(g.id, g.label);
    g.nodeIds.forEach((id) => nodeItem(id, 1, true));
  });
  visibleTop.filter((id) => !grouped.has(id)).forEach((id) => nodeItem(id, 0, true));
  return items;
};
