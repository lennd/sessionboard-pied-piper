import { sampleRegistry, validateScene, type Scene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import { matchNode, overlayChanges } from '../src/impact/overlay';

const code = (path: string) => ({ repo: 'r', path, startLine: 1, endLine: 2, language: 'ts' });
const map: Scene = {
  ...sampleRegistry['iot-telemetry']!,
  nodes: [
    { id: 'api', label: 'API', role: 'compute', kind: 'svc', summary: 's', code: code('apps/api/src/app.ts') },
    { id: 'auth', label: 'Auth', role: 'logic', kind: 'module', summary: 's', parent: 'api', code: code('apps/api/src/auth/login.ts') },
    { id: 'web', label: 'Web', role: 'actor', kind: 'spa', summary: 's', code: code('apps/web/src/main.tsx') },
    { id: 'db', label: 'DB', role: 'storage', kind: 'pg', summary: 's', code: code('db') },
    { id: 'queue', label: 'Queue', role: 'channel', kind: 'sqs', summary: 's' },
    { id: 'readme', label: 'Docs', role: 'data', kind: 'md', summary: 's', code: code('README.md') },
  ],
  edges: [
    { id: 'e1', from: 'web', to: 'api', kind: 'sync' },
    { id: 'e2', from: 'api', to: 'db', kind: 'write' },
    { id: 'e3', from: 'api', to: 'queue', kind: 'async' },
  ],
  steps: [],
  risks: [{ id: 'r0', title: 'Existing', category: 'security', severity: 'high', explanation: 'x', nodeIds: ['api'] }],
};

describe('matchNode', () => {
  it('matches exact files, files under a directory reference and siblings in the same folder, but not root-level neighbours', () => {
    expect(matchNode(map.nodes[1]!, [{ path: 'apps/api/src/auth/login.ts', change: 'modified' }])?.path).toBe('apps/api/src/auth/login.ts');
    expect(matchNode(map.nodes[3]!, [{ path: 'db/migrations/001.sql', change: 'added' }])?.path).toBe('db/migrations/001.sql');
    expect(matchNode(map.nodes[0]!, [{ path: 'apps/api/src/server.ts', change: 'modified' }])?.path).toBe('apps/api/src/server.ts');
    expect(matchNode(map.nodes[5]!, [{ path: 'package.json', change: 'modified' }])).toBeNull();
    expect(matchNode(map.nodes[0]!, [{ path: 'apps/api/src/store/json.ts', change: 'modified' }])).toBeNull();
    expect(matchNode(map.nodes[4]!, [{ path: 'anything', change: 'modified' }])).toBeNull();
  });
});

describe('overlayChanges', () => {
  it('marks changed pieces and their parents, flags neighbours as risks and keeps the scene valid', () => {
    const scene = overlayChanges(map, [{ path: 'apps/api/src/auth/login.ts', change: 'modified' }, { path: 'apps/web/src/main.tsx', change: 'added' }], { id: 'impact-s1', title: 'Session 1' });
    expect(validateScene(scene).ok).toBe(true);
    expect(scene.id).toBe('impact-s1');
    expect(Object.fromEntries(scene.nodes.map((n) => [n.id, n.change ?? null]))).toEqual({ api: 'modified', auth: 'modified', web: 'added', db: null, queue: null, readme: null });
    expect(scene.risks.map((r) => r.id)).toEqual(['r0', 'impact-db', 'impact-queue']);
    expect(scene.risks[1]).toMatchObject({ nodeIds: ['db'], severity: 'low', category: 'reliability' });
    expect(scene.risks[1]!.explanation).toContain('API');
    expect(map.nodes[1]!.change).toBeUndefined();
  });

  it('clears stale change marks and impact risks when applied again with nothing touched', () => {
    const first = overlayChanges(map, [{ path: 'db/x.sql', change: 'removed' }], { id: 'i', title: 't' });
    expect(first.nodes.find((n) => n.id === 'db')!.change).toBe('removed');
    const second = overlayChanges(first, [], { id: 'i', title: 't' });
    expect(second.nodes.every((n) => n.change === undefined)).toBe(true);
    expect(second.risks.map((r) => r.id)).toEqual(['r0']);
  });
});
