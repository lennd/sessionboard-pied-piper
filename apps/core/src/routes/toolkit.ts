import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../http/deps';
import { requireRepo } from '../http/repo';
import { repoDir } from '../store/repos';
import { MAX_TOOLKIT_CHARS, readToolkit, writeToolkit } from '../store/toolkit';

const body = z.object({ text: z.string().max(MAX_TOOLKIT_CHARS) });

export const toolkitRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const withRepo = [requireRepo(deps)];
  api.get('/repos/:repoId/toolkit', { preHandler: withRepo }, async (req) => ({ text: await readToolkit(repoDir(req.repo!)) }));
  api.put('/repos/:repoId/toolkit', { preHandler: withRepo }, async (req) => ({ text: await writeToolkit(repoDir(req.repo!), body.parse(req.body).text) }));
};
