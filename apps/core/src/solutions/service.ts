import { validateSolutionDraft, type SolutionDraft, type SolutionStatus, type TaskStatus } from '@rdi/scene';
import type { EventEmitter } from 'node:events';
import { addVersion, createSolution, findSolution, latestVersion, listSolutions, progressOf, updateSolutionFile, type Author, type SolutionFile } from '../store/solutions';

export const SOLUTION_EVENT = 'solution';
export type SolutionEvent = { solutionId: string } & ({ type: 'version'; n: number; author: Author } | { type: 'task'; taskId: string; status: TaskStatus } | { type: 'meta' });
export type SolutionDetail = {
  id: string; title: string; status: string; conversationId: string | null;
  versions: { n: number; author: Author; summary: string; createdAt: string }[];
  version: { n: number; author: Author; createdAt: string; draft: SolutionDraft };
  tasks: Record<string, { status: TaskStatus; note: string | null; updatedAt: string }>;
};
export type SolutionSummary = { id: string; title: string; status: SolutionStatus; latestVersion: number; progress: { done: number; total: number }; updatedAt: string };
type Deps = { dir: string; events: EventEmitter; now: Date };

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

const publish = (deps: Deps, event: SolutionEvent) => deps.events.emit(SOLUTION_EVENT, event);

/** Derives the solution status from the latest plan and task statuses; archived solutions are left alone. */
const withDerivedStatus = (s: SolutionFile): SolutionFile => {
  if (s.status === 'archived') return s;
  const current = latestVersion(s).draft.plan.map((t) => s.tasks[t.id]?.status ?? 'todo');
  const next: SolutionStatus = current.length > 0 && current.every((st) => st === 'done') ? 'done' : current.some((st) => st !== 'todo') || s.status === 'done' ? 'in_progress' : s.status;
  return next === s.status ? s : { ...s, status: next };
};

export const createFromDraft = async (deps: Deps, input: { title: string; conversationId: string | null; author: Author; input: unknown }): Promise<{ id: string; n: number }> => {
  const solution = await createSolution(deps.dir, deps.now, { title: input.title, conversationId: input.conversationId, draft: validDraft(input.input), author: input.author });
  return { id: solution.id, n: 1 };
};

export const proposeVersion = async (
  deps: Deps,
  input: { solutionId: string; author: Author; input: Record<string, unknown>; merge?: boolean; baseVersion?: number },
): Promise<{ n: number }> => {
  const version = await addVersion(deps.dir, input.solutionId, deps.now, input.author, (latest) => {
    if (input.baseVersion !== undefined && latest.n !== input.baseVersion) {
      throw new SolutionError('stale_version', [`The solution changed since version ${input.baseVersion} (latest is ${latest.n}). Call get_solution again and retry.`]);
    }
    const changes = Object.fromEntries(Object.entries(input.input).filter(([, v]) => v !== undefined));
    return validDraft(input.merge ? { ...latest.draft, ...changes } : input.input);
  });
  if (!version) throw new SolutionError('not_found');
  await updateSolutionFile(deps.dir, input.solutionId, deps.now, withDerivedStatus);
  publish(deps, { solutionId: input.solutionId, type: 'version', n: version.n, author: input.author });
  return { n: version.n };
};

export const reportTask = async (deps: Deps, input: { solutionId: string; taskId: string; status: TaskStatus; note: string | null }): Promise<void> => {
  const solution = await findSolution(deps.dir, input.solutionId);
  if (!solution) throw new SolutionError('not_found');
  if (!latestVersion(solution).draft.plan.some((t) => t.id === input.taskId)) throw new SolutionError('unknown_task');
  await updateSolutionFile(deps.dir, solution.id, deps.now, (s) =>
    withDerivedStatus({ ...s, tasks: { ...s.tasks, [input.taskId]: { status: input.status, note: input.note, updatedAt: deps.now.toISOString() } } }));
  publish(deps, { solutionId: solution.id, type: 'task', taskId: input.taskId, status: input.status });
};

export const updateMeta = async (deps: Deps, id: string, patch: { title?: string; status?: SolutionStatus }): Promise<boolean> => {
  const updated = await updateSolutionFile(deps.dir, id, deps.now, (s) => ({ ...s, title: patch.title ?? s.title, status: patch.status ?? s.status }));
  if (updated) publish(deps, { solutionId: id, type: 'meta' });
  return updated !== null;
};

export const listSummaries = async (dir: string): Promise<SolutionSummary[]> =>
  (await listSolutions(dir)).map((s) => ({ id: s.id, title: s.title, status: s.status, latestVersion: latestVersion(s).n, progress: progressOf(s), updatedAt: s.updatedAt }));

export const solutionDetail = async (dir: string, id: string, n?: number): Promise<SolutionDetail | null> => {
  const solution = await findSolution(dir, id);
  if (!solution) return null;
  const version = n === undefined ? latestVersion(solution) : solution.versions.find((v) => v.n === n);
  if (!version) return null;
  return {
    id: solution.id, title: solution.title, status: solution.status, conversationId: solution.conversationId,
    versions: solution.versions.map((v) => ({ n: v.n, author: v.author, summary: v.draft.summary, createdAt: v.createdAt })),
    version: { n: version.n, author: version.author, createdAt: version.createdAt, draft: version.draft },
    tasks: solution.tasks,
  };
};
