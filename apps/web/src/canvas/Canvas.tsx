import type { LoadResult, Scene } from '@rdi/scene';
import { Background, Controls, ReactFlow, ReactFlowProvider, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import type { Frame } from '../engine/frame';
import { SceneEdge } from './SceneEdge';
import { SceneNode } from './SceneNode';
import { toFlow } from './toFlow';
import { useSceneLayout } from './useSceneLayout';

const nodeTypes = { scene: SceneNode };
const edgeTypes = { scene: SceneEdge };

type CanvasProps = { scene: Scene; frame: Frame; progress: number; load?: LoadResult; onZoom: (nodeId: string) => void };

export const Canvas = ({ scene, frame, progress, load, onZoom }: CanvasProps) => {
  const layout = useSceneLayout(scene);
  const flow = useMemo(
    () => (layout ? toFlow({ scene, layout, frame, progress, load }) : null),
    [scene, layout, frame, progress, load],
  );
  const handleDoubleClick: NodeMouseHandler = (_event, node) => onZoom(node.id);

  if (!flow) return <div className="canvas canvas--loading">Laying out…</div>;

  return (
    <div className="canvas" data-testid="canvas">
      <ReactFlowProvider>
        <ReactFlow
          key={scene.id}
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeDoubleClick={handleDoubleClick}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
};
