import { fireEvent, render, screen } from '@testing-library/react';
import { sampleScenes } from '@rdi/scene';
import { SceneTabs } from '../src/panels/SceneTabs';

describe('SceneTabs', () => {
  it('renders one tab per scene and selects on click', () => {
    const onSelect = vi.fn();
    render(<SceneTabs scenes={sampleScenes} activeId="speaker-sync-flow" onSelect={onSelect} />);
    expect(screen.getAllByRole('tab')).toHaveLength(sampleScenes.length);
    expect(screen.getByTestId('tab-speaker-sync-flow')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('tab-pr-impact'));
    expect(onSelect).toHaveBeenCalledWith('pr-impact');
  });
});
