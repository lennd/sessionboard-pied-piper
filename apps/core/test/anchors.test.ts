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

  it('remembers the hunk of every added line', () => {
    const two = [...DIFF.split('\n').slice(0, 5), '+first', '@@ -30,1 +31,2 @@', ' ctx', '+second'].join('\n');
    const file = diffLines(two).get('src/a.ts')!;
    expect(file.added).toEqual([10, 32]);
    expect([file.hunkOf.get(10), file.hunkOf.get(32)]).toEqual([0, 1]);
  });
});

describe('anchorRisks', () => {
  it('prefers a changed line inside the piece, then the first changed line of its file, then the next piece', () => {
    const anchored = anchorRisks(scene, diffLines(DIFF));
    expect(anchored.map((e) => [e.risk.id, e.anchor])).toEqual([
      ['r1', { path: 'src/a.ts', line: 15 }],
      ['r2', { path: 'src/a.ts', line: 11 }],
      ['r3', { path: 'src/n.ts', startLine: 1, line: 2 }],
      ['r4', null],
    ]);
    expect(anchored[3]!.pieces).toEqual(['Q', 'Z']);
  });

  it('highlights the exact lines the risk points at before the piece it names', () => {
    const risky: Scene = { ...scene, risks: [
      { id: 'own', title: 'Own range', category: 'security', severity: 'high', explanation: 'e', nodeIds: ['b'], code: { path: 'src/a.ts', startLine: 11, endLine: 12 } },
      { id: 'single', title: 'One line', category: 'security', severity: 'high', explanation: 'e', nodeIds: ['b'], code: { path: 'src/a.ts', startLine: 15, endLine: 18 } },
      { id: 'elsewhere', title: 'Range outside the diff', category: 'security', severity: 'high', explanation: 'e', nodeIds: ['a'], code: { path: 'src/a.ts', startLine: 100, endLine: 120 } },
      { id: 'piece', title: 'Whole new piece', category: 'security', severity: 'low', explanation: 'e', nodeIds: ['n'] },
    ] };
    expect(anchorRisks(risky, diffLines(DIFF)).map((e) => [e.risk.id, e.anchor])).toEqual([
      ['own', { path: 'src/a.ts', startLine: 11, line: 12 }],
      ['single', { path: 'src/a.ts', line: 15 }],
      ['elsewhere', { path: 'src/a.ts', line: 15 }],
      ['piece', { path: 'src/n.ts', startLine: 1, line: 2 }],
    ]);
  });

  it('keeps a highlighted range inside one hunk and under the span cap', () => {
    const big = ['diff --git a/big.ts b/big.ts', '--- a/big.ts', '+++ b/big.ts', '@@ -0,0 +1,60 @@', ...Array.from({ length: 60 }, (_, i) => `+l${i}`), '@@ -70,0 +100,2 @@', '+tail1', '+tail2'].join('\n');
    const whole: Scene = { ...scene, nodes: [{ id: 'f', label: 'F', role: 'logic', kind: 'k', summary: 's', code: code('big.ts', 1, 200) }], risks: [
      { id: 'piece', title: 'Whole file', category: 'complexity', severity: 'low', explanation: 'e', nodeIds: ['f'] },
      { id: 'own', title: 'Across hunks', category: 'complexity', severity: 'low', explanation: 'e', nodeIds: ['f'], code: { path: 'big.ts', startLine: 55, endLine: 101 } },
    ] };
    expect(anchorRisks(whole, diffLines(big)).map((e) => e.anchor)).toEqual([
      { path: 'big.ts', startLine: 1, line: 40 },
      { path: 'big.ts', startLine: 55, line: 60 },
    ]);
  });

  it('builds a review with inline comments and a summary for unanchored risks', () => {
    const entries = anchorRisks(scene, diffLines(DIFF));
    const review = buildReview(entries, null);
    expect(review.comments).toHaveLength(3);
    expect(review.comments[0]).toMatchObject({ path: 'src/a.ts', line: 15, side: 'RIGHT' });
    expect(review.comments[2]).toMatchObject({ path: 'src/n.ts', start_line: 1, line: 2 });
    expect(review.comments[0]!.body).toContain('🟠 high · security: Exact');
    expect(review.comments[0]!.body).toContain('**Mitigation:** m1');
    expect(review.body).toContain('4 risks');
    expect(review.body).toContain('Nowhere');
    expect(review.body.endsWith(SIGNATURE)).toBe(true);
    expect(buildReview(entries.slice(0, 1), 'Custom intro').body.startsWith('Custom intro')).toBe(true);
    expect(commentBody(entries[1]!)).not.toContain('Mitigation');
  });

  it('sends ranges as multi-line comments and names the code of summary risks', () => {
    const risky: Scene = { ...scene, risks: [
      { id: 'own', title: 'Own range', category: 'security', severity: 'high', explanation: 'e', nodeIds: ['b'], code: { path: 'src/a.ts', startLine: 11, endLine: 12 } },
      { id: 'far', title: 'Not in the diff', category: 'security', severity: 'low', explanation: 'e', nodeIds: ['q'], code: { path: 'src/q.ts', startLine: 7, endLine: 9 } },
    ] };
    const review = buildReview(anchorRisks(risky, diffLines(DIFF)), null);
    expect(review.comments).toEqual([expect.objectContaining({ path: 'src/a.ts', start_line: 11, start_side: 'RIGHT', line: 12, side: 'RIGHT' })]);
    expect(review.body).toContain('Not in the diff');
    expect(review.body).toContain('at `src/q.ts:7-9`');
  });
});
