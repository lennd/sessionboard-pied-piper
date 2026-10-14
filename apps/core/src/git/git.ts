import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TouchedFile } from '../observer/parse';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export type GitInfo = { head: string | null; branch: string | null };

const gitRaw = async (cwd: string, args: string[]): Promise<string | null> => {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch {
    return null;
  }
};
const git = async (cwd: string, args: string[]): Promise<string | null> => (await gitRaw(cwd, args))?.trim() ?? null;

export const gitInfo = async (cwd: string): Promise<GitInfo> => ({
  head: await git(cwd, ['rev-parse', 'HEAD']),
  branch: await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
});

export const gitRoot = (cwd: string): Promise<string | null> => git(cwd, ['rev-parse', '--show-toplevel']);
export const gitRemoteUrl = (cwd: string): Promise<string | null> => git(cwd, ['remote', 'get-url', 'origin']);

const DEFAULT_BRANCH_CANDIDATES = ['main', 'master', 'develop'];

/** The branch this repository merges into: origin/HEAD when known, else the first of main/master/develop that exists. */
export const gitBaseBranch = async (cwd: string): Promise<string | null> => {
  const head = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head) return head.replace(/^origin\//, '');
  for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
    if ((await git(cwd, ['rev-parse', '--verify', '--quiet', candidate])) !== null) return candidate;
  }
  return null;
};

export type BranchCompare = { branch: string; base: string; ahead: number; touched: TouchedFile[] };

const STATUS_LETTER: Record<string, TouchedFile['change']> = { A: 'added', D: 'removed', M: 'modified', R: 'added', C: 'added', T: 'modified' };

/** What the current branch changes against its base (merge-base three-dot diff); null when there is no base or nothing ahead. */
export const gitBranchCompare = async (cwd: string): Promise<BranchCompare | null> => {
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const base = await gitBaseBranch(cwd);
  if (!branch || !base || branch === base) return null;
  const ahead = Number((await git(cwd, ['rev-list', '--count', `${base}..HEAD`])) ?? '0');
  if (!ahead) return null;
  const status = (await gitRaw(cwd, ['diff', '--name-status', '-z', `${base}...HEAD`])) ?? '';
  const parts = status.split('\0').filter(Boolean);
  const touched: TouchedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]![0] ?? 'M';
    if (code === 'R' || code === 'C') {
      const from = parts[++i];
      const to = parts[++i];
      if (code === 'R' && from) touched.push({ path: from, change: 'removed' });
      if (to) touched.push({ path: to, change: 'added' });
      continue;
    }
    const path = parts[++i];
    if (path) touched.push({ path, change: STATUS_LETTER[code] ?? 'modified' });
  }
  return { branch, base, ahead, touched };
};

export const gitBranchDiff = async (cwd: string, base: string, maxBytes = MAX_DIFF_BYTES): Promise<string> => clipDiff((await git(cwd, ['diff', '--no-color', `${base}...HEAD`])) ?? '', maxBytes);

export const clipDiff = (text: string, maxBytes: number): string =>
  Buffer.byteLength(text) <= maxBytes ? text : `${Buffer.from(text).subarray(0, maxBytes).toString('utf8')}\n… (diff truncated)`;

const STATUS_ADDED = new Set(['A', '?']);
const STATUS_REMOVED = new Set(['D']);
export const MAX_DIFF_BYTES = 48 * 1024;

const changeOf = (xy: string): TouchedFile['change'] => {
  const codes = [xy[0] ?? ' ', xy[1] ?? ' '];
  if (codes.some((c) => STATUS_REMOVED.has(c))) return 'removed';
  if (codes.some((c) => STATUS_ADDED.has(c))) return 'added';
  return 'modified';
};

/** Working-tree changes versus HEAD (tracked and untracked), as repository-relative paths. */
export const gitChanges = async (cwd: string): Promise<TouchedFile[]> => {
  const out = await gitRaw(cwd, ['status', '--porcelain', '--untracked-files=all', '-z']);
  if (out === null) return [];
  const entries = out.split('\0').filter(Boolean);
  const touched: TouchedFile[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') {
      const previous = entries[++i];
      if (xy[0] === 'R' && previous) touched.push({ path: previous, change: 'removed' });
      touched.push({ path, change: 'added' });
      continue;
    }
    touched.push({ path, change: changeOf(xy) });
  }
  return touched;
};

/** Unified diff of the working tree against HEAD, clipped to `maxBytes`; untracked files are listed by name. */
export const gitDiff = async (cwd: string, maxBytes = MAX_DIFF_BYTES): Promise<string> => {
  const diff = (await git(cwd, ['diff', 'HEAD', '--no-color', '--stat=0', '--patch'])) ?? '';
  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard'])) ?? '';
  return clipDiff([diff, untracked ? `\nUntracked files:\n${untracked}` : ''].join(''), maxBytes);
};
