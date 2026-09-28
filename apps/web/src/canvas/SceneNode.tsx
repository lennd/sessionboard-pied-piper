import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { SceneNode as SceneNodeModel } from '@rdi/scene';
import type { SceneNodeData } from './toFlow';

const TYPE_GLYPHS: Record<SceneNodeModel['type'], string> = {
  client: '🖥',
  service: '⚙',
  endpoint: '⇄',
  queue: '☰',
  db: '🛢',
  table: '▦',
  cache: '⚡',
  external: '☁',
  function: 'ƒ',
  data: '{}',
};

const MS_PER_SECOND = 1000;

export const formatLatency = (ms: number): string =>
  ms >= MS_PER_SECOND ? `${(ms / MS_PER_SECOND).toFixed(1)} s` : `${Math.round(ms)} ms`;

export const SceneNode = ({ data }: NodeProps) => {
  const { node, state, annotation, load, zoomable } = data as SceneNodeData;
  const classes = [
    'scene-node',
    `scene-node--${state}`,
    `scene-node--type-${node.type}`,
    node.meta.change && `scene-node--change-${node.meta.change}`,
    load?.saturated && 'scene-node--saturated',
    load?.hot && 'scene-node--hot',
  ].filter(Boolean);

  return (
    <div className={classes.join(' ')} data-testid={`node-${node.id}`} title={node.meta.notes}>
      <Handle type="target" position={Position.Left} />
      <div className="scene-node__header">
        <span className="scene-node__glyph">{TYPE_GLYPHS[node.type]}</span>
        <span className="scene-node__label">{node.label}</span>
      </div>
      <div className="scene-node__meta">
        {node.meta.tech && <span>{node.meta.tech}</span>}
        {node.repo && <span className="scene-node__repo">{node.repo}</span>}
        {node.meta.risk && <span className={`badge badge--${node.meta.risk}`}>{node.meta.risk}</span>}
        {node.meta.change && <span className={`badge badge--${node.meta.change}`}>{node.meta.change}</span>}
      </div>
      {load && (
        <div className="scene-node__load">
          <div className="load-bar">
            <div className="load-bar__fill" style={{ width: `${Math.min(load.utilization, 1) * 100}%` }} />
          </div>
          <span>{Math.round(load.utilization * 100)}%</span>
          <span>queue {Math.round(load.queueDepth)}</span>
          <span>{formatLatency(load.latencyMs)}</span>
        </div>
      )}
      {zoomable && <div className="scene-node__zoom">⤢ double-click for detail</div>}
      {annotation && (
        <div className="scene-node__annotation" data-testid={`annotation-${node.id}`}>
          {annotation}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
};
