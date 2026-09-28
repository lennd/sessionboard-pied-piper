import { describe, expect, it } from 'vitest';
import { defineScene, sampleSceneRegistry, sampleScenes, simulateLoad, validateScene } from '../src/index';

describe('sample scenes', () => {
  it('are all valid and uniquely identified', () => {
    sampleScenes.forEach((scene) => expect(validateScene(scene)).toMatchObject({ ok: true }));
    expect(Object.keys(sampleSceneRegistry).sort()).toEqual(
      ['pr-impact', 'speaker-reconcile-algorithm', 'speaker-sync-flow', 'speaker-sync-load'],
    );
  });

  it('cover every scene kind', () => {
    expect(new Set(sampleScenes.map((s) => s.kind))).toEqual(new Set(['flow', 'algorithm', 'load', 'diff-impact']));
  });

  it('resolve every zoom target inside the registry', () => {
    sampleScenes.forEach((scene) =>
      Object.values(scene.zoom ?? {}).forEach((target) => expect(sampleSceneRegistry[target]).toBeDefined()),
    );
  });

  it('flow scene has at least one payload step', () => {
    expect(sampleSceneRegistry['speaker-sync-flow']!.steps.some((s) => s.payload)).toBe(true);
  });

  it('load scene saturates the queue at 4x its default rps', () => {
    const load = sampleSceneRegistry['speaker-sync-load']!;
    expect(simulateLoad(load, load.load!.rps).bottlenecks).toEqual([]);
    expect(simulateLoad(load, load.load!.rps * 4).bottlenecks).toContain('queue');
  });

  it('defineScene throws readable errors', () => {
    expect(() => defineScene({ id: 'x', title: 'x', kind: 'flow', nodes: [{ id: 'a', type: 'client', label: 'A' }] })).toThrow(
      /steps: a "flow" scene needs at least one step/,
    );
  });
});
