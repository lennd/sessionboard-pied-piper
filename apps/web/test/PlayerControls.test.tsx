import { fireEvent, render, screen } from '@testing-library/react';
import { initialPlayerState } from '../src/engine/player';
import { PlayerControls } from '../src/panels/PlayerControls';

describe('PlayerControls', () => {
  it('shows a 1-based counter and dispatches actions', () => {
    const dispatch = vi.fn();
    render(<PlayerControls state={{ ...initialPlayerState, stepIndex: 1 }} stepCount={6} dispatch={dispatch} />);
    expect(screen.getByTestId('player-counter')).toHaveTextContent('2 / 6');
    fireEvent.click(screen.getByTestId('player-toggle'));
    fireEvent.click(screen.getByTestId('player-next'));
    fireEvent.click(screen.getByTestId('player-prev'));
    fireEvent.change(screen.getByTestId('player-scrub'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('player-speed'), { target: { value: '2' } });
    expect(dispatch.mock.calls.map(([a]) => a)).toEqual([
      { type: 'play' },
      { type: 'next' },
      { type: 'prev' },
      { type: 'seek', stepIndex: 4 },
      { type: 'setSpeed', speed: 2 },
    ]);
  });

  it('shows pause while playing', () => {
    render(<PlayerControls state={{ ...initialPlayerState, playing: true }} stepCount={3} dispatch={vi.fn()} />);
    expect(screen.getByTestId('player-toggle')).toHaveAccessibleName('Pause');
  });

  it('is disabled for scenes without steps', () => {
    render(<PlayerControls state={initialPlayerState} stepCount={0} dispatch={vi.fn()} />);
    expect(screen.getByTestId('player-toggle')).toBeDisabled();
    expect(screen.getByTestId('player-next')).toBeDisabled();
    expect(screen.getByTestId('player-scrub')).toBeDisabled();
    expect(screen.getByTestId('player-counter')).toHaveTextContent('No steps');
  });
});
