import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../http/deps';
import { checkSetup } from '../setup/check';

const query = z.object({ refresh: z.string().optional() });

export const setupRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/setup', async (req) => checkSetup({ claudeExecutable: deps.config.agent.claudeExecutable, ghBin: deps.config.ghBin }, query.parse(req.query).refresh === '1'));
};
