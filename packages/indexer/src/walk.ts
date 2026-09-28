import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

export type SourceLanguage = 'typescript' | 'tsx' | 'javascript' | 'python';
export type SourceFile = { path: string; language: SourceLanguage; loc: number; content: string };
export type WalkResult = { files: SourceFile[]; totalLoc: number; truncated: boolean; languages: string[]; packageName: string | null };

export const LANGUAGE_BY_EXTENSION: Record<string, SourceLanguage> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.py': 'python',
};
export const MAX_FILE_BYTES = 512_000;
export const MAX_TOTAL_LOC = 500_000;

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', 'vendor', '__pycache__', '.venv', 'venv']);
const DISPLAY: Record<SourceLanguage, string> = { typescript: 'TypeScript', tsx: 'TypeScript', javascript: 'JavaScript', python: 'Python' };
const PYPROJECT_NAME = /^\s*name\s*=\s*["']([^"']+)["']/m;

const listFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return IGNORED_DIRS.has(entry.name) ? [] : listFiles(full);
      return entry.isFile() ? [full] : [];
    }),
  );
  return nested.flat();
};

const readPackageName = async (root: string): Promise<string | null> => {
  const json = await readFile(join(root, 'package.json'), 'utf8').catch(() => null);
  if (json) {
    try {
      const name = (JSON.parse(json) as { name?: unknown }).name;
      if (typeof name === 'string' && name) return name;
    } catch {
      // fall through to pyproject
    }
  }
  const toml = await readFile(join(root, 'pyproject.toml'), 'utf8').catch(() => null);
  return toml ? PYPROJECT_NAME.exec(toml)?.[1] ?? null : null;
};

const countLoc = (content: string) => content.split('\n').filter((line) => line.trim() !== '').length;

export const walkRepository = async (root: string, limits = { maxLoc: MAX_TOTAL_LOC, maxFileBytes: MAX_FILE_BYTES }): Promise<WalkResult> => {
  const paths = (await listFiles(root)).map((full) => relative(root, full).split(sep).join('/')).sort();
  const files: SourceFile[] = [];
  const locByLanguage = new Map<string, number>();
  let totalLoc = 0;
  let truncated = false;
  for (const path of paths) {
    const language = LANGUAGE_BY_EXTENSION[extname(path)];
    if (!language) continue;
    const full = join(root, path);
    if ((await stat(full)).size > limits.maxFileBytes) continue;
    const content = await readFile(full, 'utf8');
    const loc = countLoc(content);
    if (totalLoc + loc > limits.maxLoc) {
      truncated = true;
      continue;
    }
    totalLoc += loc;
    files.push({ path, language, loc, content });
    locByLanguage.set(DISPLAY[language], (locByLanguage.get(DISPLAY[language]) ?? 0) + loc);
  }
  const languages = [...locByLanguage.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return { files, totalLoc, truncated, languages, packageName: await readPackageName(root) };
};
