import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, withLock, writeJson } from './json';

/** One repository of a review and what to look at there: a pull request number, or the current branch against its base. */
export type ReviewSelection = { repoId: string; pull: number | 'branch' };
export type ReviewFile = { id: string; title: string; selections: ReviewSelection[]; createdAt: string; updatedAt: string };

const DIR = 'reviews';
const FILE = 'review.json';

export const reviewDir = (home: string, id: string): string => join(home, DIR, id);
const file = (home: string, id: string) => join(reviewDir(home, id), FILE);

export const createReview = async (home: string, now: Date, input: { title: string; selections: ReviewSelection[] }): Promise<ReviewFile> => {
  const stamp = now.toISOString();
  const review: ReviewFile = { id: randomUUID(), title: input.title, selections: input.selections, createdAt: stamp, updatedAt: stamp };
  await writeJson(file(home, review.id), review);
  return review;
};

export const listReviews = async (home: string): Promise<ReviewFile[]> => {
  let ids: string[] = [];
  try {
    ids = (await readdir(join(home, DIR), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const reviews = await Promise.all(ids.map((id) => readJson<ReviewFile | null>(file(home, id), null)));
  return reviews.filter((r): r is ReviewFile => r !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const findReview = (home: string, id: string): Promise<ReviewFile | null> => readJson<ReviewFile | null>(file(home, id), null);

export const updateReview = (home: string, id: string, now: Date, patch: Partial<Pick<ReviewFile, 'title' | 'selections'>>): Promise<ReviewFile | null> =>
  withLock(file(home, id), async () => {
    const current = await findReview(home, id);
    if (!current) return null;
    const next: ReviewFile = { ...current, ...patch, updatedAt: now.toISOString() };
    await writeJson(file(home, id), next);
    return next;
  });

export const removeReview = async (home: string, id: string): Promise<boolean> => {
  if (!(await findReview(home, id))) return false;
  await rm(reviewDir(home, id), { recursive: true, force: true });
  return true;
};
