import { sampleSceneRegistry } from '@rdi/scene';
import { frameAt } from '../src/engine/frame';

const flow = sampleSceneRegistry['speaker-sync-flow']!;

describe('frameAt', () => {
  it('exposes focus, travel, visited edges and annotations', () => {
    const f = frameAt(flow, 3);
    expect(f.stepIndex).toBe(3);
    expect([...f.focused]).toEqual(['worker', 'lock']);
    expect(f.activeEdgeId).toBe('k-l');
    expect(f.tokenLabel).toBe('lock');
    expect([...f.visitedEdgeIds]).toEqual(['o-w', 'w-e', 'e-q']);
    expect(f.annotations).toEqual({ lock: 'Lock held ~2-4s' });
  });

  it('clamps out-of-range indices (scene switched mid-playback)', () => {
    expect(frameAt(flow, 999).stepIndex).toBe(flow.steps.length - 1);
  });

  it('returns an empty frame for scenes without steps', () => {
    const f = frameAt(sampleSceneRegistry['pr-impact']!, 2);
    expect(f).toMatchObject({ step: null, stepIndex: 0, activeEdgeId: null, tokenLabel: null, annotations: {} });
    expect(f.focused.size).toBe(0);
  });
});
