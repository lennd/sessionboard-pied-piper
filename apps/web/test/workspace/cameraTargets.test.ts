// @vitest-environment node
import { computeVisible, flattenSteps, indexScene, projectEdges } from '@rdi/scene';
import { cameraShot } from '../../src/workspace/canvas/cameraTargets';
import { frameAt } from '../../src/workspace/engine/frame';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const model = computeVisible(scene, index, 'architecture', new Set());
const projected = projectEdges(scene, model);
const flat = flattenSteps(scene.steps, new Set());

describe('cameraShot', () => {
  it('frames the step pieces and both ends of the travelled edge during a walkthrough', () => {
    const frame = frameAt(model, projected, flat, 0);
    const shot = cameraShot({ mode: 'walkthrough', frame, projected, model, risk: null, hoverRisk: null });
    expect(shot.key).toBe('step:s1:0');
    expect(shot.nodeIds.sort()).toEqual(['api', 'client']);
  });

  it('frames the pieces of the hovered risk before the selected one, and everything when none', () => {
    const frame = frameAt(model, projected, flat, 0);
    const [r1, r2] = scene.risks;
    expect(cameraShot({ mode: 'risks', frame, projected, model, risk: r2!, hoverRisk: r1! })).toEqual({ key: 'risk:r1', nodeIds: ['worker'] });
    expect(cameraShot({ mode: 'risks', frame, projected, model, risk: r2!, hoverRisk: null })).toEqual({ key: 'risk:r2', nodeIds: ['api'] });
    expect(cameraShot({ mode: 'risks', frame, projected, model, risk: null, hoverRisk: null })).toEqual({ key: 'risks:all', nodeIds: [] });
    expect(cameraShot({ mode: 'changes', frame, projected, model, risk: null, hoverRisk: null }).nodeIds).toEqual([]);
  });
});
