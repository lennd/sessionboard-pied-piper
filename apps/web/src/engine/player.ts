export const STEP_DURATION_MS = 2500;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

export type PlayerState = { stepIndex: number; progress: number; playing: boolean; speed: number };

export type PlayerAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; stepIndex: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'tick'; deltaMs: number }
  | { type: 'reset' };

export const initialPlayerState: PlayerState = { stepIndex: 0, progress: 0, playing: false, speed: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const tick = (state: PlayerState, deltaMs: number, stepCount: number): PlayerState => {
  if (!state.playing) return state;
  const progress = state.progress + (deltaMs * state.speed) / STEP_DURATION_MS;
  if (progress < 1) return { ...state, progress };
  const isLast = state.stepIndex >= stepCount - 1;
  return isLast ? { ...state, progress: 1, playing: false } : { ...state, stepIndex: state.stepIndex + 1, progress: 0 };
};

export const reducePlayer = (state: PlayerState, action: PlayerAction, stepCount: number): PlayerState => {
  if (action.type === 'reset') return { ...initialPlayerState, speed: state.speed };
  if (action.type === 'setSpeed') return { ...state, speed: clamp(action.speed, MIN_SPEED, MAX_SPEED) };
  if (stepCount === 0) return state;

  const last = stepCount - 1;
  switch (action.type) {
    case 'play': {
      const atEnd = state.stepIndex >= last && state.progress >= 1;
      return atEnd ? { ...state, stepIndex: 0, progress: 0, playing: true } : { ...state, playing: true };
    }
    case 'pause':
      return { ...state, playing: false };
    case 'next':
      return { ...state, stepIndex: Math.min(state.stepIndex + 1, last), progress: 0 };
    case 'prev':
      return { ...state, stepIndex: Math.max(state.stepIndex - 1, 0), progress: 0 };
    case 'seek':
      return { ...state, stepIndex: clamp(action.stepIndex, 0, last), progress: 0 };
    case 'tick':
      return tick(state, action.deltaMs, stepCount);
  }
};
