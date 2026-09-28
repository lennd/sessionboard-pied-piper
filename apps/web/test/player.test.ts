import { initialPlayerState, reducePlayer, STEP_DURATION_MS, type PlayerState } from '../src/engine/player';

const at = (patch: Partial<PlayerState>): PlayerState => ({ ...initialPlayerState, ...patch });

describe('reducePlayer', () => {
  it('starts paused at step 0', () => {
    expect(initialPlayerState).toEqual({ stepIndex: 0, progress: 0, playing: false, speed: 1 });
  });

  it('advances progress on tick and moves to the next step', () => {
    const half = reducePlayer(at({ playing: true }), { type: 'tick', deltaMs: STEP_DURATION_MS / 2 }, 3);
    expect(half).toMatchObject({ stepIndex: 0, progress: 0.5 });
    const next = reducePlayer(half, { type: 'tick', deltaMs: STEP_DURATION_MS }, 3);
    expect(next).toMatchObject({ stepIndex: 1, progress: 0, playing: true });
  });

  it('honours speed', () => {
    const s = reducePlayer(at({ playing: true, speed: 2 }), { type: 'tick', deltaMs: STEP_DURATION_MS / 4 }, 3);
    expect(s.progress).toBeCloseTo(0.5);
  });

  it('stops at the end of the last step', () => {
    const s = reducePlayer(at({ playing: true, stepIndex: 2, progress: 0.9 }), { type: 'tick', deltaMs: STEP_DURATION_MS }, 3);
    expect(s).toMatchObject({ stepIndex: 2, progress: 1, playing: false });
  });

  it('restarts from the beginning when play is pressed at the end', () => {
    expect(reducePlayer(at({ stepIndex: 2, progress: 1 }), { type: 'play' }, 3)).toMatchObject({ stepIndex: 0, progress: 0, playing: true });
  });

  it('ignores tick while paused', () => {
    const s = at({ progress: 0.3 });
    expect(reducePlayer(s, { type: 'tick', deltaMs: 1000 }, 3)).toBe(s);
  });

  it('clamps next, prev and seek', () => {
    expect(reducePlayer(at({ stepIndex: 2 }), { type: 'next' }, 3).stepIndex).toBe(2);
    expect(reducePlayer(at({ stepIndex: 0 }), { type: 'prev' }, 3).stepIndex).toBe(0);
    expect(reducePlayer(at({}), { type: 'seek', stepIndex: 99 }, 3)).toMatchObject({ stepIndex: 2, progress: 0 });
    expect(reducePlayer(at({}), { type: 'seek', stepIndex: -4 }, 3).stepIndex).toBe(0);
  });

  it('clamps speed', () => {
    expect(reducePlayer(at({}), { type: 'setSpeed', speed: 10 }, 3).speed).toBe(4);
    expect(reducePlayer(at({}), { type: 'setSpeed', speed: 0 }, 3).speed).toBe(0.25);
  });

  it('does nothing useful with zero steps', () => {
    expect(reducePlayer(initialPlayerState, { type: 'play' }, 0)).toEqual(initialPlayerState);
    expect(reducePlayer(initialPlayerState, { type: 'next' }, 0)).toEqual(initialPlayerState);
    expect(reducePlayer(initialPlayerState, { type: 'seek', stepIndex: 3 }, 0)).toEqual(initialPlayerState);
  });

  it('resets', () => {
    expect(reducePlayer(at({ stepIndex: 2, playing: true, speed: 2 }), { type: 'reset' }, 3)).toEqual({ ...initialPlayerState, speed: 2 });
  });
});
