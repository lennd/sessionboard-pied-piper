import { validateScene, type Scene } from '../../src/v2/index';

export const fixtureScene = (): Scene => {
  const result = validateScene({
    id: 'fx',
    title: 'Fixture',
    language: 'en',
    nodes: [
      { id: 'client', label: 'Client', role: 'actor', kind: 'browser', summary: 's', repo: 'web' },
      { id: 'api', label: 'API', role: 'compute', kind: 'REST', summary: 's', repo: 'svc' },
      { id: 'worker', label: 'Worker', role: 'compute', kind: 'jobs', summary: 's', repo: 'svc' },
      { id: 'reserve', label: 'reserve()', role: 'logic', kind: 'fn', summary: 's', parent: 'worker' },
      { id: 'lock', label: 'lock()', role: 'logic', kind: 'fn', summary: 's', parent: 'reserve' },
      { id: 'db', label: 'DB', role: 'storage', kind: 'pg', summary: 's', repo: 'svc' },
      { id: 'pay', label: 'Payments', role: 'external', kind: 'stripe', summary: 's' },
    ],
    edges: [
      { id: 'e1', from: 'client', to: 'api', kind: 'sync', label: 'POST' },
      { id: 'e2', from: 'api', to: 'worker', kind: 'async' },
      { id: 'e3', from: 'reserve', to: 'db', kind: 'write', label: 'reserve' },
      { id: 'e4', from: 'worker', to: 'pay', kind: 'calls' },
      { id: 'e5', from: 'lock', to: 'db', kind: 'read', label: 'lock' },
      { id: 'e6', from: 'reserve', to: 'lock', kind: 'calls' },
    ],
    steps: [
      { id: 's1', narration: 'call', focus: ['api'], travel: { edgeId: 'e1' } },
      { id: 's2', narration: 'work', focus: ['worker'], travel: { edgeId: 'e2' }, expand: 'worker', substeps: [
        { id: 's2-1', narration: 'reserve', focus: ['reserve'], travel: { edgeId: 'e3' }, expand: 'reserve', substeps: [
          { id: 's2-1-1', narration: 'lock', focus: ['lock'], travel: { edgeId: 'e5' } },
        ] },
        { id: 's2-2', narration: 'inner call', focus: ['lock'], travel: { edgeId: 'e6' } },
      ] },
      { id: 's3', narration: 'pay', focus: ['pay'], travel: { edgeId: 'e4' } },
    ],
    risks: [{ id: 'r1', category: 'performance', severity: 'high', title: 'contention', explanation: 'x', nodeIds: ['lock'] }],
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.scene;
};
