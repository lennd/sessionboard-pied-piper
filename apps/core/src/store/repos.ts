import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { readJson, withLock, writeJson } from './json';

export type RepoEntry = { id: string; path: string; name: string; addedAt: string };
export type RepoIndex = { repos: RepoEntry[] };

const INDEX_FILE = 'repos.json';
const ID_LENGTH = 12;
const RDI_DIR = '.rdi';
const EMPTY: RepoIndex = { repos: [] };
const SELF_IGNORE = '*\n';

export class RepoError extends Error {
  constructor(public readonly code: 'not_a_directory' | 'already_added') {
    super(code);
  }
}

export const repoIdFor = (path: string): string => createHash('sha1').update(resolve(path)).digest('hex').slice(0, ID_LENGTH);
export const repoDir = (repo: RepoEntry): string => join(repo.path, RDI_DIR);

/** Creates `<repo>/.rdi` with a .gitignore that ignores itself, so the host repository never sees our files. */
const ensureRepoDir = async (path: string): Promise<void> => {
  const dir = join(path, RDI_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.gitignore'), SELF_IGNORE, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
};
const indexFile = (home: string) => join(home, INDEX_FILE);

export const listRepos = async (home: string): Promise<RepoEntry[]> => (await readJson<RepoIndex>(indexFile(home), EMPTY)).repos;

export const findRepo = async (home: string, id: string): Promise<RepoEntry | null> => (await listRepos(home)).find((r) => r.id === id) ?? null;

export const addRepo = (home: string, path: string, now: Date): Promise<RepoEntry> =>
  withLock(indexFile(home), async () => {
    const absolute = resolve(path);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isDirectory()) throw new RepoError('not_a_directory');
    const index = await readJson<RepoIndex>(indexFile(home), EMPTY);
    const id = repoIdFor(absolute);
    const existing = index.repos.find((r) => r.id === id);
    if (existing) return existing;
    const entry: RepoEntry = { id, path: absolute, name: basename(absolute), addedAt: now.toISOString() };
    await ensureRepoDir(absolute);
    await writeJson(indexFile(home), { repos: [...index.repos, entry] });
    return entry;
  });

export const removeRepo = (home: string, id: string): Promise<boolean> =>
  withLock(indexFile(home), async () => {
    const index = await readJson<RepoIndex>(indexFile(home), EMPTY);
    const repos = index.repos.filter((r) => r.id !== id);
    if (repos.length === index.repos.length) return false;
    await writeJson(indexFile(home), { repos });
    return true;
  });
