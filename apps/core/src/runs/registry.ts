import { randomUUID } from 'node:crypto';
import { runSolutionPrompt } from '../agent/prompt';
import { runAgent, type AgentEvent, type QueryFn, type RunUsage } from '../agent/sdkRunner';
import type { Config } from '../config';

export type RunStatus = 'running' | 'done' | 'error' | 'cancelled';
export type RunEvent =
  | AgentEvent
  | { type: 'permission'; id: string; tool: string; input: Record<string, unknown>; description: string | null }
  | { type: 'permission_resolved'; id: string; allow: boolean }
  | { type: 'status'; status: RunStatus; message?: string };
export type Run = { id: string; repoId: string; solutionId: string; status: RunStatus; startedAt: string; endedAt: string | null; sdkSessionId: string | null; usage: RunUsage; events: RunEvent[]; pending: string[] };
export type StartInput = { repoId: string; repoPath: string; solutionId: string; queryFn: QueryFn; agent: Config['agent']; mcpHttpUrl: string; now: () => Date };

const DENIED_MESSAGE = 'The user denied this action in Repository Designer.';
const CANCELLED_MESSAGE = 'The run was stopped by the user.';
const MAX_RUNS_PER_REPO = 20;

type Live = { run: Run; controller: AbortController; resolvers: Map<string, (allow: boolean) => void>; listeners: Set<(event: RunEvent) => void> };

export type RunRegistry = ReturnType<typeof createRunRegistry>;

/** In-memory registry of Solution runs started from the app; one run per repository at a time. */
export const createRunRegistry = () => {
  const live = new Map<string, Live>();

  const publicRun = ({ run }: Live): Omit<Run, 'events'> => {
    const { events: _events, ...rest } = run;
    return rest;
  };
  const emit = (entry: Live, event: RunEvent) => {
    entry.run.events.push(event);
    for (const listener of entry.listeners) listener(event);
  };
  const finish = (entry: Live, status: RunStatus, now: () => Date, message?: string) => {
    entry.run.status = status;
    entry.run.endedAt = now().toISOString();
    for (const resolve of entry.resolvers.values()) resolve(false);
    entry.resolvers.clear();
    entry.run.pending = [];
    emit(entry, { type: 'status', status, ...(message ? { message } : {}) });
  };
  const prune = (repoId: string) => {
    const finished = [...live.values()].filter((e) => e.run.repoId === repoId && e.run.status !== 'running').sort((a, b) => a.run.startedAt.localeCompare(b.run.startedAt));
    for (const entry of finished.slice(0, Math.max(0, finished.length - MAX_RUNS_PER_REPO))) live.delete(entry.run.id);
  };

  const start = (input: StartInput): Omit<Run, 'events'> | { error: 'already_running' } => {
    if ([...live.values()].some((e) => e.run.repoId === input.repoId && e.run.status === 'running')) return { error: 'already_running' };
    prune(input.repoId);
    const controller = new AbortController();
    const run: Run = { id: randomUUID(), repoId: input.repoId, solutionId: input.solutionId, status: 'running', startedAt: input.now().toISOString(), endedAt: null, sdkSessionId: null, usage: { input: 0, output: 0, costUsd: 0 }, events: [], pending: [] };
    const entry: Live = { run, controller, resolvers: new Map(), listeners: new Set() };
    live.set(run.id, entry);
    emit(entry, { type: 'status', status: 'running' });
    const canUseTool = (tool: string, toolInput: Record<string, unknown>, options: { signal: AbortSignal; description?: string }) =>
      new Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string }>((resolve) => {
        if (controller.signal.aborted || options.signal.aborted) {
          resolve({ behavior: 'deny', message: CANCELLED_MESSAGE });
          return;
        }
        const id = randomUUID();
        const settle = (allow: boolean) => {
          entry.resolvers.delete(id);
          run.pending = run.pending.filter((p) => p !== id);
          emit(entry, { type: 'permission_resolved', id, allow });
          resolve(allow ? { behavior: 'allow' } : { behavior: 'deny', message: DENIED_MESSAGE });
        };
        entry.resolvers.set(id, settle);
        run.pending.push(id);
        options.signal.addEventListener('abort', () => entry.resolvers.get(id)?.(false), { once: true });
        emit(entry, { type: 'permission', id, tool, input: toolInput, description: options.description ?? null });
      });
    void runAgent(input.queryFn, {
      cwd: input.repoPath, prompt: runSolutionPrompt(input.solutionId), mode: 'run', signal: controller.signal, agent: input.agent, mcpHttpUrl: input.mcpHttpUrl, canUseTool,
      ctx: { upsertSolution: async () => { throw new Error('not available while running'); } },
      emit: (event) => emit(entry, event),
    })
      .then((result) => {
        run.sdkSessionId = result.sessionId;
        run.usage = result.usage;
        if (controller.signal.aborted) finish(entry, 'cancelled', input.now, CANCELLED_MESSAGE);
        else finish(entry, result.stop === 'end_turn' ? 'done' : 'error', input.now, result.stop === 'end_turn' ? undefined : result.errorCode);
      })
      .catch((error: unknown) => finish(entry, 'error', input.now, error instanceof Error ? error.message : String(error)));
    return publicRun(entry);
  };

  return {
    start,
    get: (id: string): Run | null => live.get(id)?.run ?? null,
    list: (repoId: string): Omit<Run, 'events'>[] => [...live.values()].filter((e) => e.run.repoId === repoId).map(publicRun).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    subscribe: (id: string, listener: (event: RunEvent) => void): (() => void) | null => {
      const entry = live.get(id);
      if (!entry) return null;
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    resolvePermission: (id: string, permissionId: string, allow: boolean): boolean => {
      const settle = live.get(id)?.resolvers.get(permissionId);
      if (!settle) return false;
      settle(allow);
      return true;
    },
    cancel: (id: string): boolean => {
      const entry = live.get(id);
      if (!entry || entry.run.status !== 'running') return false;
      entry.controller.abort();
      return true;
    },
  };
};
