import { join } from 'node:path';
import { readJson, withLock, writeJson } from './json';

export type Prefs = { uiLanguage: string | null; explanationLanguage: string | null; theme: string | null; initialLevel: string | null };

const PREFS_FILE = 'prefs.json';
export const DEFAULT_PREFS: Prefs = { uiLanguage: null, explanationLanguage: null, theme: null, initialLevel: null };
const file = (home: string) => join(home, PREFS_FILE);

export const readPrefs = async (home: string): Promise<Prefs> => ({ ...DEFAULT_PREFS, ...(await readJson<Partial<Prefs>>(file(home), {})) });

export const updatePrefs = (home: string, patch: Partial<Prefs>): Promise<Prefs> =>
  withLock(file(home), async () => {
    const next = { ...(await readPrefs(home)), ...patch };
    await writeJson(file(home), next);
    return next;
  });
