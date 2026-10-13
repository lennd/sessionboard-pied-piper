import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export type GitInfo = { head: string | null; branch: string | null };

const git = async (cwd: string, args: string[]): Promise<string | null> => {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout.trim();
  } catch {
    return null;
  }
};

export const gitInfo = async (cwd: string): Promise<GitInfo> => ({
  head: await git(cwd, ['rev-parse', 'HEAD']),
  branch: await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
});

export const gitRoot = (cwd: string): Promise<string | null> => git(cwd, ['rev-parse', '--show-toplevel']);
