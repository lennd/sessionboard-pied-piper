import { join } from 'node:path';
import { readJson, withLock, writeJson } from './json';

export type TriageState = 'reviewed' | 'dismissed';
export type TriageEntry = { state: TriageState; at: string; note: string | null };
export type TriageFile = Record<string, TriageEntry>;

const FILE = 'pulls.json';
const file = (dir: string) => join(dir, FILE);

/** Local review bookkeeping per pull request number: what was looked at and what was set aside, kept next to the scenes. */
export const readTriage = (dir: string): Promise<TriageFile> => readJson<TriageFile>(file(dir), {});

export const setTriage = (dir: string, number: number, entry: TriageEntry | null): Promise<TriageFile> =>
  withLock(file(dir), async () => {
    const current = await readTriage(dir);
    const next = { ...current };
    if (entry) next[String(number)] = entry;
    else delete next[String(number)];
    await writeJson(file(dir), next);
    return next;
  });
