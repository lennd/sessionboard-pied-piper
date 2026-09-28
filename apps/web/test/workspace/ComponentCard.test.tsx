import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { ComponentCard } from '../../src/workspace/panels/ComponentCard';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const api = scene.nodes.find((n) => n.id === 'api')!;
const reserve = scene.nodes.find((n) => n.id === 'reserve')!;
const renderCard = (props: Partial<Parameters<typeof ComponentCard>[0]> = {}) => {
  const handlers = { onOpenInside: vi.fn(), onViewCode: vi.fn(), onSelectRisk: vi.fn() };
  render(<I18nProvider initialLanguage="en"><ComponentCard node={api} risks={scene.risks.filter((r) => r.nodeIds.includes('api'))} canOpenInside={false} {...handlers} {...props} /></I18nProvider>);
  return handlers;
};

describe('ComponentCard', () => {
  it('shows the three scale rows with status and strategy', () => {
    renderCard();
    expect(screen.getByTestId('scale-row-low')).toHaveTextContent('comfortable');
    expect(screen.getByTestId('scale-row-high')).toHaveTextContent('saturated');
    expect(screen.getByTestId('scale-row-high')).toHaveTextContent('queues');
    expect(screen.getByTestId('scale-row-high').querySelector('.status-saturated')).not.toBeNull();
    expect(screen.getByTestId('card')).toHaveTextContent('Scales horizontally');
    expect(screen.getByTestId('card')).toHaveTextContent('add instances');
  });

  it('lists risks and exposes the optional code button', () => {
    const { onSelectRisk, onViewCode } = renderCard();
    fireEvent.click(screen.getByTestId('card-risk-r2'));
    expect(onSelectRisk).toHaveBeenCalledWith('r2');
    fireEvent.click(screen.getByTestId('view-code'));
    expect(onViewCode).toHaveBeenCalled();
  });

  it('shows complexity, hides scale and code when absent, and offers open inside', () => {
    const { onOpenInside } = renderCard({ node: reserve, risks: [], canOpenInside: true });
    expect(screen.getByTestId('card')).toHaveTextContent('O(k)');
    expect(screen.queryByTestId('scale-row-low')).toBeNull();
    expect(screen.queryByTestId('view-code')).toBeNull();
    expect(screen.getByText('No known risks.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-inside'));
    expect(onOpenInside).toHaveBeenCalled();
  });

  it('asks for a selection when there is no node', () => {
    renderCard({ node: null });
    expect(screen.getByText('Select a piece on the canvas or in the explorer.')).toBeInTheDocument();
  });
});
