import type { NodeProps } from '@xyflow/react';

export type SceneGroupData = { label: string };

export const SceneGroup = ({ id, data }: NodeProps) => (
  <div className="scene-group__label" data-testid={`group-${id}`}>
    {(data as SceneGroupData).label}
  </div>
);
