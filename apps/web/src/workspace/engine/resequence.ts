import { stepAncestors, type FlatStep, type Step } from '@rdi/scene/v2';

export const resequenceCursor = (prev: FlatStep[], next: FlatStep[], cursor: number, steps: Step[]): number => {
  const current = prev[cursor]?.step.id;
  if (!current || next.length === 0) return 0;
  const indexOf = (id: string) => next.findIndex((f) => f.step.id === id);
  const direct = indexOf(current);
  if (direct >= 0) return direct;
  const ancestor = stepAncestors(steps, current).map(indexOf).find((i) => i >= 0);
  return ancestor ?? 0;
};
