import { ancestorsOf, computeVisible, descendantsOf, descendantStepIds, findStep, indexScene, type Level, type Scene } from '@rdi/scene';

export type Mode = 'walkthrough' | 'risks' | 'changes';

export type ExplorerState = {
  sceneId: string;
  level: Level;
  localExpanded: string[];
  localCollapsed: string[];
  openSteps: string[];
  selectedNodeId: string | null;
  mode: Mode;
  selectedRiskId: string | null;
  codeNodeId: string | null;
  scaleOverlay: boolean;
};

export type ExplorerAction =
  | { type: 'loadScene'; sceneId: string; level: Level; mode: Mode }
  | { type: 'setLevel'; level: Level }
  | { type: 'toggleExpand'; nodeId: string }
  | { type: 'toggleStep'; stepId: string }
  | { type: 'selectNode'; nodeId: string | null }
  | { type: 'setMode'; mode: Mode }
  | { type: 'selectRisk'; riskId: string | null }
  | { type: 'openCode'; nodeId: string }
  | { type: 'closeCode' }
  | { type: 'toggleScaleOverlay' };

export const initialExplorerState = (sceneId: string, level: Level): ExplorerState => ({
  sceneId, level, localExpanded: [], localCollapsed: [], openSteps: [], selectedNodeId: null, mode: 'walkthrough', selectedRiskId: null, codeNodeId: null, scaleOverlay: false,
});

const withItem = (list: string[], item: string) => (list.includes(item) ? list : [...list, item]);
const without = (list: string[], remove: Set<string>) => list.filter((item) => !remove.has(item));

const toggleStep = (state: ExplorerState, stepId: string, scene: Scene): ExplorerState => {
  const step = findStep(scene.steps, stepId);
  if (!step || step.substeps.length === 0) return state;
  if (!state.openSteps.includes(stepId)) {
    return {
      ...state,
      openSteps: [...state.openSteps, stepId],
      localExpanded: step.expand ? withItem(state.localExpanded, step.expand) : state.localExpanded,
      localCollapsed: step.expand ? without(state.localCollapsed, new Set([step.expand])) : state.localCollapsed,
    };
  }
  const closing = new Set([stepId, ...descendantStepIds(step)]);
  const collapsing = new Set([...closing].flatMap((id) => findStep(scene.steps, id)?.expand ?? []));
  return { ...state, openSteps: without(state.openSteps, closing), localExpanded: without(state.localExpanded, collapsing) };
};

const selectRisk = (state: ExplorerState, riskId: string | null, scene: Scene): ExplorerState => {
  if (riskId === null) return { ...state, selectedRiskId: null };
  const risk = scene.risks.find((r) => r.id === riskId);
  if (!risk) return state;
  const index = indexScene(scene);
  const expand = risk.nodeIds.flatMap((id) => ancestorsOf(index, id));
  return {
    ...state,
    mode: 'risks',
    selectedRiskId: riskId,
    selectedNodeId: risk.nodeIds[0] ?? null,
    level: state.level === 'system' ? 'architecture' : state.level,
    localExpanded: expand.reduce(withItem, state.localExpanded),
    localCollapsed: without(state.localCollapsed, new Set(expand)),
  };
};

export const reduceExplorer = (state: ExplorerState, action: ExplorerAction, scene: Scene): ExplorerState => {
  switch (action.type) {
    case 'loadScene':
      return { ...initialExplorerState(action.sceneId, action.level), mode: action.mode, scaleOverlay: state.scaleOverlay };
    case 'setLevel':
      return { ...state, level: action.level, localCollapsed: [] };
    case 'toggleExpand': {
      const index = indexScene(scene);
      if ((index.children.get(action.nodeId)?.length ?? 0) === 0) return state;
      const model = computeVisible(scene, index, state.level, new Set(state.localExpanded), new Set(state.localCollapsed));
      if (model.expanded.has(action.nodeId)) {
        return {
          ...state,
          localExpanded: without(state.localExpanded, new Set([action.nodeId, ...descendantsOf(index, action.nodeId)])),
          localCollapsed: withItem(state.localCollapsed, action.nodeId),
        };
      }
      return {
        ...state,
        localExpanded: withItem(state.localExpanded, action.nodeId),
        localCollapsed: without(state.localCollapsed, new Set([action.nodeId, ...ancestorsOf(index, action.nodeId)])),
      };
    }
    case 'toggleStep':
      return toggleStep(state, action.stepId, scene);
    case 'selectNode':
      return { ...state, selectedNodeId: action.nodeId };
    case 'setMode':
      return { ...state, mode: action.mode };
    case 'selectRisk':
      return selectRisk(state, action.riskId, scene);
    case 'openCode':
      return { ...state, codeNodeId: action.nodeId };
    case 'closeCode':
      return { ...state, codeNodeId: null };
    case 'toggleScaleOverlay':
      return { ...state, scaleOverlay: !state.scaleOverlay };
  }
};
