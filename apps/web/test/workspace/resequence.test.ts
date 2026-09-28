import { flattenSteps } from '@rdi/scene/v2';
import { resequenceCursor } from '../../src/workspace/engine/resequence';
import { fixtureScene } from './fixture';

const { steps } = fixtureScene();
const flat = (open: string[]) => flattenSteps(steps, new Set(open));

describe('resequenceCursor', () => {
  it('keeps the same step when it is still in the sequence', () => {
    expect(resequenceCursor(flat([]), flat(['s2']), 2, steps)).toBe(4);
  });

  it('moves to the nearest open ancestor when the step disappears', () => {
    const before = flat(['s2', 's2-1']);
    expect(before[3]?.step.id).toBe('s2-1-1');
    expect(resequenceCursor(before, flat(['s2']), 3, steps)).toBe(2);
    expect(resequenceCursor(before, flat([]), 3, steps)).toBe(1);
  });

  it('falls back to 0 for empty or out-of-range input', () => {
    expect(resequenceCursor([], flat([]), 0, steps)).toBe(0);
    expect(resequenceCursor(flat([]), flat([]), 99, steps)).toBe(0);
    expect(resequenceCursor(flat([]), [], 1, steps)).toBe(0);
  });
});
