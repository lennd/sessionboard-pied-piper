import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { SceneEdgeData } from './toFlow';

const ASYNC_KINDS = new Set(['async']);

const pointOnPath = (path: SVGPathElement | null, progress: number) => {
  if (!path || typeof path.getTotalLength !== 'function') return null;
  const length = path.getTotalLength();
  const point = path.getPointAtLength(length * progress);
  return { x: point.x, y: point.y };
};

export const SceneEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) => {
  const edge = data as SceneEdgeData;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const measureRef = useRef<SVGPathElement>(null);
  const [token, setToken] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    setToken(edge.active ? pointOnPath(measureRef.current, edge.progress) : null);
  }, [edge.active, edge.progress, path]);

  const className = [
    'scene-edge',
    `scene-edge--${edge.kind}`,
    edge.active && 'scene-edge--active',
    edge.visited && 'scene-edge--visited',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <BaseEdge id={id} path={path} className={className} style={ASYNC_KINDS.has(edge.kind) ? { strokeDasharray: '6 4' } : undefined} />
      <path ref={measureRef} d={path} fill="none" stroke="none" />
      {token && (
        <g data-testid="edge-token" transform={`translate(${token.x}, ${token.y})`}>
          <circle r={7} className="edge-token" />
          {edge.tokenLabel && (
            <text y={-12} textAnchor="middle" className="edge-token__label">
              {edge.tokenLabel}
            </text>
          )}
        </g>
      )}
      {edge.label && (
        <EdgeLabelRenderer>
          <div className="scene-edge__label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {edge.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
