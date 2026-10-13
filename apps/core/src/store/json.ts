import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const JSON_EXT = '.json';
const INDENT = 2;

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if (isMissing(error)) return fallback;
    throw error;
  }
};

/** Writes through a temp file and renames it, so readers never see a partial file. */
export const writeJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, INDENT));
  await rename(tmp, file);
};

export const removeJson = async (file: string): Promise<void> => {
  await rm(file, { force: true });
};

export const listJson = async <T>(dir: string): Promise<T[]> => {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const files = names.filter((n) => n.endsWith(JSON_EXT)).sort();
  return Promise.all(files.map((n) => readJson<T>(join(dir, n), undefined as T))).then((items) => items.filter((i) => i !== undefined));
};

const locks = new Map<string, Promise<unknown>>();

/** Serialises read-modify-write cycles on one key (a file path) inside this process. */
export const withLock = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.then(() => undefined, () => undefined);
  locks.set(key, settled);
  try {
    return await next;
  } finally {
    if (locks.get(key) === settled) locks.delete(key);
  }
};
