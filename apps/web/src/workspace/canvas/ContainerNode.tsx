import { Handle, Position, type NodeProps } from '@xyflow/react';
import { RepoIcon, RoleIcon } from './icons';
import { BrandRow, pieceClasses } from './PieceNode';
import type { ContainerData } from './toFlow';

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const, top: '50%', left: '50%' };
const ICON = 14;

export const ContainerNode = ({ data }: NodeProps) => {
  const d = data as ContainerData;
  return (
    <div className={[pieceClasses(d, 'container'), d.inCycle && 'in-cycle'].filter(Boolean).join(' ')} data-testid={`node-${d.id}`}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <div className="container-label">
        {d.role ? <RoleIcon role={d.role} size={ICON} /> : <RepoIcon size={ICON} />}
        <span>{d.label}</span>
        <span className="muted">{d.kindLabel}</span>
        <BrandRow slugs={d.brands} size={12} />
        {d.severity && <span className={`risk-dot sev-${d.severity}`} />}
      </div>
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
    </div>
  );
};
