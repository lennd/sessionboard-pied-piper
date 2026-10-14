import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { PieceNode } from '../../src/workspace/canvas/PieceNode';
import type { PieceData } from '../../src/workspace/canvas/toFlow';

const base: PieceData = { id: 'api', label: 'Orders API', kindLabel: 'REST API', glyph: '⚙', role: 'compute', brands: [], state: 'normal', active: false, selected: false, hiddenChildren: 0, persists: 0, inCycle: false };
const renderPiece = (data: PieceData) =>
  render(
    <I18nProvider initialLanguage="en">
      <ReactFlowProvider>
        <PieceNode {...({ id: data.id, data } as unknown as NodeProps)} />
      </ReactFlowProvider>
    </I18nProvider>,
  );

describe('PieceNode', () => {
  it('renders label, kind and state classes', () => {
    renderPiece({ ...base, state: 'focused', active: true, selected: true });
    const el = screen.getByTestId('node-api');
    expect(el).toHaveClass('piece', 'is-focused', 'is-active', 'is-selected');
    expect(el).toHaveTextContent('Orders API');
    expect(el).toHaveTextContent('REST API');
  });

  it('shows change badge, risk dot, hidden children, scale bar and annotation', () => {
    renderPiece({ ...base, change: 'added', severity: 'critical', hiddenChildren: 3, scaleWorst: 'saturated', annotation: 'one at a time' });
    const el = screen.getByTestId('node-api');
    expect(el).toHaveClass('change-added', 'scale-saturated');
    expect(el.querySelector('.risk-dot.sev-critical')).not.toBeNull();
    expect(el).toHaveTextContent('3 inside');
    expect(el).toHaveTextContent('added');
    expect(el.querySelector('.piece-bar')).not.toBeNull();
    expect(screen.getByText('one at a time')).toBeInTheDocument();
  });

  it('draws the role icon, product logos, kept-data count and loop mark', () => {
    renderPiece({ ...base, role: 'storage', brands: ['postgresql', 'redis'], persists: 2, inCycle: true });
    const el = screen.getByTestId('node-api');
    expect(el).toHaveClass('role-storage', 'in-cycle');
    expect(el.querySelector('.piece-tile.has-brand.brand-postgresql')).not.toBeNull();
    expect(el.querySelector('.piece-brands .brand-redis')).not.toBeNull();
    expect(screen.getByTestId('piece-persists')).toHaveTextContent('2 kept');
    expect(el.querySelector('.piece-cycle')).not.toBeNull();
    renderPiece({ ...base, id: 'db', brands: [] });
    expect(screen.getByTestId('node-db').querySelector('.piece-tile.role-compute .role-icon')).not.toBeNull();
  });
});
