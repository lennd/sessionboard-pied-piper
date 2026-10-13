import type { Scene, SceneNode, SceneRisk } from '@rdi/scene';
import type { TouchedFile } from '../observer/parse';

const MAX_IMPACT_RISKS = 12;
const ROOT = '.';

const dirname = (path: string) => {
  const index = path.lastIndexOf('/');
  return index === -1 ? ROOT : path.slice(0, index);
};
const normalize = (path: string) => path.replace(/^\.\//, '').replace(/\/+$/, '');

/** Which touched file matches a piece: the same file, a file inside a directory reference, or a sibling in the same (non-root) folder. */
export const matchNode = (node: SceneNode, touched: TouchedFile[]): TouchedFile | null => {
  if (!node.code?.path) return null;
  const nodePath = normalize(node.code.path);
  const dir = dirname(nodePath);
  return (
    touched.find((t) => normalize(t.path) === nodePath) ??
    touched.find((t) => normalize(t.path).startsWith(`${nodePath}/`)) ??
    (dir === ROOT ? null : touched.find((t) => dirname(normalize(t.path)) === dir)) ??
    null
  );
};

/** Marks the pieces of a system map touched by a set of file changes and flags their neighbours as at risk. Pure; the input scene is not modified. */
export const overlayChanges = (map: Scene, touched: TouchedFile[], options: { id: string; title: string; summary?: string }): Scene => {
  const changed = new Map<string, TouchedFile>();
  for (const node of map.nodes) {
    const hit = matchNode(node, touched);
    if (hit) changed.set(node.id, hit);
  }
  for (const node of map.nodes) {
    if (node.parent && changed.has(node.id) && !changed.has(node.parent)) changed.set(node.parent, { path: changed.get(node.id)!.path, change: 'modified' });
  }
  const label = new Map(map.nodes.map((n) => [n.id, n.label]));
  const neighbours = new Map<string, Set<string>>();
  for (const edge of map.edges) {
    const pairs: [string, string][] = [[edge.from, edge.to], [edge.to, edge.from]];
    for (const [a, b] of pairs) {
      if (changed.has(a) && !changed.has(b)) neighbours.set(b, new Set([...(neighbours.get(b) ?? []), a]));
    }
  }
  const risks: SceneRisk[] = [...neighbours]
    .slice(0, MAX_IMPACT_RISKS)
    .map(([nodeId, sources]) => ({
      id: `impact-${nodeId}`,
      title: `${label.get(nodeId) ?? nodeId} depends on changed pieces`,
      category: 'reliability',
      severity: 'low',
      explanation: `${label.get(nodeId) ?? nodeId} is connected to ${[...sources].map((s) => label.get(s) ?? s).join(', ')}, which changed in this session.`,
      nodeIds: [nodeId],
      mitigation: 'Re-run the flows that pass through this piece.',
    }));
  return {
    ...map,
    id: options.id,
    title: options.title,
    ...(options.summary ? { summary: options.summary } : {}),
    nodes: map.nodes.map((n) => {
      const hit = changed.get(n.id);
      if (!hit) return n.change === undefined ? n : { ...n, change: undefined };
      return { ...n, change: hit.change === 'added' && n.code?.path && normalize(n.code.path) === normalize(hit.path) ? 'added' : hit.change === 'removed' ? 'removed' : 'modified' };
    }),
    risks: [...map.risks.filter((r) => !r.id.startsWith('impact-')), ...risks],
  };
};
