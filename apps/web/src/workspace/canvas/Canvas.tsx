import type { ProjectedEdges, Scene, SceneIndex, SceneRisk, VisibleModel } from '@rdi/scene';
import { applyNodeChanges, Background, Controls, Panel, ReactFlow, ReactFlowProvider, ViewportPortal, type Node, type NodeChange, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { ExplorerState } from '../engine/explorerState';
import type { Frame } from '../engine/frame';
import type { Phase } from '../engine/phase';
import { Callout } from './Callout';
import { CameraDirector } from './CameraDirector';
import { cameraShot } from './cameraTargets';
import { ContainerNode } from './ContainerNode';
import { DataCard } from './DataCard';
import { FlowEdge } from './FlowEdge';
import { GroupBox } from './GroupBox';
import { absoluteRect, layoutScene, layoutSignature } from './layout';
import { PieceNode } from './PieceNode';
import { absolutePosition, applyPositions, clearPositions, loadPositions, savePositions, type Positions } from './positions';
import { toFlow } from './toFlow';
import { useSceneLayout } from './useSceneLayout';

const nodeTypes = { piece: PieceNode, container: ContainerNode, 'group-box': GroupBox };
const edgeTypes = { flow: FlowEdge };
const CALLOUT_GAP = 12;
const DATA_GAP = 16;

type CanvasProps = {
  scene: Scene; index: SceneIndex; model: VisibleModel; projected: ProjectedEdges; frame: Frame; phase: Phase;
  explorer: ExplorerState; byNode: Map<string, SceneRisk[]>; hoverRiskId?: string | null;
  onSelect: (id: string) => void; onToggleExpand: (id: string) => void; onOpenCode: (id: string) => void;
  onOpenStep: (stepId: string) => void; onSelectRisk: (riskId: string) => void;
};

export const Canvas = (props: CanvasProps) => {
  const { scene, index, model, projected, frame, phase, explorer, byNode } = props;
  const { t } = useI18n();
  const signature = layoutSignature(scene.id, model);
  const { layout, error } = useSceneLayout(signature, () => layoutScene(scene, index, model, projected.edges));
  const selectedRisk = scene.risks.find((r) => r.id === explorer.selectedRiskId) ?? null;
  const hoverRisk = scene.risks.find((r) => r.id === props.hoverRiskId) ?? null;
  const [positions, setPositions] = useState<{ sceneId: string; moved: Positions }>(() => ({ sceneId: scene.id, moved: loadPositions(scene.id) }));
  useEffect(() => {
    if (positions.sceneId !== scene.id) setPositions({ sceneId: scene.id, moved: loadPositions(scene.id) });
  }, [scene.id, positions.sceneId]);
  const moved = positions.sceneId === scene.id ? positions.moved : {};
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((current) => applyNodeChanges(changes, current));
    const updates = changes.flatMap((c) => (c.type === 'position' && c.position ? [[c.id, c.position, c.dragging] as const] : []));
    if (updates.length === 0) return;
    setPositions((current) => {
      const next = { ...current.moved, ...Object.fromEntries(updates.map(([id, position]) => [id, position])) };
      if (updates.some(([, , dragging]) => !dragging)) savePositions(current.sceneId, next);
      return { sceneId: current.sceneId, moved: next };
    });
  }, []);
  const resetLayout = () => {
    clearPositions(scene.id);
    setPositions({ sceneId: scene.id, moved: {} });
  };

  const movedIds = useMemo(() => new Set(Object.keys(moved)), [moved]);
  const flow = useMemo(
    () => (layout ? toFlow({ scene, index, model, projected, layout, frame, phase, mode: explorer.mode, selectedNodeId: explorer.selectedNodeId, selectedRisk, scaleOverlay: explorer.scaleOverlay, byNode, moved: movedIds, hoverRisk }) : null),
    [layout, scene, index, model, projected, frame, phase, explorer.mode, explorer.selectedNodeId, selectedRisk, explorer.scaleOverlay, byNode, movedIds, hoverRisk],
  );
  const shot = useMemo(() => cameraShot({ mode: explorer.mode, frame, projected, model, risk: selectedRisk, hoverRisk }), [explorer.mode, frame, projected, model, selectedRisk, hoverRisk]);

  const nodes = useMemo(() => (flow ? applyPositions(flow.nodes, moved) : []), [flow, moved]);
  useEffect(() => {
    // Keep React Flow's measurements when the scene frame recomputes the nodes.
    setRfNodes((previous) => {
      const measured = new Map(previous.map((n) => [n.id, n.measured]));
      return nodes.map((n) => (measured.get(n.id) ? { ...n, measured: measured.get(n.id) } : n));
    });
  }, [nodes]);

  if (error) return <div className="canvas-error">{t('canvas.error', { error })}</div>;
  if (!flow || !layout) return <div className="canvas-loading">{t('canvas.loading')}</div>;

  const step = frame.flat?.step;
  const focusId = step ? [...frame.focused][0] : undefined;
  const focusBox = focusId ? absoluteRect(layout, focusId) : null;
  const focusAt = focusId ? absolutePosition(nodes, focusId) : null;
  const focusRect = focusBox && focusAt ? { ...focusBox, x: focusAt.x, y: focusAt.y } : focusBox;
  const focusNode = step?.focus[0] ? index.byId.get(step.focus[0]) : undefined;
  const activeEdge = frame.active ? projected.edges.find((e) => e.key === frame.active!.key) : undefined;
  const writtenId = activeEdge && (activeEdge.kind === 'write' || activeEdge.kind === 'async') ? (frame.active!.reverse ? activeEdge.from : activeEdge.to) : null;
  const writtenNode = writtenId ? index.byId.get(writtenId) ?? [...(model.repoBoxes.get(writtenId) ?? [])].map((m) => index.byId.get(m)).find(Boolean) : undefined;
  const writtenBox = writtenId ? absoluteRect(layout, writtenId) : null;
  const writtenAt = writtenId ? absolutePosition(nodes, writtenId) : null;
  const writtenRect = writtenBox && writtenAt ? { ...writtenBox, x: writtenAt.x, y: writtenAt.y } : writtenBox;
  const showData = Boolean(step && writtenRect && (step.payload?.after || writtenNode?.persists?.length));
  const handleClick: NodeMouseHandler = (_e, node) => { if (node.type !== 'group-box') props.onSelect(node.id); };
  const handleDoubleClick: NodeMouseHandler = (_e, node) => props.onToggleExpand(node.id);

  return (
    <ReactFlowProvider>
      <ReactFlow
        key={signature}
        nodes={rfNodes}
        onNodesChange={onNodesChange}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleClick}
        onNodeDoubleClick={handleDoubleClick}
        zoomOnDoubleClick={false}
        nodesDraggable
        nodesConnectable={false}
        fitView
      >
        <CameraDirector shot={shot} ready={rfNodes.length > 0} />
        <Background gap={22} color="transparent" />
        <Controls showInteractive={false} />
        {Object.keys(moved).length > 0 && (
          <Panel position="top-right">
            <button type="button" className="btn" data-testid="layout-reset" onClick={resetLayout}>↺ {t('canvas.resetLayout')}</button>
          </Panel>
        )}
        {step && frame.flat && focusRect && explorer.mode === 'walkthrough' && (
          <ViewportPortal>
            <Callout
              x={focusRect.x}
              y={focusRect.y + focusRect.height + CALLOUT_GAP}
              path={frame.flat.path}
              narration={step.narration}
              repeat={step.repeat}
              canOpen={step.substeps.length > 0 && !explorer.openSteps.includes(step.id)}
              canViewCode={Boolean(focusNode?.code)}
              riskCount={focusNode ? byNode.get(focusNode.id)?.length ?? 0 : 0}
              onOpen={() => props.onOpenStep(step.id)}
              onViewCode={() => focusNode && props.onOpenCode(focusNode.id)}
              onRisks={() => { const r = focusNode && byNode.get(focusNode.id)?.[0]; if (r) props.onSelectRisk(r.id); }}
            />
          </ViewportPortal>
        )}
        {showData && step && writtenRect && explorer.mode === 'walkthrough' && (
          <ViewportPortal>
            <DataCard x={writtenRect.x + writtenRect.width + DATA_GAP} y={writtenRect.y} label={writtenNode?.label ?? writtenId ?? ''} payload={step.payload} persisted={writtenNode?.persists?.[0]} />
          </ViewportPortal>
        )}
      </ReactFlow>
    </ReactFlowProvider>
  );
};
