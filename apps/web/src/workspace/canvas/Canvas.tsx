import type { ProjectedEdges, Scene, SceneIndex, SceneRisk, VisibleModel } from '@rdi/scene/v2';
import { Background, Controls, ReactFlow, ReactFlowProvider, ViewportPortal, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { ExplorerState } from '../engine/explorerState';
import type { Frame } from '../engine/frame';
import type { Phase } from '../engine/phase';
import { Callout } from './Callout';
import { ContainerNode } from './ContainerNode';
import { FlowEdge } from './FlowEdge';
import { GroupBox } from './GroupBox';
import { absoluteRect, layoutScene, layoutSignature } from './layout';
import { PieceNode } from './PieceNode';
import { toFlow } from './toFlow';
import { useSceneLayout } from './useSceneLayout';

const nodeTypes = { piece: PieceNode, container: ContainerNode, 'group-box': GroupBox };
const edgeTypes = { flow: FlowEdge };
const CALLOUT_GAP = 12;

type CanvasProps = {
  scene: Scene; index: SceneIndex; model: VisibleModel; projected: ProjectedEdges; frame: Frame; phase: Phase;
  explorer: ExplorerState; byNode: Map<string, SceneRisk[]>;
  onSelect: (id: string) => void; onToggleExpand: (id: string) => void; onOpenCode: (id: string) => void;
  onOpenStep: (stepId: string) => void; onSelectRisk: (riskId: string) => void;
};

export const Canvas = (props: CanvasProps) => {
  const { scene, index, model, projected, frame, phase, explorer, byNode } = props;
  const { t } = useI18n();
  const signature = layoutSignature(scene.id, model);
  const { layout, error } = useSceneLayout(signature, () => layoutScene(scene, index, model, projected.edges));
  const selectedRisk = scene.risks.find((r) => r.id === explorer.selectedRiskId) ?? null;

  const flow = useMemo(
    () => (layout ? toFlow({ scene, index, model, projected, layout, frame, phase, mode: explorer.mode, selectedNodeId: explorer.selectedNodeId, selectedRisk, scaleOverlay: explorer.scaleOverlay, byNode }) : null),
    [layout, scene, index, model, projected, frame, phase, explorer.mode, explorer.selectedNodeId, selectedRisk, explorer.scaleOverlay, byNode],
  );

  if (error) return <div className="canvas-error">{t('canvas.error', { error })}</div>;
  if (!flow || !layout) return <div className="canvas-loading">{t('canvas.loading')}</div>;

  const step = frame.flat?.step;
  const focusId = step ? [...frame.focused][0] : undefined;
  const focusRect = focusId ? absoluteRect(layout, focusId) : null;
  const focusNode = step?.focus[0] ? index.byId.get(step.focus[0]) : undefined;
  const handleClick: NodeMouseHandler = (_e, node) => { if (node.type !== 'group-box') props.onSelect(node.id); };
  const handleDoubleClick: NodeMouseHandler = (_e, node) => props.onToggleExpand(node.id);

  return (
    <ReactFlowProvider>
      <ReactFlow
        key={signature}
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleClick}
        onNodeDoubleClick={handleDoubleClick}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
      >
        <Background gap={22} color="transparent" />
        <Controls showInteractive={false} />
        {step && frame.flat && focusRect && explorer.mode === 'walkthrough' && (
          <ViewportPortal>
            <Callout
              x={focusRect.x}
              y={focusRect.y + focusRect.height + CALLOUT_GAP}
              path={frame.flat.path}
              narration={step.narration}
              canOpen={step.substeps.length > 0 && !explorer.openSteps.includes(step.id)}
              canViewCode={Boolean(focusNode?.code)}
              riskCount={focusNode ? byNode.get(focusNode.id)?.length ?? 0 : 0}
              onOpen={() => props.onOpenStep(step.id)}
              onViewCode={() => focusNode && props.onOpenCode(focusNode.id)}
              onRisks={() => { const r = focusNode && byNode.get(focusNode.id)?.[0]; if (r) props.onSelectRisk(r.id); }}
            />
          </ViewportPortal>
        )}
      </ReactFlow>
    </ReactFlowProvider>
  );
};
