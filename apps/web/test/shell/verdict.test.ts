import { sampleRegistry, type Scene } from '@rdi/scene';
import { verdictOf } from '../../src/shell/pulls/verdict';

const base = sampleRegistry['iot-telemetry']!;
const scene = (risks: Scene['risks']): Scene => ({ ...base, risks });
const risk = (id: string, severity: Scene['risks'][number]['severity'], title = `Risk ${id}`, mitigation?: string): Scene['risks'][number] => ({ id, title, category: 'security', severity, explanation: `why ${id}`, nodeIds: [base.nodes[0]!.id], ...(mitigation ? { mitigation } : {}) });

describe('verdictOf', () => {
  it('passes when there are only low risks', () => {
    expect(verdictOf(scene([risk('r1', 'low')]))).toMatchObject({ status: 'pass', blockers: [], warnings: [], total: 1 });
  });

  it('warns on medium risks and fails on high, critical or broken rules, with what to do and where', () => {
    const warn = verdictOf(scene([risk('r1', 'medium', 'Slow path', 'Add an index')]));
    expect(warn.status).toBe('warn');
    expect(warn.warnings[0]).toMatchObject({ title: 'Slow path', what: 'Add an index', where: null });
    const fail = verdictOf(scene([risk('r1', 'high', 'Breaks callers'), risk('r2', 'low', 'Rule: every endpoint validates its body', 'Add a schema'), risk('r3', 'medium')]), [
      { id: 'r1', title: 'Breaks callers', severity: 'high', category: 'security', pieces: [], anchor: { path: 'src/a.ts', line: 12 } },
    ]);
    expect(fail.status).toBe('fail');
    expect(fail.blockers.map((b) => [b.title, b.where, b.rule])).toEqual([['Breaks callers', 'src/a.ts:12', false], ['Rule: every endpoint validates its body', null, true]]);
    expect(fail.blockers[0]!.what).toBe('why r1');
    expect(fail.warnings).toHaveLength(1);
  });
});
