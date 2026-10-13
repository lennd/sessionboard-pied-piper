import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { gitInfo } from '../git/git';
import { nowOf, type AppDeps } from '../http/deps';
import { findRepo, repoDir } from '../store/repos';
import { readSystemMap } from '../store/scenes';
import { buildMcpServer } from './server';

const NOT_FOUND = -32004;
const METHOD_NOT_ALLOWED = -32000;

const rpcError = (reply: FastifyReply, status: number, code: number, message: string) =>
  reply.code(status).send({ jsonrpc: '2.0', error: { code, message }, id: null });

export const mcpUrl = (config: { host: string; port: number }, repoId: string) => `http://${config.host}:${config.port}/mcp/${repoId}`;

export const mcpRoutes = (app: FastifyInstance, deps: AppDeps) => {
  app.post('/mcp/:repoId', async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const repo = await findRepo(deps.config.home, repoId);
    if (!repo) return rpcError(reply, 404, NOT_FOUND, 'Unknown repository.');
    const dir = repoDir(repo);
    const server = buildMcpServer({ dir, events: deps.events, now: () => nowOf(deps), systemMap: async () => readSystemMap(dir, (await gitInfo(repo.path)).head) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
    return reply;
  });
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({ method, url: '/mcp/:repoId', handler: async (_req, reply) => rpcError(reply, 405, METHOD_NOT_ALLOWED, 'Method not allowed.') });
  }
};
