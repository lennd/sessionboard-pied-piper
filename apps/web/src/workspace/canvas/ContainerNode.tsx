import { Handle, Position, type NodeProps } from '@xyflow/react';
import { pieceClasses } from './PieceNode';
import type { ContainerData } from './toFlow';

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const, top: '50%', left: '50%' };

export const ContainerNode = ({ data }: NodeProps) => {
  const d = data as ContainerData;
  return (
    <div className={pieceClasses(d, 'container')} data-testid={`node-${d.id}`}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <div className="container-label">
        <span aria-hidden>{d.glyph}</span>
        <span>{d.label}</span>
        <span className="muted">{d.kindLabel}</span>
        {d.severity && <span className={`risk-dot sev-${d.severity}`} />}
      </div>
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
    </div>
  );
};
