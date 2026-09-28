import { render, screen } from '@testing-library/react';
import { PayloadPanel } from '../src/panels/PayloadPanel';

describe('PayloadPanel', () => {
  it('renders nothing without payload', () => {
    const { container } = render(<PayloadPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('diffs before and after line by line', () => {
    render(<PayloadPanel payload={{ format: 'json', before: '{\n  "a": 1\n}', after: '{\n  "a": 2\n}' }} />);
    const panel = screen.getByTestId('payload-panel');
    expect(panel).toHaveTextContent('json');
    expect(panel.querySelector('.diff-line--removed')).toHaveTextContent('"a": 1');
    expect(panel.querySelector('.diff-line--added')).toHaveTextContent('"a": 2');
    expect(panel.querySelectorAll('.diff-line--same')).toHaveLength(2);
  });

  it('shows after-only payloads as added lines', () => {
    render(<PayloadPanel payload={{ format: 'sql', after: 'SELECT 1;' }} />);
    expect(screen.getByTestId('payload-panel').querySelector('.diff-line--added')).toHaveTextContent('SELECT 1;');
  });
});
