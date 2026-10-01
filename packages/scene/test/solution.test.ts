import { describe, expect, it } from 'vitest';
import { sampleRegistry, validateSolutionDraft } from '../src/index';

const scene = sampleRegistry['iot-telemetry']!;
const nodeId = scene.nodes[0]!.id;

describe('validateSolutionDraft', () => {
  it('accepts a draft with a proposed scene and a plan that references its pieces', () => {
    const result = validateSolutionDraft({
      summary: 'Add rate limiting', sceneProposed: scene,
      plan: [{ id: 't1', title: 'Add limiter', nodeRefs: [nodeId], acceptance: ['429 after 100 req/s'] }, { id: 't2', title: 'Tests', dependsOn: ['t1'] }],
      risks: [{ title: 'Legit bursts throttled', severity: 'medium' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.sceneCurrent).toBeNull();
    expect(result.draft.plan[1]).toEqual({ id: 't2', title: 'Tests', nodeRefs: [], acceptance: [], dependsOn: ['t1'] });
  });

  it('reports invalid scenes, duplicate tasks, unknown dependencies and unknown pieces', () => {
    const result = validateSolutionDraft({
      summary: 'x', sceneProposed: { ...scene, nodes: [] },
      plan: [{ id: 't1', title: 'A', nodeRefs: ['ghost'] }, { id: 't1', title: 'B', dependsOn: ['t9'] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/sceneProposed/);
    const second = validateSolutionDraft({ summary: 'x', sceneProposed: scene, plan: [{ id: 't1', title: 'A', nodeRefs: ['ghost'] }, { id: 't1', title: 'B', dependsOn: ['t9'] }] });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errors).toEqual(expect.arrayContaining([
      'plan: duplicate task id "t1"',
      'plan.t1: nodeRefs "ghost" is not a piece of the current or proposed scene',
      'plan.t1: dependsOn "t9" is not a task of this plan',
    ]));
  });

  it('requires something to look at', () => {
    expect(validateSolutionDraft({ summary: 'x' })).toEqual({ ok: false, errors: ['a solution needs a scene or a plan'] });
  });
});
