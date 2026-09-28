import { fireEvent, render, screen } from '@testing-library/react';
import { flattenSteps, numberSteps } from '@rdi/scene';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { WalkthroughTree } from '../../src/workspace/panels/WalkthroughTree';
import { fixtureScene } from './fixture';

const { steps } = fixtureScene();
const renderTree = (open: string[], cursor: number, handlers = { onSeek: vi.fn(), onToggle: vi.fn() }) => {
  render(
    <I18nProvider initialLanguage="en">
      <WalkthroughTree steps={steps} numbering={numberSteps(steps)} flat={flattenSteps(steps, new Set(open))} cursor={cursor} openSteps={open} {...handlers} />
    </I18nProvider>,
  );
  return handlers;
};

describe('WalkthroughTree', () => {
  it('marks done and current steps and hides closed sub-steps', () => {
    renderTree([], 1);
    expect(screen.getByTestId('step-s1')).toHaveClass('is-done');
    expect(screen.getByTestId('step-s2')).toHaveClass('is-current');
    expect(screen.queryByTestId('step-s2-1')).toBeNull();
    expect(screen.getByTestId('step-toggle-s2')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows open sub-steps with their numbering and seeks on click', () => {
    const { onSeek, onToggle } = renderTree(['s2'], 0);
    expect(screen.getByTestId('step-s2-1')).toHaveTextContent('2.1');
    fireEvent.click(screen.getByTestId('step-s2-2'));
    expect(onSeek).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByTestId('step-toggle-s2'));
    expect(onToggle).toHaveBeenCalledWith('s2');
  });

  it('explains empty walkthroughs', () => {
    render(<I18nProvider initialLanguage="en"><WalkthroughTree steps={[]} numbering={new Map()} flat={[]} cursor={0} openSteps={[]} onSeek={vi.fn()} onToggle={vi.fn()} /></I18nProvider>);
    expect(screen.getByText('This scene has no walkthrough.')).toBeInTheDocument();
  });
});
