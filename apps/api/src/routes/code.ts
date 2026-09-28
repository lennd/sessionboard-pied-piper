import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readSource } from '../db/queries/agent';
import { fail, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';

export const MAX_CODE_LINES = 400;
const MAX_PATH = 500;
const MAX_REPO = 200;

const codeQuery = z.object({
  repo: z.string().min(1).max(MAX_REPO),
  path: z.string().min(1).max(MAX_PATH),
  start: z.coerce.number().int().optional(),
  end: z.coerce.number().int().optional(),
});

export const sliceLines = (content: string, start: number, end: number) => {
  const lines = content.split('\n');
  const startLine = Math.min(Math.max(1, start), lines.length);
  const endLine = Math.min(Math.max(startLine, end), lines.length, startLine + MAX_CODE_LINES - 1);
  return { startLine, endLine, snippet: lines.slice(startLine - 1, endLine).join('\n') };
};

export const codeRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/orgs/:orgId/code', { preHandler: [requireAuth, requireMember(deps)] }, async (req, reply) => {
    const query = codeQuery.parse(req.query);
    const source = await readSource(deps.pool, req.member!.org.id, query.repo, query.path);
    if (!source) return fail(reply, 404, 'not_found');
    const start = query.start ?? 1;
    return { repo: query.repo, path: query.path, language: source.language, ...sliceLines(source.content, start, query.end ?? start + MAX_CODE_LINES - 1) };
  });
};
