import { describe, expect, it } from 'vitest';
import { validateScene } from '../src/index';

const base = () => ({
  id: 'mini',
  title: 'Mini',
  language: 'en',
  nodes: [
    { id: 'client', label: 'Client', role: 'actor', kind: 'browser', summary: 'The user.' },
    { id: 'api', label: 'API', role: 'compute', kind: 'REST', summary: 'Handles requests.', repo: 'svc' },
    { id: 'worker', label: 'Worker', role: 'compute', kind: 'job runner', summary: 'Processes jobs.', repo: 'svc' },
    { id: 'algo', label: 'algo()', role: 'logic', kind: 'function', summary: 'Core logic.', parent: 'worker', complexity: { time: 'O(n)' } },
  ],
  edges: [
    { id: 'e1', from: 'client', to: 'api', kind: 'sync' },
    { id: 'e2', from: 'api', to: 'algo', kind: 'async' },
  ],
  steps: [
    { id: 's1', narration: 'Client calls API', focus: ['api'], travel: { edgeId: 'e1' } },
    { id: 's2', narration: 'Worker runs', focus: ['worker'], expand: 'worker', substeps: [{ id: 's2-1', narration: 'algo runs', focus: ['algo'], travel: { edgeId: 'e2' } }] },
  ],
  risks: [{ id: 'r1', category: 'performance', severity: 'high', title: 'Slow', explanation: 'It is slow.', nodeIds: ['algo'] }],
});

const errorsOf = (input: unknown) => {
  const result = validateScene(input);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
};

describe('validateScene', () => {
  it('accepts a valid scene and applies defaults', () => {
    const result = validateScene(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.groups).toEqual([]);
    expect(result.scene.steps[0]?.highlight).toEqual([]);
    expect(result.scene.steps[0]?.travel?.reverse).toBe(false);
    expect(result.scene.steps[1]?.substeps[0]?.substeps).toEqual([]);
  });

  it('rejects unknown roles and bad language tags with dotted paths', () => {
    const scene = { ...base(), language: 'Spanish' };
    (scene.nodes[0] as { role: string }).role = 'robot';
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^language: /), expect.stringMatching(/^nodes\.0\.role: /)]),
    );
  });

  it('rejects duplicate ids across every kind, including nested steps', () => {
    const scene = base();
    scene.nodes.push({ id: 'api', label: 'Dup', role: 'data', kind: 'x', summary: 'x' } as never);
    scene.edges.push({ id: 'e1', from: 'api', to: 'client', kind: 'sync' });
    scene.steps[1]!.substeps!.push({ id: 's1', narration: 'dup', focus: [] } as never);
    scene.risks.push({ ...scene.risks[0]! });
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'nodes.4.id: duplicate node id "api"',
        'edges.2.id: duplicate edge id "e1"',
        'steps.1.substeps.1.id: duplicate step id "s1"',
        'risks.1.id: duplicate risk id "r1"',
      ]),
    );
  });

  it('rejects unknown parents and parent cycles', () => {
    const scene = base();
    scene.nodes[1] = { ...scene.nodes[1]!, parent: 'ghost' } as never;
    scene.nodes[2] = { ...scene.nodes[2]!, parent: 'algo' } as never;
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['nodes.1.parent: unknown node "ghost"', 'nodes.2.parent: parent cycle through "worker"']),
    );
  });

  it('rejects complexity on non-logic nodes and inverted code ranges', () => {
    const scene = base();
    scene.nodes[1] = { ...scene.nodes[1]!, complexity: { time: 'O(1)' }, code: { repo: 'svc', path: 'a.ts', startLine: 9, endLine: 3, language: 'ts' } } as never;
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'nodes.1.complexity: only "logic" nodes can declare complexity',
        'nodes.1.code.endLine: must be >= startLine',
      ]),
    );
  });

  it('rejects dangling references in edges, groups, steps and risks', () => {
    const scene = {
      ...base(),
      edges: [{ id: 'e1', from: 'client', to: 'ghost', kind: 'sync' }],
      groups: [{ id: 'g', label: 'G', nodeIds: ['nobody', 'algo'] }],
      steps: [{ id: 's1', narration: 'x', focus: ['ghost'], highlight: ['ghost2'], travel: { edgeId: 'nope' }, annotate: [{ nodeId: 'ghost3', text: 't' }] }],
      risks: [{ id: 'r1', category: 'security', severity: 'low', title: 't', explanation: 'e', nodeIds: ['ghost4'] }],
    };
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'edges.0.to: unknown node "ghost"',
        'groups.0.nodeIds.0: unknown node "nobody"',
        'groups.0.nodeIds.1: node "algo" is an internal piece; only top-level nodes can be grouped',
        'steps.0.focus.0: unknown node "ghost"',
        'steps.0.highlight.0: unknown node "ghost2"',
        'steps.0.travel.edgeId: unknown edge "nope"',
        'steps.0.annotate.0.nodeId: unknown node "ghost3"',
        'risks.0.nodeIds.0: unknown node "ghost4"',
      ]),
    );
  });

  it('rejects group ids that collide with node ids and nodes in two groups', () => {
    const scene = { ...base(), groups: [{ id: 'api', label: 'A', nodeIds: ['client'] }, { id: 'g2', label: 'B', nodeIds: ['client'] }] };
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'groups.0.id: id "api" is already used by a node',
        'groups.1.nodeIds.0: node "client" already belongs to group "api"',
      ]),
    );
  });

  it('requires expand on steps with substeps and children on the expanded node', () => {
    const scene = base();
    scene.steps[0] = { ...scene.steps[0]!, substeps: [{ id: 's1-1', narration: 'x', focus: [] }] } as never;
    scene.steps[1] = { ...scene.steps[1]!, expand: 'api' } as never;
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['steps.0.substeps: sub-steps require "expand"', 'steps.1.expand: node "api" has no internal pieces']),
    );
  });
});
