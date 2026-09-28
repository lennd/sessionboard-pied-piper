import { describe, expect, it } from 'vitest';
import { defineScene, flattenSteps, indexScene, sampleRegistry, sampleScenes, validateScene, type Scene, type Step } from '../src/index';

const allSteps = (steps: Step[]): Step[] => steps.flatMap((s) => [s, ...allSteps(s.substeps)]);
const shape = (scene: Scene) => ({
  nodes: scene.nodes.map((n) => [n.id, n.role, n.parent ?? null, n.repo ?? null]),
  edges: scene.edges.map((e) => [e.id, e.from, e.to]),
  steps: allSteps(scene.steps).map((s) => [s.id, s.travel?.edgeId ?? null, s.expand ?? null]),
  risks: scene.risks.map((r) => [r.id, r.category, r.severity]),
});

describe('samples', () => {
  it('are valid and registered', () => {
    sampleScenes.forEach((s) => expect(validateScene(s)).toMatchObject({ ok: true }));
    expect(Object.keys(sampleRegistry).sort()).toEqual(['checkout-en', 'checkout-es', 'iot-telemetry']);
  });

  it('checkout exists in Spanish and English with identical structure', () => {
    const es = sampleRegistry['checkout-es']!;
    const en = sampleRegistry['checkout-en']!;
    expect(es.language).toBe('es');
    expect(en.language).toBe('en');
    expect(shape(es)).toEqual(shape(en));
    expect(es.nodes.find((n) => n.id === 'worker')!.summary).not.toBe(en.nodes.find((n) => n.id === 'worker')!.summary);
  });

  it('checkout covers every risk category, nesting two levels deep, code and changes', () => {
    const s = sampleRegistry['checkout-es']!;
    expect(new Set(s.risks.map((r) => r.category))).toEqual(new Set(['performance', 'security', 'complexity', 'reliability']));
    expect(Math.max(...indexScene(s).depth.values())).toBe(2);
    expect(s.nodes.some((n) => n.code?.snippet)).toBe(true);
    expect(s.nodes.some((n) => n.change)).toBe(true);
  });

  it('every non-logic top-level piece in checkout declares scale', () => {
    const s = sampleRegistry['checkout-en']!;
    s.nodes.filter((n) => !n.parent && n.role !== 'actor').forEach((n) => expect(n.scale, n.id).toBeDefined());
  });

  it('every top-level step travels an edge', () => {
    sampleScenes.forEach((s) => flattenSteps(s.steps, new Set()).forEach((f) => expect(f.step.travel, `${s.id}/${f.step.id}`).toBeDefined()));
  });

  it('iot telemetry is a non-web system with sub-steps', () => {
    const s = sampleRegistry['iot-telemetry']!;
    expect(s.nodes.map((n) => n.role)).toContain('channel');
    expect(s.steps.some((st) => st.substeps.length > 0)).toBe(true);
  });

  it('defineScene throws readable errors', () => {
    expect(() => defineScene({ id: 'x', title: 'x', language: 'en', nodes: [{ id: 'a', label: 'A', role: 'actor', kind: 'k', summary: 's', parent: 'b' }] })).toThrow(
      /nodes\.0\.parent: unknown node "b"/,
    );
  });
});
