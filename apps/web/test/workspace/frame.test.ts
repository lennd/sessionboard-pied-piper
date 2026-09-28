import { computeVisible, flattenSteps, indexScene, projectEdges } from '@rdi/scene';
import { frameAt } from '../../src/workspace/engine/frame';
import { stepPhase, TRAVEL_FRACTION } from '../../src/workspace/engine/phase';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const setup = (level: Parameters<typeof computeVisible>[2], open: string[], local: string[] = []) => {
  const model = computeVisible(scene, index, level, new Set(local));
  return { model, projected: projectEdges(scene, model), flat: flattenSteps(scene.steps, new Set(open)) };
};

describe('frameAt', () => {
  it('projects focus, active edge and visited edges', () => {
    const { model, projected, flat } = setup('architecture', []);
    const f = frameAt(model, projected, flat, 1);
    expect([...f.focused]).toEqual(['worker']);
    expect(f.active).toEqual({ key: 'api->worker', reverse: false, label: null });
    expect([...f.visited]).toEqual(['client->api']);
  });

  it('projects internal focus onto the visible ancestor and keeps annotations', () => {
    const { model, projected, flat } = setup('architecture', ['s2', 's2-1'], ['reserve']);
    const f = frameAt(model, projected, flat, 3);
    expect(f.flat?.step.id).toBe('s2-1-1');
    expect([...f.focused]).toEqual(['lock']);
    expect(f.active?.key).toBe('lock->db');
    expect(f.annotations.get('lock')).toBe('one at a time');
  });

  it('has no active edge when the travel edge collapses inside one piece', () => {
    const { model, projected, flat } = setup('architecture', ['s2']);
    const f = frameAt(model, projected, flat, 3);
    expect(f.flat?.step.id).toBe('s2-2');
    expect(f.active).toBeNull();
    expect([...f.focused]).toEqual(['worker']);
  });

  it('keeps the reverse flag and clamps the cursor', () => {
    const { model, projected, flat } = setup('architecture', []);
    expect(frameAt(model, projected, flat, 99).active).toEqual({ key: 'worker->pay', reverse: true, label: null });
  });

  it('returns an empty frame without steps', () => {
    const { model, projected } = setup('architecture', []);
    expect(frameAt(model, projected, [], 0)).toMatchObject({ flat: null, active: null, index: 0 });
  });
});

describe('stepPhase', () => {
  it('travels first, then activates', () => {
    expect(stepPhase(0, true)).toEqual({ tokenProgress: 0, activated: false });
    expect(stepPhase(TRAVEL_FRACTION / 2, true).tokenProgress).toBeCloseTo(0.5);
    expect(stepPhase(TRAVEL_FRACTION, true)).toEqual({ tokenProgress: null, activated: true });
    expect(stepPhase(0, false)).toEqual({ tokenProgress: null, activated: true });
  });
});
