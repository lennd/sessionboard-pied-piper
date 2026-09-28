import { initialExplorerState, reduceExplorer, type ExplorerState } from '../../src/workspace/engine/explorerState';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const start = (patch: Partial<ExplorerState> = {}): ExplorerState => ({ ...initialExplorerState('fx', 'architecture'), ...patch });
const run = (state: ExplorerState, ...actions: Parameters<typeof reduceExplorer>[1][]) => actions.reduce((s, a) => reduceExplorer(s, a, scene), state);

describe('reduceExplorer', () => {
  it('starts in walkthrough mode with nothing open', () => {
    expect(initialExplorerState('fx', 'components')).toEqual({
      sceneId: 'fx', level: 'components', localExpanded: [], localCollapsed: [], openSteps: [], selectedNodeId: null,
      mode: 'walkthrough', selectedRiskId: null, codeNodeId: null, scaleOverlay: false,
    });
  });

  it('toggles local expansion only for nodes with children', () => {
    const s = run(start(), { type: 'toggleExpand', nodeId: 'worker' }, { type: 'toggleExpand', nodeId: 'db' });
    expect(s.localExpanded).toEqual(['worker']);
    expect(run(s, { type: 'toggleExpand', nodeId: 'worker' }).localExpanded).toEqual([]);
  });

  it('collapsing a piece also drops expanded descendants', () => {
    const s = run(start(), { type: 'toggleExpand', nodeId: 'worker' }, { type: 'toggleExpand', nodeId: 'reserve' }, { type: 'toggleExpand', nodeId: 'worker' });
    expect(s.localExpanded).toEqual([]);
  });

  it('collapses and re-expands pieces the level expanded', () => {
    const collapsed = run(start({ level: 'components' }), { type: 'toggleExpand', nodeId: 'worker' });
    expect(collapsed).toMatchObject({ localCollapsed: ['worker'], localExpanded: [] });
    const reopened = run(collapsed, { type: 'toggleExpand', nodeId: 'worker' });
    expect(reopened.localCollapsed).toEqual([]);
    expect(run(collapsed, { type: 'setLevel', level: 'detail' }).localCollapsed).toEqual([]);
  });

  it('opening a step expands its node; closing removes it and its open descendants', () => {
    const opened = run(start(), { type: 'toggleStep', stepId: 's2' }, { type: 'toggleStep', stepId: 's2-1' });
    expect(opened.openSteps).toEqual(['s2', 's2-1']);
    expect(opened.localExpanded).toEqual(['worker', 'reserve']);
    const closed = run(opened, { type: 'toggleStep', stepId: 's2' });
    expect(closed.openSteps).toEqual([]);
    expect(closed.localExpanded).toEqual([]);
  });

  it('ignores toggling steps without sub-steps', () => {
    const s = start();
    expect(run(s, { type: 'toggleStep', stepId: 's1' })).toBe(s);
  });

  it('selecting a risk switches mode, leaves system level and expands ancestors of hidden pieces', () => {
    const s = run(start({ level: 'system' }), { type: 'selectRisk', riskId: 'r1' });
    expect(s).toMatchObject({ mode: 'risks', selectedRiskId: 'r1', level: 'architecture', selectedNodeId: 'lock' });
    expect(s.localExpanded.sort()).toEqual(['reserve', 'worker']);
    expect(run(s, { type: 'selectRisk', riskId: null }).selectedRiskId).toBeNull();
  });

  it('handles selection, mode, code drawer and overlay', () => {
    const s = run(start(), { type: 'selectNode', nodeId: 'api' }, { type: 'openCode', nodeId: 'api' }, { type: 'toggleScaleOverlay' }, { type: 'setMode', mode: 'changes' });
    expect(s).toMatchObject({ selectedNodeId: 'api', codeNodeId: 'api', scaleOverlay: true, mode: 'changes' });
    expect(run(s, { type: 'closeCode' }).codeNodeId).toBeNull();
  });

  it('loading a scene resets everything except the overlay', () => {
    const s = run(start({ scaleOverlay: true, openSteps: ['s2'], selectedNodeId: 'api' }), { type: 'loadScene', sceneId: 'other', level: 'detail', mode: 'risks' });
    expect(s).toEqual({ ...initialExplorerState('other', 'detail'), mode: 'risks', scaleOverlay: true });
  });

  it('changing level keeps local expansion', () => {
    const s = run(start({ localExpanded: ['worker'] }), { type: 'setLevel', level: 'detail' });
    expect(s).toMatchObject({ level: 'detail', localExpanded: ['worker'] });
  });
});
