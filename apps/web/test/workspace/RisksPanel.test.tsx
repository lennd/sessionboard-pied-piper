import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { RisksPanel } from '../../src/workspace/panels/RisksPanel';
import { fixtureScene } from './fixture';

const scene = fixtureScene();

describe('RisksPanel', () => {
  it('groups by category, filters and selects', () => {
    const onSelect = vi.fn();
    render(<I18nProvider initialLanguage="en"><RisksPanel scene={scene} selectedRiskId="r2" onSelect={onSelect} /></I18nProvider>);
    expect(screen.getAllByText('Performance & scale')).toHaveLength(2);
    expect(screen.getByTestId('risk-r2')).toHaveClass('is-selected');
    fireEvent.click(screen.getByTestId('risk-r1'));
    expect(onSelect).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByTestId('risk-filter-security'));
    expect(screen.queryByTestId('risk-r1')).toBeNull();
    expect(screen.getByTestId('risk-r2')).toBeInTheDocument();
  });

  it('explains scenes without risks', () => {
    render(<I18nProvider initialLanguage="en"><RisksPanel scene={{ ...scene, risks: [] }} selectedRiskId={null} onSelect={vi.fn()} /></I18nProvider>);
    expect(screen.getByText('No risks recorded for this scene.')).toBeInTheDocument();
  });
});
