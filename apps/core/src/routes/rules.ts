import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../http/deps';
import { requireRepo } from '../http/repo';
import { repoDir } from '../store/repos';
import { MAX_RULES_CHARS, readRules, ruleLines, writeRules } from '../store/rules';

const body = z.object({ text: z.string().max(MAX_RULES_CHARS) });

export const rulesRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const withRepo = [requireRepo(deps)];
  api.get('/repos/:repoId/rules', { preHandler: withRepo }, async (req) => {
    const text = await readRules(repoDir(req.repo!));
    return { text, count: ruleLines(text).length };
  });
  api.put('/repos/:repoId/rules', { preHandler: withRepo }, async (req) => {
    const text = await writeRules(repoDir(req.repo!), body.parse(req.body).text);
    return { text, count: ruleLines(text).length };
  });
};
