import { sampleRegistry, type Scene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import { anchorRisks, buildReview, commentBody, diffLines, SIGNATURE } from '../src/impact/anchors';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts',
  '@@ -10,4 +10,6 @@', ' ctx', '-old', '+new1', '+new2', ' ctx', ' ctx', '+new3',
  'diff --git a/src/n.ts b/src/n.ts', 'new file mode 100644', '--- /dev/null', '+++ b/src/n.ts', '@@ -0,0 +1,2 @@', '+x', '+y',
].join('\n');
const code = (path: string, startLine: number, endLine: number) => ({ repo: 'r', path, startLine, endLine, language: 'ts' });
const scene: Scene = {
  ...sampleRegistry['iot-telemetry']!,
  nodes: [
    { id: 'a', label: 'A', role: 'compute', kind: 'k', summary: 's', code: code('src/a.ts', 14, 20) },
    { id: 'b', label: 'B', role: 'compute', kind: 'k', summary: 's', code: code('src/a.ts', 1, 2) },
    { id: 'n', label: 'N', role: 'logic', kind: 'k', summary: 's', code: code('./src/n.ts', 1, 9) },
    { id: 'z', label: 'Z', role: 'storage', kind: 'k', summary: 's', code: code('src/z.ts', 1, 9) },
    { id: 'q', label: 'Q', role: 'channel', kind: 'k', summary: 's' },
  ],
  edges: [], steps: [],
  risks: [
    { id: 'r1', title: 'Exact', category: 'security', severity: 'high', explanation: 'e1', mitigation: 'm1', nodeIds: ['a'] },
    { id: 'r2', title: 'File fallback', category: 'performance', severity: 'low', explanation: 'e2', nodeIds: ['b'] },
    { id: 'r3', title: 'Second piece anchors', category: 'reliability', severity: 'medium', explanation: 'e3', nodeIds: ['z', 'n'] },
    { id: 'r4', title: 'Nowhere', category: 'complexity', severity: 'critical', explanation: 'e4', nodeIds: ['q', 'z'] },
  ],
};

describe('diffLines', () => {
  it('collects the new-side line numbers of added lines per file', () => {
    const lines = diffLines(DIFF);
    expect(lines.get('src/a.ts')!.added).toEqual([11, 12, 15]);
    expect(lines.get('src/n.ts')!.added).toEqual([1, 2]);
  });
});

describe('anchorRisks', () => {
  it('prefers a changed line inside the piece, then the first changed line of its file, then the next piece', () => {
    const anchored = anchorRisks(scene, diffLines(DIFF));
    expect(anchored.map((e) => [e.risk.id, e.anchor])).toEqual([
      ['r1', { path: 'src/a.ts', line: 15 }],
      ['r2', { path: 'src/a.ts', line: 11 }],
      ['r3', { path: 'src/n.ts', line: 1 }],
      ['r4', null],
    ]);
    expect(anchored[3]!.pieces).toEqual(['Q', 'Z']);
  });

  it('builds a review with inline comments and a summary for unanchored risks', () => {
    const entries = anchorRisks(scene, diffLines(DIFF));
    const review = buildReview(entries, null);
    expect(review.comments).toHaveLength(3);
    expect(review.comments[0]).toMatchObject({ path: 'src/a.ts', line: 15, side: 'RIGHT' });
    expect(review.comments[0]!.body).toContain('🟠 high · security: Exact');
    expect(review.comments[0]!.body).toContain('**Mitigation:** m1');
    expect(review.body).toContain('4 risks');
    expect(review.body).toContain('Nowhere');
    expect(review.body.endsWith(SIGNATURE)).toBe(true);
    expect(buildReview(entries.slice(0, 1), 'Custom intro').body.startsWith('Custom intro')).toBe(true);
    expect(commentBody(entries[1]!)).not.toContain('Mitigation');
  });
});
