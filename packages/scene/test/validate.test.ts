import { describe, expect, it } from 'vitest';
import { validateScene } from '../src/index';

const base = () => ({
  id: 's1',
  title: 'Minimal flow',
  kind: 'flow',
  nodes: [
    { id: 'client', type: 'client', label: 'Browser' },
    { id: 'api', type: 'service', label: 'API' },
  ],
  edges: [{ id: 'e1', from: 'client', to: 'api', kind: 'sync' }],
  steps: [{ narration: 'The browser calls the API', focus: ['api'], travel: { edgeId: 'e1' } }],
});

const errorsOf = (input: unknown) => {
  const result = validateScene(input);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
};

describe('validateScene', () => {
  it('accepts a minimal valid scene and applies defaults', () => {
    const result = validateScene(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.groups).toEqual([]);
    expect(result.scene.nodes[0]?.meta).toEqual({});
    expect(result.scene.steps[0]?.highlight).toEqual([]);
  });

  it('reports schema errors with dotted paths', () => {
    const scene = base();
    (scene.nodes[0] as { type: string }).type = 'spaceship';
    expect(errorsOf(scene)).toEqual([expect.stringMatching(/^nodes\.0\.type: /)]);
  });

  it('rejects labels longer than 120 characters', () => {
    const scene = base();
    scene.nodes[0]!.label = 'x'.repeat(121);
    expect(errorsOf(scene)[0]).toMatch(/^nodes\.0\.label: /);
  });

  it('rejects duplicate node and edge ids', () => {
    const scene = base();
    scene.nodes.push({ id: 'api', type: 'db', label: 'Dup' });
    scene.edges.push({ id: 'e1', from: 'api', to: 'client', kind: 'sync' });
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['nodes.2.id: duplicate node id "api"', 'edges.1.id: duplicate edge id "e1"']),
    );
  });

  it('rejects edges, steps, groups and zoom pointing at unknown ids', () => {
    const scene = {
      ...base(),
      edges: [{ id: 'e1', from: 'client', to: 'ghost', kind: 'sync' }],
      groups: [{ id: 'g', label: 'G', nodeIds: ['nobody'] }],
      steps: [
        { narration: 'x', focus: ['ghost'], highlight: ['ghost2'], travel: { edgeId: 'nope' }, annotate: [{ nodeId: 'ghost3', text: 't' }] },
      ],
      zoom: { ghost4: 'other-scene' },
    };
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'edges.0.to: unknown node "ghost"',
        'groups.0.nodeIds.0: unknown node "nobody"',
        'steps.0.focus.0: unknown node "ghost"',
        'steps.0.highlight.0: unknown node "ghost2"',
        'steps.0.travel.edgeId: unknown edge "nope"',
        'steps.0.annotate.0.nodeId: unknown node "ghost3"',
        'zoom.ghost4: unknown node "ghost4"',
      ]),
    );
  });

  it('rejects a node that belongs to two groups', () => {
    const scene = {
      ...base(),
      groups: [
        { id: 'g1', label: 'A', nodeIds: ['api'] },
        { id: 'g2', label: 'B', nodeIds: ['api'] },
      ],
    };
    expect(errorsOf(scene)).toContain('groups.1.nodeIds.0: node "api" already belongs to group "g1"');
  });

  it('rejects group ids that collide with node ids or other groups', () => {
    const scene = {
      ...base(),
      groups: [
        { id: 'api', label: 'A', nodeIds: ['client'] },
        { id: 'g', label: 'B', nodeIds: ['api'] },
        { id: 'g', label: 'C', nodeIds: [] as string[] },
      ],
    };
    scene.groups[2]!.nodeIds = ['client'];
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['groups.0.id: id "api" is already used by a node', 'groups.2.id: duplicate group id "g"']),
    );
  });

  it('rejects a scene that zooms into itself', () => {
    expect(errorsOf({ ...base(), zoom: { api: 's1' } })).toContain('zoom.api: a scene cannot zoom into itself');
  });

  it('requires steps for flow and algorithm scenes', () => {
    expect(errorsOf({ ...base(), steps: [] })).toContain('steps: a "flow" scene needs at least one step');
  });

  it('requires load config for load scenes and valid load references', () => {
    expect(errorsOf({ ...base(), kind: 'load', steps: [] })).toContain('load: a "load" scene needs a load config');
    const scene = {
      ...base(),
      kind: 'load',
      steps: [],
      load: { rps: 10, nodes: { ghost: { capacity: 5, latencyMs: 1 } }, queues: { api: { consumers: 2 } } },
    };
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['load.nodes.ghost: unknown node "ghost"', 'load.queues.api: node "api" is not a queue']),
    );
  });

  it('accepts a zero-step diff-impact scene', () => {
    const scene = { ...base(), kind: 'diff-impact', steps: [] };
    expect(validateScene(scene).ok).toBe(true);
  });
});
