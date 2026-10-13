import { randomUUID } from 'node:crypto';
import type { SolutionDraft, SolutionStatus, TaskStatus } from '@rdi/scene';
import { join } from 'node:path';
import { listJson, readJson, withLock, writeJson } from './json';

export type Author = 'web' | 'claude-code';
export type VersionEntry = { n: number; author: Author; draft: SolutionDraft; createdAt: string };
export type TaskEntry = { status: TaskStatus; note: string | null; updatedAt: string };
export type SolutionFile = { id: string; title: string; status: SolutionStatus; conversationId: string | null; createdAt: string; updatedAt: string; versions: VersionEntry[]; tasks: Record<string, TaskEntry> };

const DIR = 'solutions';
const file = (dir: string, id: string) => join(dir, DIR, `${id}.json`);

export const latestVersion = (s: SolutionFile): VersionEntry => s.versions[s.versions.length - 1]!;

export const createSolution = async (
  dir: string,
  now: Date,
  input: { title: string; conversationId: string | null; draft: SolutionDraft; author: Author },
): Promise<SolutionFile> => {
  const stamp = now.toISOString();
  const solution: SolutionFile = {
    id: randomUUID(), title: input.title, status: 'draft', conversationId: input.conversationId, createdAt: stamp, updatedAt: stamp,
    versions: [{ n: 1, author: input.author, draft: input.draft, createdAt: stamp }], tasks: {},
  };
  await writeJson(file(dir, solution.id), solution);
  return solution;
};

export const listSolutions = async (dir: string): Promise<SolutionFile[]> =>
  (await listJson<SolutionFile>(join(dir, DIR))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const findSolution = (dir: string, id: string): Promise<SolutionFile | null> => readJson<SolutionFile | null>(file(dir, id), null);

/** Applies a change under the per-file lock; the callback sees the latest stored state. */
export const updateSolutionFile = (dir: string, id: string, now: Date, change: (s: SolutionFile) => SolutionFile): Promise<SolutionFile | null> =>
  withLock(file(dir, id), async () => {
    const current = await findSolution(dir, id);
    if (!current) return null;
    const next = { ...change(current), updatedAt: now.toISOString() };
    await writeJson(file(dir, id), next);
    return next;
  });

export const addVersion = (dir: string, id: string, now: Date, author: Author, draftOf: (latest: VersionEntry) => SolutionDraft): Promise<VersionEntry | null> =>
  updateSolutionFile(dir, id, now, (s) => {
    const latest = latestVersion(s);
    const version: VersionEntry = { n: latest.n + 1, author, draft: draftOf(latest), createdAt: now.toISOString() };
    return { ...s, versions: [...s.versions, version] };
  }).then((s) => (s ? latestVersion(s) : null));

export const progressOf = (s: SolutionFile): { done: number; total: number } => {
  const plan = latestVersion(s).draft.plan;
  return { done: plan.filter((t) => s.tasks[t.id]?.status === 'done').length, total: plan.length };
};
