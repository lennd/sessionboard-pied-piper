import type { Dispatch } from 'react';
import type { PlayerAction, PlayerState } from '../engine/player';

const SPEEDS = [0.5, 1, 2];

type PlayerControlsProps = { state: PlayerState; stepCount: number; dispatch: Dispatch<PlayerAction> };

export const PlayerControls = ({ state, stepCount, dispatch }: PlayerControlsProps) => {
  const disabled = stepCount === 0;
  const toggleLabel = state.playing ? 'Pause' : 'Play';
  return (
    <div className="player">
      <button type="button" data-testid="player-prev" aria-label="Previous step" disabled={disabled} onClick={() => dispatch({ type: 'prev' })}>
        ⏮
      </button>
      <button
        type="button"
        data-testid="player-toggle"
        aria-label={toggleLabel}
        disabled={disabled}
        onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}
      >
        {state.playing ? '⏸' : '▶'}
      </button>
      <button type="button" data-testid="player-next" aria-label="Next step" disabled={disabled} onClick={() => dispatch({ type: 'next' })}>
        ⏭
      </button>
      <input
        type="range"
        data-testid="player-scrub"
        aria-label="Step"
        min={0}
        max={Math.max(stepCount - 1, 0)}
        value={state.stepIndex}
        disabled={disabled}
        onChange={(e) => dispatch({ type: 'seek', stepIndex: Number(e.target.value) })}
      />
      <span data-testid="player-counter" className="player__counter">
        {disabled ? 'No steps' : `${state.stepIndex + 1} / ${stepCount}`}
      </span>
      <select
        data-testid="player-speed"
        aria-label="Speed"
        value={state.speed}
        onChange={(e) => dispatch({ type: 'setSpeed', speed: Number(e.target.value) })}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
};
