import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { z } from 'zod';
import { fail } from '../http/fail';
import type { AppDeps } from '../http/deps';
import { requireRepo } from '../http/repo';

export const MAX_CODE_LINES = 400;
const MAX_PATH = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const LANGUAGE_BY_EXT: Record<string, string> = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx', '.mjs': 'js', '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.rb': 'ruby', '.sql': 'sql', '.json': 'json', '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml', '.css': 'css', '.html': 'html', '.sh': 'bash' };

const codeQuery = z.object({ repo: z.string().optional(), path: z.string().min(1).max(MAX_PATH), start: z.coerce.number().int().optional(), end: z.coerce.number().int().optional() });

export const sliceLines = (content: string, start: number, end: number) => {
  const lines = content.split('\n');
  const startLine = Math.min(Math.max(1, start), lines.length);
  const endLine = Math.min(Math.max(startLine, end), lines.length, startLine + MAX_CODE_LINES - 1);
  return { startLine, endLine, snippet: lines.slice(startLine - 1, endLine).join('\n') };
};

/** Resolves a repository-relative path and refuses anything that escapes the repository. */
export const insideRepo = (root: string, path: string): string | null => {
  const absolute = resolve(root, path);
  return absolute === root || absolute.startsWith(`${root}${sep}`) ? absolute : null;
};

export const languageOf = (path: string): string => LANGUAGE_BY_EXT[extname(path).toLowerCase()] ?? 'text';

export const codeRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/repos/:repoId/code', { preHandler: [requireRepo(deps)] }, async (req, reply) => {
    const query = codeQuery.parse(req.query);
    const absolute = insideRepo(req.repo!.path, query.path);
    if (!absolute) return fail(reply, 404, 'not_found');
    let content: string;
    try {
      const buffer = await readFile(absolute);
      if (buffer.byteLength > MAX_FILE_BYTES) return fail(reply, 413, 'file_too_large');
      content = buffer.toString('utf8');
    } catch {
      return fail(reply, 404, 'not_found');
    }
    const start = query.start ?? 1;
    return { repo: req.repo!.name, path: query.path, language: languageOf(query.path), ...sliceLines(content, start, query.end ?? start + MAX_CODE_LINES - 1) };
  });
};
