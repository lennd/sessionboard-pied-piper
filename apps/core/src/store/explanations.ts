import { join } from 'node:path';
import { readJson, withLock, writeJson } from './json';

/** The last explanation Claude gave for a scope: a pull request (`pr-<n>`), the branch, a session id or the working tree. */
export type ExplanationEntry = { sceneId: string; text: string; at: string };
export type ExplanationsFile = Record<string, ExplanationEntry>;

const FILE = 'explanations.json';
const file = (dir: string) => join(dir, FILE);

export const readExplanations = (dir: string): Promise<ExplanationsFile> => readJson<ExplanationsFile>(file(dir), {});

export const readExplanation = async (dir: string, scope: string): Promise<ExplanationEntry | null> => (await readExplanations(dir))[scope] ?? null;

export const setExplanation = (dir: string, scope: string, entry: ExplanationEntry): Promise<void> =>
  withLock(file(dir), async () => {
    const current = await readExplanations(dir);
    await writeJson(file(dir), { ...current, [scope]: entry });
  });
