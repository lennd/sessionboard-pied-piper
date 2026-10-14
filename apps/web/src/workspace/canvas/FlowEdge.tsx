import { EdgeLabelRenderer, getSmoothStepPath, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import { floatingEdgePoints, type Point, type Rect } from './floating';
import { labelAnchor, pointAlongPolyline, roundedPath } from './routing';
import type { FlowEdgeData } from './toFlow';

const ARROW = 8;
const TOKEN_RADIUS = 6;
const LABEL_LIFT = 4;

const rectOf = (node: InternalNode): Rect => ({
  x: node.internals.positionAbsolute.x,
  y: node.internals.positionAbsolute.y,
  width: node.measured.width ?? 0,
  height: node.measured.height ?? 0,
});

/** Side of the source/target the free path leaves from, derived from where the two boxes sit. */
const sideOf = (from: Rect, to: Rect): 'left' | 'right' | 'top' | 'bottom' => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
};
const POSITION = { left: 'left', right: 'right', top: 'top', bottom: 'bottom' } as const;

export const FlowEdge = ({ id, source, target, data }: EdgeProps) => {
  const edge = data as FlowEdgeData;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const sourceRect = rectOf(sourceNode);
  const targetRect = rectOf(targetNode);
  let path: string;
  let points: Point[];
  let label: Point;
  if (edge.route && edge.route.length >= 2) {
    points = edge.route;
    path = roundedPath(points);
    label = labelAnchor(points);
  } else {
    const { sx, sy, tx, ty } = floatingEdgePoints(sourceRect, targetRect);
    const [d, lx, ly] = getSmoothStepPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition: POSITION[sideOf(sourceRect, targetRect)] as never, targetPosition: POSITION[sideOf(targetRect, sourceRect)] as never, borderRadius: 10 });
    path = d;
    points = [{ x: sx, y: sy }, { x: lx, y: ly }, { x: tx, y: ty }];
    label = { x: lx, y: ly };
  }
  const markerId = `arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const token = edge.tokenProgress === null ? null : pointAlongPolyline(points, edge.reverse ? 1 - edge.tokenProgress : edge.tokenProgress);
  const classes = ['edge-line', `kind-${edge.kind}`, edge.active && 'is-active', edge.visited && 'is-visited', edge.inCycle && 'in-cycle'].filter(Boolean).join(' ');

  return (
    <>
      <defs>
        <marker id={markerId} viewBox={`0 0 ${ARROW} ${ARROW}`} refX={ARROW} refY={ARROW / 2} markerWidth={ARROW} markerHeight={ARROW} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d={`M0,0 L${ARROW},${ARROW / 2} L0,${ARROW} z`} className={edge.active ? 'edge-arrow is-active' : edge.inCycle ? 'edge-arrow in-cycle' : 'edge-arrow'} />
        </marker>
      </defs>
      <path className="edge-hit" d={path} />
      <path className={classes} d={path} markerEnd={`url(#${markerId})`} data-testid={`edge-${id}`} />
      {token && (
        <g data-testid="edge-token" transform={`translate(${token.x}, ${token.y})`}>
          <circle className="token" r={TOKEN_RADIUS} />
          {edge.tokenLabel && <text className="token-label" y={-12} textAnchor="middle">{edge.tokenLabel}</text>}
        </g>
      )}
      {(edge.label || edge.inCycle) && (
        <EdgeLabelRenderer>
          <div className={edge.inCycle ? 'edge-label in-cycle' : 'edge-label'} style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y - LABEL_LIFT}px)` }}>
            {edge.inCycle && <span className="edge-cycle" title="loop">↻</span>}
            {edge.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
