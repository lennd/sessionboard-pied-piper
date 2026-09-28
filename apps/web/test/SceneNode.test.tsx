import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { SceneNode } from '../src/canvas/SceneNode';
import type { SceneNodeData } from '../src/canvas/toFlow';

const renderNode = (data: SceneNodeData) =>
  render(
    <ReactFlowProvider>
      <SceneNode {...({ id: data.node.id, data } as unknown as NodeProps)} />
    </ReactFlowProvider>,
  );

const node = { id: 'queue', type: 'queue' as const, label: 'jobs queue', meta: { tech: 'SQS' } };

describe('SceneNode', () => {
  it('renders label, tech and state classes', () => {
    renderNode({ node, state: 'focused', zoomable: false });
    const el = screen.getByTestId('node-queue');
    expect(el).toHaveClass('scene-node', 'scene-node--focused', 'scene-node--type-queue');
    expect(el).toHaveTextContent('jobs queue');
    expect(el).toHaveTextContent('SQS');
  });

  it('shows change, risk, annotation and zoom hints', () => {
    renderNode({
      node: { ...node, meta: { change: 'added', risk: 'bottleneck' } },
      state: 'normal',
      annotation: 'Lock held',
      zoomable: true,
    });
    expect(screen.getByTestId('node-queue')).toHaveClass('scene-node--change-added');
    expect(screen.getByText('bottleneck')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-queue')).toHaveTextContent('Lock held');
    expect(screen.getByText(/double-click for detail/i)).toBeInTheDocument();
  });

  it('renders load metrics and saturation', () => {
    renderNode({
      node,
      state: 'normal',
      zoomable: false,
      load: { arrivalRps: 20, throughputRps: 12, capacityRps: 12, utilization: 1.67, queueDepth: 80, latencyMs: 6686.7, saturated: true, hot: false },
    });
    const el = screen.getByTestId('node-queue');
    expect(el).toHaveClass('scene-node--saturated');
    expect(el).toHaveTextContent('167%');
    expect(el).toHaveTextContent('queue 80');
    expect(el).toHaveTextContent('6.7 s');
  });
});
