import { describe, expect, it } from 'vitest';
import { diffScenes, sampleRegistry, validateScene } from '../src/index';

const before = sampleRegistry['iot-telemetry']!;

describe('diffScenes', () => {
  it('marks added, modified and removed pieces and stays a valid scene', () => {
    const [first, second, ...rest] = before.nodes;
    const after = {
      ...before,
      nodes: [{ ...first!, summary: 'Changed summary' }, ...rest, { id: 'cache', label: 'Cache', role: 'storage' as const, kind: 'Redis', summary: 'New cache' }],
      edges: before.edges.filter((e) => e.from !== second!.id && e.to !== second!.id),
      steps: [],
    };
    const diff = diffScenes(before, after);
    expect(validateScene(diff).ok).toBe(true);
    expect(diff.id).toBe(`${before.id}-changes`);
    const change = Object.fromEntries(diff.nodes.map((n) => [n.id, n.change ?? null]));
    expect(change[first!.id]).toBe('modified');
    expect(change.cache).toBe('added');
    expect(change[second!.id]).toBe('removed');
    expect(change[rest[0]!.id]).toBeNull();
  });

  it('stays within the scene limits when many pieces were replaced', () => {
    const big = (prefix: string) => ({ ...before, id: `big-${prefix}`, edges: [], steps: [], risks: [], groups: [], nodes: Array.from({ length: 150 }, (_, i) => ({ id: `${prefix}${i}`, label: `${prefix}${i}`, role: 'compute' as const, kind: 'svc', summary: 's' })) });
    const diff = diffScenes(big('a'), big('b'));
    expect(validateScene(diff).ok).toBe(true);
    expect(diff.nodes.length).toBeLessThanOrEqual(150);
    expect(diff.nodes.filter((n) => n.change === 'added')).toHaveLength(150);
  });
});

