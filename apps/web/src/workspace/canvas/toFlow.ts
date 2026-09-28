import {
  descendantsOf, type Change, type EdgeKind, type ProjectedEdges, type ScaleStatus, type Scene, type SceneIndex, type SceneRisk, type Severity, type VisibleModel,
} from '@rdi/scene';
import type { Edge, Node } from '@xyflow/react';
import type { Mode } from '../engine/explorerState';
import type { Frame } from '../engine/frame';
import type { Phase } from '../engine/phase';
import { aggregateSeverity, statusRank, worstScale } from '../engine/risks';
import { REPO_GLYPH, ROLE_GLYPHS } from './glyphs';
import type { SceneLayout } from './layout';

export type PieceState = 'normal' | 'focused' | 'highlighted' | 'dim';

export type PieceData = {
  id: string; label: string; kindLabel: string; glyph: string; state: PieceState; active: boolean; selected: boolean;
  change?: Change; scaleWorst?: ScaleStatus; severity?: Severity; hiddenChildren: number; annotation?: string;
};
export type ContainerData = Omit<PieceData, 'hiddenChildren' | 'scaleWorst' | 'annotation'>;
export type GroupData = { label: string };
export type FlowEdgeData = { kind: EdgeKind; label?: string; active: boolean; visited: boolean; reverse: boolean; tokenProgress: number | null; tokenLabel: string | null };

export type ToFlowInput = {
  scene: Scene; index: SceneIndex; model: VisibleModel; projected: ProjectedEdges; layout: SceneLayout; frame: Frame; phase: Phase;
  mode: Mode; selectedNodeId: string | null; selectedRisk: SceneRisk | null; scaleOverlay: boolean; byNode: Map<string, SceneRisk[]>;
};

const membersOf = (model: VisibleModel, id: string) => model.repoBoxes.get(id) ?? [id];

const pieceState = (id: string, input: ToFlowInput, covered: string[]): PieceState => {
  const { mode, selectedRisk, frame, model } = input;
  if (mode === 'risks' && selectedRisk) {
    const reps = new Set(selectedRisk.nodeIds.map((n) => model.representative.get(n)));
    return reps.has(id) ? 'focused' : 'dim';
  }
  if (mode === 'changes') return covered.some((n) => input.index.byId.get(n)?.change) ? 'normal' : 'dim';
  if (frame.focused.has(id)) return 'focused';
  if (frame.highlighted.has(id)) return 'highlighted';
  return frame.focused.size > 0 ? 'dim' : 'normal';
};

const worstOf = (statuses: (ScaleStatus | undefined)[]): ScaleStatus | undefined =>
  statuses.filter((s): s is ScaleStatus => s !== undefined).reduce<ScaleStatus | undefined>((a, b) => (a === undefined || statusRank(b) > statusRank(a) ? b : a), undefined);

export const toFlow = (input: ToFlowInput): { nodes: Node[]; edges: Edge[] } => {
  const { index, model, projected, layout, frame, phase, mode, selectedNodeId, scaleOverlay, byNode } = input;
  const selected = selectedNodeId ? model.representative.get(selectedNodeId) ?? selectedNodeId : null;

  const nodes: Node[] = layout.order.map((id) => {
    const box = layout.boxes.get(id)!;
    const position = { x: box.x, y: box.y };
    const parent = box.parent ? { parentId: box.parent, extent: 'parent' as const } : {};
    const size = { width: box.width, height: box.height };
    if (box.kind === 'group') {
      return { id, type: 'group-box', position, data: { label: box.label ?? id } satisfies GroupData, style: size, selectable: false, draggable: false, ...parent };
    }
    const members = membersOf(model, id);
    const covered = members.flatMap((m) => [m, ...descendantsOf(index, m)]);
    const node = index.byId.get(id);
    const common = {
      id,
      label: box.kind === 'repoBox' ? box.label ?? id : node?.label ?? id,
      kindLabel: box.kind === 'repoBox' ? members.map((m) => index.byId.get(m)?.label ?? m).join(' · ') : node?.kind ?? '',
      glyph: box.kind === 'repoBox' ? REPO_GLYPH : node ? ROLE_GLYPHS[node.role] : REPO_GLYPH,
      state: pieceState(id, input, covered),
      active: mode === 'walkthrough' && phase.activated && frame.focused.has(id),
      selected: selected === id,
      change: covered.map((n) => index.byId.get(n)?.change).find((c) => c !== undefined),
      severity: aggregateSeverity(index, byNode, members),
    };
    if (box.kind === 'container') {
      return { id, type: 'container', position, data: common satisfies ContainerData, style: size, draggable: false, ...parent };
    }
    const data: PieceData = {
      ...common,
      hiddenChildren: box.kind === 'repoBox' ? members.length : descendantsOf(index, id).length,
      scaleWorst: scaleOverlay ? worstOf(members.map((m) => { const n = index.byId.get(m); return n ? worstScale(n) : undefined; })) : undefined,
      annotation: frame.annotations.get(id),
    };
    return { id, type: 'piece', position, data, draggable: false, ...parent };
  });

  const edges: Edge[] = projected.edges.map((e) => {
    const active = mode === 'walkthrough' && frame.active?.key === e.key;
    const data: FlowEdgeData = {
      kind: e.kind, label: e.label, active, visited: frame.visited.has(e.key), reverse: active ? frame.active!.reverse : false,
      tokenProgress: active ? phase.tokenProgress : null, tokenLabel: active ? frame.active!.label : null,
    };
    return { id: e.key, source: e.from, target: e.to, type: 'flow', data };
  });

  return { nodes, edges };
};
