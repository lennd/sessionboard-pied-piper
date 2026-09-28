import type { FlatStep, ProjectedEdges, VisibleModel } from '@rdi/scene';

export type ActiveEdge = { key: string; reverse: boolean; label: string | null };

export type Frame = {
  flat: FlatStep | null;
  index: number;
  focused: Set<string>;
  highlighted: Set<string>;
  active: ActiveEdge | null;
  visited: Set<string>;
  annotations: Map<string, string>;
};

const ANNOTATION_SEPARATOR = ' · ';

const emptyFrame = (): Frame => ({ flat: null, index: 0, focused: new Set(), highlighted: new Set(), active: null, visited: new Set(), annotations: new Map() });

export const frameAt = (model: VisibleModel, projected: ProjectedEdges, flat: FlatStep[], cursor: number): Frame => {
  if (flat.length === 0) return emptyFrame();
  const index = Math.min(Math.max(cursor, 0), flat.length - 1);
  const current = flat[index] as FlatStep;
  const project = (id: string) => model.representative.get(id) ?? id;
  const { step } = current;

  const annotations = new Map<string, string>();
  step.annotate.forEach(({ nodeId, text }) => {
    const target = project(nodeId);
    const existing = annotations.get(target);
    annotations.set(target, existing ? `${existing}${ANNOTATION_SEPARATOR}${text}` : text);
  });

  const key = step.travel ? projected.keyOf.get(step.travel.edgeId) : undefined;
  const visited = new Set(
    flat.slice(0, index).flatMap((f) => {
      const k = f.step.travel ? projected.keyOf.get(f.step.travel.edgeId) : undefined;
      return k ? [k] : [];
    }),
  );

  return {
    flat: current,
    index,
    focused: new Set(step.focus.map(project)),
    highlighted: new Set(step.highlight.map(project)),
    active: key && step.travel ? { key, reverse: step.travel.reverse, label: step.travel.payload ?? null } : null,
    visited,
    annotations,
  };
};
