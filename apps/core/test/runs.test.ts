import { describe, expect, it } from 'vitest';
import { createFakeQuery } from '../src/agent/fakeQuery';
import { createRunRegistry, type RunEvent } from '../src/runs/registry';
import { agentConfig, scripted } from './agent/scripted';

const until = (predicate: () => boolean, ms = 2000) =>
  new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => (predicate() ? resolve() : Date.now() - started > ms ? reject(new Error('timeout')) : setTimeout(tick, 5));
    tick();
  });
const base = { repoId: 'r1', repoPath: '/tmp', solutionId: 'sol', agent: agentConfig, mcpHttpUrl: 'http://127.0.0.1:4040/mcp/r1', now: () => new Date('2026-10-13T10:00:00Z') };

describe('run registry', () => {
  it('runs a solution, asks the user before non-edit tools and finishes when allowed', async () => {
    const runs = createRunRegistry();
    const started = runs.start({ ...base, queryFn: createFakeQuery() });
    if ('error' in started) throw new Error(started.error);
    const seen: RunEvent[] = [];
    runs.subscribe(started.id, (e) => seen.push(e));
    await until(() => runs.get(started.id)!.pending.length === 1);
    const permission = runs.get(started.id)!.events.find((e) => e.type === 'permission') as Extract<RunEvent, { type: 'permission' }>;
    expect(permission).toMatchObject({ tool: 'Bash', input: { command: 'npm test' } });
    expect(runs.start({ ...base, queryFn: createFakeQuery() })).toEqual({ error: 'already_running' });
    expect(runs.resolvePermission(started.id, 'nope', true)).toBe(false);
    expect(runs.resolvePermission(started.id, permission.id, true)).toBe(true);
    await until(() => runs.get(started.id)!.status !== 'running');
    const run = runs.get(started.id)!;
    expect(run).toMatchObject({ status: 'done', pending: [], usage: { input: 100, output: 20 } });
    expect(run.sdkSessionId).toMatch(/^fake-session-/);
    expect(seen.map((e) => e.type)).toEqual(['text', 'tool', 'permission', 'permission_resolved', 'tool', 'text', 'status']);
    expect(run.events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)).toEqual(['Reading the solution. ', 'Task t1 done.']);
    expect(runs.list('r1')).toEqual([expect.objectContaining({ id: started.id, status: 'done' })]);
    expect(runs.list('other')).toEqual([]);
  });

  it('denies tools the user refuses and reports cancelled runs', async () => {
    const runs = createRunRegistry();
    const denied = runs.start({ ...base, queryFn: createFakeQuery() });
    if ('error' in denied) throw new Error(denied.error);
    await until(() => runs.get(denied.id)!.pending.length === 1);
    runs.resolvePermission(denied.id, runs.get(denied.id)!.pending[0]!, false);
    await until(() => runs.get(denied.id)!.status !== 'running');
    expect(runs.get(denied.id)!.events.some((e) => e.type === 'tool' && e.status === 'error')).toBe(true);
    expect(runs.get(denied.id)!.status).toBe('done');
    const slow = scripted([{ text: 'working' }, { result: 'success' }]);
    const cancelled = runs.start({ ...base, repoId: 'r2', queryFn: (params, local) => { const stream = slow(params, local); return { ...stream, [Symbol.asyncIterator]: async function* () { yield* stream; await new Promise(() => undefined); } }; } });
    if ('error' in cancelled) throw new Error(cancelled.error);
    await until(() => runs.get(cancelled.id)!.events.some((e) => e.type === 'text'));
    expect(runs.cancel(cancelled.id)).toBe(true);
    await until(() => runs.get(cancelled.id)!.status !== 'running');
    expect(runs.get(cancelled.id)!.status).toBe('cancelled');
    expect(runs.cancel(cancelled.id)).toBe(false);
    expect(runs.cancel('zzz')).toBe(false);
  });
});
