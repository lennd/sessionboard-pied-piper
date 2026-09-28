import type { LoadResult, Scene } from '@rdi/scene';
import { formatLatency } from '../canvas/SceneNode';

const RPS_RANGE_MULTIPLIER = 8;

type LoadPanelProps = { scene: Scene; rps: number; result?: LoadResult; onRpsChange: (rps: number) => void };

export const LoadPanel = ({ scene, rps, result, onRpsChange }: LoadPanelProps) => {
  if (!scene.load || !result) return null;
  const labels = new Map(scene.nodes.map((n) => [n.id, n.label]));
  return (
    <div className="load-panel" data-testid="load-panel">
      <label>
        Traffic{' '}
        <input
          type="range"
          data-testid="load-rps"
          aria-label="Requests per second"
          min={0}
          max={scene.load.rps * RPS_RANGE_MULTIPLIER}
          step={1}
          value={rps}
          onChange={(e) => onRpsChange(Number(e.target.value))}
        />{' '}
        {rps} rps
      </label>
      <span data-testid="load-e2e">End-to-end: {formatLatency(result.endToEndLatencyMs)}</span>
      <span data-testid="load-bottlenecks" className="load-panel__bottlenecks">
        {result.bottlenecks.length === 0 ? 'No bottlenecks' : `Bottlenecks: ${result.bottlenecks.map((id) => labels.get(id) ?? id).join(', ')}`}
      </span>
      <span className="load-panel__estimate">Estimates — not measured metrics</span>
    </div>
  );
};
