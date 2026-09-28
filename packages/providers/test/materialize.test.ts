import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { materialize } from '../src/index';

describe('materialize', () => {
  it('copies a local directory, replacing previous content', async () => {
    const src = await mkdtemp(join(tmpdir(), 'rdi-src-'));
    await writeFile(join(src, 'a.ts'), 'export const a = 1;\n');
    const dest = join(await mkdtemp(join(tmpdir(), 'rdi-dest-')), 'repo');
    await materialize({ kind: 'local', path: src }, dest);
    await writeFile(join(dest, 'stale.txt'), 'x');
    await materialize({ kind: 'local', path: src }, dest);
    expect(await readFile(join(dest, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(existsSync(join(dest, 'stale.txt'))).toBe(false);
  });

  it('shallow-clones a git repository branch', async () => {
    const origin = await mkdtemp(join(tmpdir(), 'rdi-origin-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: origin, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    await writeFile(join(origin, 'x.py'), 'x = 1\n');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
    const dest = join(await mkdtemp(join(tmpdir(), 'rdi-clone-')), 'repo');
    await materialize({ kind: 'git', url: `file://${origin}`, branch: 'main' }, dest);
    expect(await readFile(join(dest, 'x.py'), 'utf8')).toBe('x = 1\n');
  });

  it('fails with a message that hides credentials', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'rdi-bad-')), 'repo');
    await expect(materialize({ kind: 'git', url: 'https://x-access-token:SECRET@127.0.0.1:1/none.git', branch: 'main' }, dest)).rejects.toThrow(/^git clone failed/);
    await expect(materialize({ kind: 'git', url: 'https://x-access-token:SECRET@127.0.0.1:1/none.git', branch: 'main' }, dest)).rejects.not.toThrow(/SECRET/);
  });
});
