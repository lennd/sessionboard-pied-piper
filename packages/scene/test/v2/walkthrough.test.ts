import { describe, expect, it } from 'vitest';
import { descendantStepIds, findStep, flattenSteps, numberSteps, stepAncestors } from '../../src/v2/index';
import { fixtureScene } from './fixture';

const { steps } = fixtureScene();

describe('walkthrough', () => {
  it('numbers steps hierarchically', () => {
    const n = numberSteps(steps);
    expect(n.get('s2')).toBe('2');
    expect(n.get('s2-1')).toBe('2.1');
    expect(n.get('s2-1-1')).toBe('2.1.1');
    expect(n.get('s3')).toBe('3');
  });

  it('flattens only open steps, depth first', () => {
    expect(flattenSteps(steps, new Set()).map((f) => f.path)).toEqual(['1', '2', '3']);
    expect(flattenSteps(steps, new Set(['s2'])).map((f) => f.path)).toEqual(['1', '2', '2.1', '2.2', '3']);
    const deep = flattenSteps(steps, new Set(['s2', 's2-1']));
    expect(deep.map((f) => f.step.id)).toEqual(['s1', 's2', 's2-1', 's2-1-1', 's2-2', 's3']);
    expect(deep[3]).toMatchObject({ depth: 2, parentId: 's2-1' });
  });

  it('skips grandchildren when the middle step is closed', () => {
    expect(flattenSteps(steps, new Set(['s2-1'])).map((f) => f.path)).toEqual(['1', '2', '3']);
  });

  it('finds steps, ancestors and descendants', () => {
    expect(findStep(steps, 's2-1-1')?.narration).toBe('lock');
    expect(findStep(steps, 'ghost')).toBeUndefined();
    expect(stepAncestors(steps, 's2-1-1')).toEqual(['s2-1', 's2']);
    expect(stepAncestors(steps, 's1')).toEqual([]);
    expect(descendantStepIds(findStep(steps, 's2')!)).toEqual(['s2-1', 's2-1-1', 's2-2']);
  });
});
