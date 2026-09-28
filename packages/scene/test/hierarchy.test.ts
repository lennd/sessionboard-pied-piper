import { describe, expect, it } from 'vitest';
import { ancestorsOf, computeVisible, descendantsOf, indexScene, projectEdges, topLevelGroups, validateScene } from '../src/index';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const none = new Set<string>();
const sorted = (s: Iterable<string>) => [...s].sort();
const pairs = (level: Parameters<typeof computeVisible>[2], local = none) =>
  projectEdges(scene, computeVisible(scene, index, level, local)).edges.map((e) => `${e.key}:${e.edgeIds.join('+')}`);

describe('indexScene', () => {
  it('computes children, depth, top level, ancestors and descendants', () => {
    expect(index.children.get('worker')).toEqual(['reserve']);
    expect(index.depth.get('lock')).toBe(2);
    expect(index.topLevel).toEqual(['client', 'api', 'worker', 'db', 'pay']);
    expect(ancestorsOf(index, 'lock')).toEqual(['reserve', 'worker']);
    expect(descendantsOf(index, 'worker')).toEqual(['reserve', 'lock']);
  });
});

describe('computeVisible', () => {
  it('architecture shows top-level pieces and maps internals to their visible ancestor', () => {
    const m = computeVisible(scene, index, 'architecture', none);
    expect(sorted(m.visible)).toEqual(['api', 'client', 'db', 'pay', 'worker']);
    expect(m.expanded.size).toBe(0);
    expect(m.representative.get('lock')).toBe('worker');
    expect(pairs('architecture')).toEqual(['client->api:e1', 'api->worker:e2', 'worker->db:e3+e5', 'worker->pay:e4']);
  });

  it('components expands top-level pieces with children', () => {
    const m = computeVisible(scene, index, 'components', none);
    expect(sorted(m.expanded)).toEqual(['worker']);
    expect(m.visible.has('reserve')).toBe(true);
    expect(m.representative.get('lock')).toBe('reserve');
    expect(pairs('components')).toEqual(['client->api:e1', 'api->worker:e2', 'reserve->db:e3+e5', 'worker->pay:e4']);
  });

  it('detail expands everything', () => {
    const m = computeVisible(scene, index, 'detail', none);
    expect(sorted(m.expanded)).toEqual(['reserve', 'worker']);
    expect(pairs('detail')).toEqual(['client->api:e1', 'api->worker:e2', 'reserve->db:e3', 'worker->pay:e4', 'lock->db:e5', 'reserve->lock:e6']);
  });

  it('system collapses each repo into a box and keeps repo-less pieces', () => {
    const m = computeVisible(scene, index, 'system', new Set(['worker']));
    expect(m.repoBoxes.get('repo:svc')).toEqual(['api', 'worker', 'db']);
    expect(m.repoBoxes.get('repo:web')).toEqual(['client']);
    expect(sorted(m.visible)).toEqual(['pay']);
    expect(m.expanded.size).toBe(0);
    expect(m.representative.get('lock')).toBe('repo:svc');
    expect(pairs('system')).toEqual(['repo:web->repo:svc:e1', 'repo:svc->pay:e4']);
  });

  it('local expansion adds the node and its ancestors; leaves are ignored', () => {
    const m = computeVisible(scene, index, 'architecture', new Set(['reserve', 'db', 'ghost']));
    expect(sorted(m.expanded)).toEqual(['reserve', 'worker']);
    expect(m.visible.has('lock')).toBe(true);
  });

  it('keyOf omits edges that collapse into one visible piece', () => {
    const projected = projectEdges(scene, computeVisible(scene, index, 'architecture', none));
    expect(projected.keyOf.get('e3')).toBe('worker->db');
    expect(projected.keyOf.has('e6')).toBe(false);
  });
});

describe('topLevelGroups', () => {
  it('groups by repo when no explicit groups exist', () => {
    expect(topLevelGroups(scene, index.topLevel)).toEqual([
      { id: 'group:web', label: 'web', nodeIds: ['client'] },
      { id: 'group:svc', label: 'svc', nodeIds: ['api', 'worker', 'db'] },
    ]);
  });

  it('uses explicit groups filtered to visible nodes', () => {
    const result = validateScene({ ...scene, groups: [{ id: 'core', label: 'Core', nodeIds: ['api', 'db'] }] });
    if (!result.ok) throw new Error(result.errors.join());
    expect(topLevelGroups(result.scene, ['api', 'client'])).toEqual([{ id: 'core', label: 'Core', nodeIds: ['api'] }]);
  });
});
