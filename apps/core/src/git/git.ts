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
  const text = [diff, untracked ? `\nUntracked files:\n${untracked}` : ''].join('');
  return Buffer.byteLength(text) <= maxBytes ? text : `${Buffer.from(text).subarray(0, maxBytes).toString('utf8')}\n… (diff truncated)`;
};
