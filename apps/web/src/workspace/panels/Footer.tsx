import type { Dispatch } from 'react';
import type { PlayerAction, PlayerState } from '../../engine/player';
import { useI18n } from '../../i18n/I18nProvider';

const SPEEDS = [0.5, 1, 2];

type FooterProps = { state: PlayerState; stepCount: number; path: string | null; dispatch: Dispatch<PlayerAction> };

export const Footer = ({ state, stepCount, path, dispatch }: FooterProps) => {
  const { t } = useI18n();
  const disabled = stepCount === 0;
  return (
    <footer className="ws-footer">
      <div className="player">
        <button type="button" data-testid="player-prev" aria-label={t('player.prev')} disabled={disabled} onClick={() => dispatch({ type: 'prev' })}>⏮</button>
        <button type="button" data-testid="player-toggle" aria-label={state.playing ? t('player.pause') : t('player.play')} disabled={disabled} onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}>
          {state.playing ? '⏸' : '▶'}
        </button>
        <button type="button" data-testid="player-next" aria-label={t('player.next')} disabled={disabled} onClick={() => dispatch({ type: 'next' })}>⏭</button>
        <input type="range" data-testid="player-scrub" aria-label={t('player.step')} min={0} max={Math.max(stepCount - 1, 0)} value={state.stepIndex} disabled={disabled} onChange={(e) => dispatch({ type: 'seek', stepIndex: Number(e.target.value) })} />
        <span className="player__counter" data-testid="player-counter">
          {disabled ? t('player.noSteps') : t('player.progress', { path: path ?? '', index: state.stepIndex + 1, total: stepCount })}
        </span>
        <select data-testid="player-speed" aria-label={t('player.speed')} value={state.speed} onChange={(e) => dispatch({ type: 'setSpeed', speed: Number(e.target.value) })}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
    </footer>
  );
};
