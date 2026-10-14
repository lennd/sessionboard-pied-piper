import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { ZodError } from 'zod';
import type { AppDeps } from './http/deps';
import { mcpRoutes } from './mcp/route';
import { agentRoutes } from './routes/agent';
import { codeRoutes } from './routes/code';
import { prefsRoutes } from './routes/prefs';
import { pullRoutes } from './routes/pulls';
import { repoRoutes } from './routes/repos';
import { rulesRoutes } from './routes/rules';
import { runRoutes } from './routes/runs';
import { sessionRoutes } from './routes/sessions';
import { solutionRoutes } from './routes/solutions';

const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL = 500;
const INDEX_HTML = 'index.html';
const API_PREFIX = '/api';
const MCP_PREFIX = '/mcp';

export const buildApp = (deps: AppDeps): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(HTTP_BAD_REQUEST).send({ error: { code: 'validation', fields: error.issues.map((i) => i.path.join('.')) } });
    if ((error as { statusCode?: number }).statusCode === HTTP_BAD_REQUEST) return reply.code(HTTP_BAD_REQUEST).send({ error: { code: 'validation' } });
    console.error(error);
    return reply.code(HTTP_INTERNAL).send({ error: { code: 'internal' } });
  });

  app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok', home: deps.config.home, agent: deps.queryFn !== null, fake: deps.config.agent.fake }));
      repoRoutes(api, deps);
      prefsRoutes(api, deps);
      codeRoutes(api, deps);
      agentRoutes(api, deps);
      solutionRoutes(api, deps);
      sessionRoutes(api, deps);
      runRoutes(api, deps);
      pullRoutes(api, deps);
      rulesRoutes(api, deps);
    },
    { prefix: API_PREFIX },
  );
  mcpRoutes(app, deps);

  if (deps.config.webDist) {
    const root = deps.config.webDist;
    app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith(API_PREFIX) || request.url.startsWith(MCP_PREFIX)) return reply.code(404).send({ error: { code: 'not_found' } });
      return reply.sendFile(INDEX_HTML, join(root));
    });
  }
  return app;
};
