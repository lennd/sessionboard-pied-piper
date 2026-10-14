import type { Scene } from '@rdi/scene';
import type { Root } from '../http/scope';

const SEP = ':';
const MAX_NODES = 60;

/** Joins the cached map of each repository into one scene: ids prefixed by repository, nodes labelled with `repo`, risks and steps kept. */
export const combineMaps = (maps: { root: Root; scene: Scene }[], options: { id: string; title: string; language: string }): Scene | null => {
  if (maps.length === 0) return null;
  const prefix = (name: string, id: string) => `${name}${SEP}${id}`;
  const nodes = maps.flatMap(({ root, scene }) =>
    scene.nodes.map((n) => ({
      ...n,
      id: prefix(root.name, n.id),
      ...(n.parent ? { parent: prefix(root.name, n.parent) } : {}),
      repo: root.name,
      ...(n.code ? { code: { ...n.code, repo: root.name } } : {}),
      ...(n.graphRef ? { graphRef: prefix(root.name, n.graphRef) } : {}),
    })),
  );
  const edges = maps.flatMap(({ root, scene }) => (scene.edges ?? []).map((e) => ({ ...e, id: prefix(root.name, e.id), from: prefix(root.name, e.from), to: prefix(root.name, e.to) })));
  const risks = maps.flatMap(({ root, scene }) => (scene.risks ?? []).map((r) => ({ ...r, id: prefix(root.name, r.id), nodeIds: r.nodeIds.map((id) => prefix(root.name, id)) })));
  const steps = maps.flatMap(({ root, scene }) =>
    (scene.steps ?? []).map((s) => ({
      ...s,
      id: prefix(root.name, s.id),
      focus: (s.focus ?? []).map((id) => prefix(root.name, id)),
      highlight: (s.highlight ?? []).map((id) => prefix(root.name, id)),
      annotate: (s.annotate ?? []).map((a) => ({ ...a, nodeId: prefix(root.name, a.nodeId) })),
      ...(s.travel ? { travel: { ...s.travel, edgeId: prefix(root.name, s.travel.edgeId) } } : {}),
      substeps: [],
    })),
  );
  return {
    id: options.id,
    title: options.title,
    language: options.language,
    summary: `Architecture of ${maps.map((m) => m.root.name).join(', ')} side by side.`,
    nodes: nodes.slice(0, MAX_NODES),
    edges: edges.filter((e) => nodes.slice(0, MAX_NODES).some((n) => n.id === e.from) && nodes.slice(0, MAX_NODES).some((n) => n.id === e.to)),
    groups: [],
    steps,
    risks,
  };
};
