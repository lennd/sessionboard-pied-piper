import type { Scene, SceneStep } from '@rdi/scene';

export type Frame = {
  step: SceneStep | null;
  stepIndex: number;
  focused: Set<string>;
  highlighted: Set<string>;
  activeEdgeId: string | null;
  tokenLabel: string | null;
  visitedEdgeIds: Set<string>;
  annotations: Record<string, string>;
};

const emptyFrame = (): Frame => ({
  step: null,
  stepIndex: 0,
  focused: new Set(),
  highlighted: new Set(),
  activeEdgeId: null,
  tokenLabel: null,
  visitedEdgeIds: new Set(),
  annotations: {},
});

export const frameAt = (scene: Scene, stepIndex: number): Frame => {
  if (scene.steps.length === 0) return emptyFrame();
  const index = Math.min(Math.max(stepIndex, 0), scene.steps.length - 1);
  const step = scene.steps[index] as SceneStep;
  const visited = scene.steps
    .slice(0, index)
    .flatMap((s) => (s.travel ? [s.travel.edgeId] : []));
  return {
    step,
    stepIndex: index,
    focused: new Set(step.focus),
    highlighted: new Set(step.highlight),
    activeEdgeId: step.travel?.edgeId ?? null,
    tokenLabel: step.travel?.payload ?? null,
    visitedEdgeIds: new Set(visited),
    annotations: Object.fromEntries(step.annotate.map((a) => [a.nodeId, a.text])),
  };
};
