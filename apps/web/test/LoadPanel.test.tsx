import { fireEvent, render, screen } from '@testing-library/react';
import { sampleSceneRegistry, simulateLoad } from '@rdi/scene';
import { LoadPanel } from '../src/panels/LoadPanel';

const scene = sampleSceneRegistry['speaker-sync-load']!;

describe('LoadPanel', () => {
  it('shows rps, end-to-end latency and the estimate disclaimer', () => {
    render(<LoadPanel scene={scene} rps={5} result={simulateLoad(scene, 5)} onRpsChange={vi.fn()} />);
    expect(screen.getByTestId('load-panel')).toHaveTextContent('5 rps');
    expect(screen.getByTestId('load-e2e')).toHaveTextContent(/\d+(\.\d)? (ms|s)/);
    expect(screen.getByText('Estimates — not measured metrics')).toBeInTheDocument();
    expect(screen.getByTestId('load-bottlenecks')).toHaveTextContent('No bottlenecks');
  });

  it('lists bottlenecks by label and reports slider changes', () => {
    const onRpsChange = vi.fn();
    render(<LoadPanel scene={scene} rps={20} result={simulateLoad(scene, 20)} onRpsChange={onRpsChange} />);
    expect(screen.getByTestId('load-bottlenecks')).toHaveTextContent('jobs queue');
    fireEvent.change(screen.getByTestId('load-rps'), { target: { value: '12' } });
    expect(onRpsChange).toHaveBeenCalledWith(12);
    expect(screen.getByTestId('load-rps')).toHaveAttribute('max', String(scene.load!.rps * 8));
  });

  it('never renders NaN or Infinity at rps 0', () => {
    render(<LoadPanel scene={scene} rps={0} result={simulateLoad(scene, 0)} onRpsChange={vi.fn()} />);
    expect(screen.getByTestId('load-panel').textContent).not.toMatch(/NaN|Infinity/);
  });

  it('renders nothing for scenes without load config', () => {
    const flow = sampleSceneRegistry['speaker-sync-flow']!;
    const { container } = render(<LoadPanel scene={flow} rps={0} onRpsChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
