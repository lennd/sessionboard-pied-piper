import { validateSolutionDraft, type SolutionDraft, type SolutionStatus, type TaskStatus } from '@rdi/scene';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { addVersion, createSolution, findSolution, getVersion, listTaskStatuses, listVersions, setTaskStatus, updateSolution, type Author } from '../db/queries/solutions';
import { publishSolutionEvent } from './events';

type Deps = { pool: pg.Pool; redis: Redis };
export type SolutionDetail = {
  id: string; title: string; status: string; conversationId: string | null;
  versions: { n: number; author: Author; summary: string; createdAt: string }[];
  version: { n: number; author: Author; createdAt: string; draft: SolutionDraft };
  tasks: Record<string, { status: TaskStatus; note: string | null; updatedAt: string }>;
};

export class SolutionError extends Error {
  constructor(public readonly code: 'not_found' | 'invalid_draft' | 'unknown_task' | 'stale_version', public readonly errors: string[] = []) {
    super(code);
  }
}

const validDraft = (input: unknown): SolutionDraft => {
  const result = validateSolutionDraft(input);
  if (!result.ok) throw new SolutionError('invalid_draft', result.errors);
  return result.draft;
};

export const createFromDraft = async (
  deps: Deps,
  input: { orgId: string; userId: string | null; title: string; conversationId: string | null; author: Author; input: unknown },
): Promise<{ id: string; n: number }> => {
  const { solution, version } = await createSolution(deps.pool, { orgId: input.orgId, userId: input.userId, title: input.title, conversationId: input.conversationId, draft: validDraft(input.input), author: input.author });
  return { id: solution.id, n: version.n };
};

export const proposeVersion = async (
  deps: Deps,
  input: { orgId: string; solutionId: string; author: Author; input: Record<string, unknown>; merge?: boolean; baseVersion?: number },
): Promise<{ n: number }> => {
  if (!(await findSolution(deps.pool, input.orgId, input.solutionId))) throw new SolutionError('not_found');
  const version = await addVersion(deps.pool, input.solutionId, input.author, (latest) => {
    if (input.baseVersion !== undefined && latest && latest.n !== input.baseVersion) {
      throw new SolutionError('stale_version', [`The solution changed since version ${input.baseVersion} (latest is ${latest.n}). Call get_solution again and retry.`]);
    }
    const changes = Object.fromEntries(Object.entries(input.input).filter(([, v]) => v !== undefined));
    return validDraft(input.merge && latest ? { ...latest.draft, ...changes } : input.input);
  });
  await recomputeStatus(deps, input.solutionId);
  await publishSolutionEvent(deps.redis, input.solutionId, { type: 'version', n: version.n, author: input.author });
  return { n: version.n };
};

/** Derives the solution status from the latest plan and task statuses; archived solutions are left alone. */
const recomputeStatus = async (deps: Deps, solutionId: string): Promise<void> => {
  const solution = (await deps.pool.query<{ status: string }>('select status from solutions where id = $1', [solutionId])).rows[0];
  if (!solution || solution.status === 'archived') return;
  const plan = (await getVersion(deps.pool, solutionId))?.draft.plan ?? [];
  const statuses = new Map((await listTaskStatuses(deps.pool, solutionId)).map((t) => [t.task_id, t.status]));
  const current = plan.map((t) => statuses.get(t.id) ?? 'todo');
  const next = current.length > 0 && current.every((s) => s === 'done') ? 'done' : current.some((s) => s !== 'todo') || solution.status === 'done' ? 'in_progress' : solution.status;
  if (next !== solution.status) await updateSolution(deps.pool, solutionId, { status: next as SolutionStatus });
};

export const reportTask = async (
  deps: Deps,
  input: { orgId: string; solutionId: string; taskId: string; status: TaskStatus; note: string | null },
): Promise<void> => {
  const solution = await findSolution(deps.pool, input.orgId, input.solutionId);
  if (!solution) throw new SolutionError('not_found');
  const latest = await getVersion(deps.pool, solution.id);
  const plan = latest?.draft.plan ?? [];
  if (!plan.some((t) => t.id === input.taskId)) throw new SolutionError('unknown_task');
  await setTaskStatus(deps.pool, solution.id, input.taskId, input.status, input.note);
  await recomputeStatus(deps, solution.id);
  await publishSolutionEvent(deps.redis, solution.id, { type: 'task', taskId: input.taskId, status: input.status });
};

export const solutionDetail = async (deps: Deps, orgId: string, id: string, n?: number): Promise<SolutionDetail | null> => {
  const solution = await findSolution(deps.pool, orgId, id);
  if (!solution) return null;
  const version = await getVersion(deps.pool, id, n);
  if (!version) return null;
  return {
    id: solution.id, title: solution.title, status: solution.status, conversationId: solution.conversation_id,
    versions: (await listVersions(deps.pool, id)).map((v) => ({ n: v.n, author: v.author, summary: v.summary, createdAt: v.created_at.toISOString() })),
    version: { n: version.n, author: version.author, createdAt: version.created_at.toISOString(), draft: version.draft },
    tasks: Object.fromEntries((await listTaskStatuses(deps.pool, id)).map((t) => [t.task_id, { status: t.status, note: t.note, updatedAt: t.updated_at.toISOString() }])),
  };
};
