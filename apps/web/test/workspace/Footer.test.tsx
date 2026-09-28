import { fireEvent, render, screen } from '@testing-library/react';
import { initialPlayerState } from '../../src/engine/player';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { Footer } from '../../src/workspace/panels/Footer';

const renderFooter = (stepCount: number, path: string | null, stepIndex = 0) => {
  const dispatch = vi.fn();
  render(<I18nProvider initialLanguage="en"><Footer state={{ ...initialPlayerState, stepIndex }} stepCount={stepCount} path={path} dispatch={dispatch} /></I18nProvider>);
  return dispatch;
};

describe('Footer', () => {
  it('shows the hierarchical path and dispatches player actions', () => {
    const dispatch = renderFooter(6, '3.1', 3);
    expect(screen.getByTestId('player-counter')).toHaveTextContent('Step 3.1 · 4 / 6');
    fireEvent.click(screen.getByTestId('player-toggle'));
    fireEvent.click(screen.getByTestId('player-next'));
    fireEvent.change(screen.getByTestId('player-scrub'), { target: { value: '5' } });
    expect(dispatch.mock.calls.map(([a]) => a)).toEqual([{ type: 'play' }, { type: 'next' }, { type: 'seek', stepIndex: 5 }]);
  });

  it('is disabled without steps', () => {
    renderFooter(0, null);
    expect(screen.getByTestId('player-toggle')).toBeDisabled();
    expect(screen.getByTestId('player-scrub')).toBeDisabled();
    expect(screen.getByTestId('player-counter')).toHaveTextContent('No steps');
  });
});
