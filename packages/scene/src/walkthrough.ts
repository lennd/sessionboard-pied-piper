import type { Step } from './schema';

export type FlatStep = { step: Step; path: string; depth: number; parentId: string | null };

export const numberSteps = (steps: Step[]): Map<string, string> => {
  const result = new Map<string, string>();
  const walk = (list: Step[], prefix: string) =>
    list.forEach((step, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      result.set(step.id, path);
      walk(step.substeps, path);
    });
  walk(steps, '');
  return result;
};

export const flattenSteps = (steps: Step[], open: ReadonlySet<string>): FlatStep[] => {
  const result: FlatStep[] = [];
  const walk = (list: Step[], prefix: string, depth: number, parentId: string | null) =>
    list.forEach((step, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      result.push({ step, path, depth, parentId });
      if (open.has(step.id)) walk(step.substeps, path, depth + 1, step.id);
    });
  walk(steps, '', 0, null);
  return result;
};

export const findStep = (steps: Step[], id: string): Step | undefined => {
  for (const step of steps) {
    if (step.id === id) return step;
    const nested = findStep(step.substeps, id);
    if (nested) return nested;
  }
  return undefined;
};

export const stepAncestors = (steps: Step[], id: string): string[] => {
  const search = (list: Step[], trail: string[]): string[] | null => {
    for (const step of list) {
      if (step.id === id) return trail;
      const found = search(step.substeps, [step.id, ...trail]);
      if (found) return found;
    }
    return null;
  };
  return search(steps, []) ?? [];
};

export const descendantStepIds = (step: Step): string[] =>
  step.substeps.flatMap((child) => [child.id, ...descendantStepIds(child)]);
