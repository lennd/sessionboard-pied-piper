import { fireEvent, render, screen } from '@testing-library/react';
import { sampleSceneRegistry } from '@rdi/scene';
import { NarrationPanel } from '../src/panels/NarrationPanel';

const flow = sampleSceneRegistry['speaker-sync-flow']!;

describe('NarrationPanel', () => {
  it('lists steps, marks the current one and seeks on click', () => {
    const onSeek = vi.fn();
    render(<NarrationPanel scene={flow} stepIndex={2} onSeek={onSeek} />);
    expect(screen.getByRole('heading', { name: flow.title })).toBeInTheDocument();
    expect(screen.getByTestId('narration-step-2')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('narration-step-1')).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByTestId('narration-step-4'));
    expect(onSeek).toHaveBeenCalledWith(4);
  });

  it('explains scenes without steps', () => {
    render(<NarrationPanel scene={sampleSceneRegistry['pr-impact']!} stepIndex={0} onSeek={vi.fn()} />);
    expect(screen.getByText(/no walkthrough/i)).toBeInTheDocument();
  });
});
