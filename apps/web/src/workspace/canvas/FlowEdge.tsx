import { EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import { floatingEdgePoints, pointAlong, type Rect } from './floating';
import type { FlowEdgeData } from './toFlow';

const ARROW = 8;
const TOKEN_RADIUS = 6;

const rectOf = (node: InternalNode): Rect => ({
  x: node.internals.positionAbsolute.x,
  y: node.internals.positionAbsolute.y,
  width: node.measured.width ?? 0,
  height: node.measured.height ?? 0,
});

export const FlowEdge = ({ id, source, target, data }: EdgeProps) => {
  const edge = data as FlowEdgeData;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty } = floatingEdgePoints(rectOf(sourceNode), rectOf(targetNode));
  const markerId = `arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const token = edge.tokenProgress === null ? null : pointAlong(sx, sy, tx, ty, edge.reverse ? 1 - edge.tokenProgress : edge.tokenProgress);
  const classes = ['edge-line', `kind-${edge.kind}`, edge.active && 'is-active', edge.visited && 'is-visited'].filter(Boolean).join(' ');

  return (
    <>
      <defs>
        <marker id={markerId} viewBox={`0 0 ${ARROW} ${ARROW}`} refX={ARROW} refY={ARROW / 2} markerWidth={ARROW} markerHeight={ARROW} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d={`M0,0 L${ARROW},${ARROW / 2} L0,${ARROW} z`} style={{ fill: edge.active ? 'var(--token)' : 'var(--line)' }} />
        </marker>
      </defs>
      <path className={classes} d={`M ${sx} ${sy} L ${tx} ${ty}`} markerEnd={`url(#${markerId})`} />
      {token && (
        <g data-testid="edge-token" transform={`translate(${token.x}, ${token.y})`}>
          <circle className="token" r={TOKEN_RADIUS} />
          {edge.tokenLabel && <text className="token-label" y={-12} textAnchor="middle">{edge.tokenLabel}</text>}
        </g>
      )}
      {edge.label && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, 4px) translate(${(sx + tx) / 2}px, ${(sy + ty) / 2}px)` }}>{edge.label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
