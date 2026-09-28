import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkRepository } from '../src/index';
import { fixture } from './fixtures';

describe('walkRepository', () => {
  it('lists source files deterministically with language, loc and package name', async () => {
    const result = await walkRepository(fixture('shop-api'));
    expect(result.files.map((f) => f.path)).toEqual(['src/db.ts', 'src/orders.ts', 'src/server.ts']);
    expect(result.files[0]).toMatchObject({ language: 'typescript', loc: 2 });
    expect(result.packageName).toBe('shop-api');
    expect(result.languages).toEqual(['TypeScript']);
    expect(result.truncated).toBe(false);
  });

  it('reads the python project name and tsx files', async () => {
    expect((await walkRepository(fixture('shop-worker'))).packageName).toBe('shop-worker');
    const web = await walkRepository(fixture('shop-web'));
    expect(web.files.map((f) => [f.path, f.language])).toEqual([['src/Checkout.tsx', 'tsx'], ['src/api.ts', 'typescript']]);
  });

  it('skips ignored directories, unknown extensions and huge files, and truncates by LOC', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rdi-walk-'));
    await mkdir(join(root, 'node_modules/x'), { recursive: true });
    await writeFile(join(root, 'node_modules/x/index.js'), 'export const a = 1;\n');
    await writeFile(join(root, 'notes.md'), '# hi\n');
    await writeFile(join(root, 'a.py'), 'a = 1\nb = 2\n');
    await writeFile(join(root, 'b.js'), 'const x = 1;\n'.repeat(10));
    await writeFile(join(root, 'big.js'), 'x'.repeat(600_000));
    const all = await walkRepository(root);
    expect(all.files.map((f) => f.path)).toEqual(['a.py', 'b.js']);
    const limited = await walkRepository(root, { maxLoc: 5, maxFileBytes: 512_000 });
    expect(limited.files.map((f) => f.path)).toEqual(['a.py']);
    expect(limited.truncated).toBe(true);
  });
});
