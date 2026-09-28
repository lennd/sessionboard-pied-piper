import type { NodeProps } from '@xyflow/react';
import type { GroupData } from './toFlow';

export const GroupBox = ({ id, data }: NodeProps) => (
  <div className="group-box" data-testid={`group-${id}`}>
    <div className="group-label">{(data as GroupData).label}</div>
  </div>
);
