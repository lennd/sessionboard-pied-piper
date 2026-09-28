import { execFile } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

export type CloneSource = { kind: 'git'; url: string; branch: string } | { kind: 'local'; path: string };

const run = promisify(execFile);
const CLONE_TIMEOUT_MS = 120_000;

export const materialize = async (source: CloneSource, dest: string): Promise<void> => {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  if (source.kind === 'local') {
    await cp(source.path, dest, { recursive: true, filter: (path) => !path.includes('/node_modules/') });
    return;
  }
  try {
    await run('git', ['clone', '--quiet', '--depth', '1', '--single-branch', '--branch', source.branch, source.url, dest], {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    await rm(dest, { recursive: true, force: true });
    throw new Error('git clone failed');
  }
};
