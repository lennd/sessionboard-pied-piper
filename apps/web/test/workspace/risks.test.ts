import { indexScene } from '@rdi/scene/v2';
import { aggregateSeverity, maxSeverity, risksByNode, worstScale } from '../../src/workspace/engine/risks';
import { fixtureScene } from './fixture';

const scene = fixtureScene();

describe('risk helpers', () => {
  it('indexes risks by node and ranks severity', () => {
    const byNode = risksByNode(scene);
    expect(byNode.get('lock')?.map((r) => r.id)).toEqual(['r1']);
    expect(maxSeverity([...byNode.get('lock')!, ...byNode.get('api')!])).toBe('critical');
    expect(maxSeverity([])).toBeUndefined();
  });

  it('aggregates severity over descendants', () => {
    const byNode = risksByNode(scene);
    const index = indexScene(scene);
    expect(aggregateSeverity(index, byNode, ['worker'])).toBe('high');
    expect(aggregateSeverity(index, byNode, ['db'])).toBeUndefined();
  });

  it('returns the worst scale status of a node', () => {
    expect(worstScale(scene.nodes.find((n) => n.id === 'api')!)).toBe('saturated');
    expect(worstScale(scene.nodes.find((n) => n.id === 'db')!)).toBeUndefined();
  });
});
