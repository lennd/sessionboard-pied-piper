import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { gitInfo } from '../git/git';
import { nowOf, type AppDeps } from '../http/deps';
import { featureDir, findFeature } from '../store/features';
import { findRepo, repoDir } from '../store/repos';
import { readSystemMap } from '../store/scenes';
import { buildMcpServer, type McpContext } from './server';

const NOT_FOUND = -32004;
const METHOD_NOT_ALLOWED = -32000;

const rpcError = (reply: FastifyReply, status: number, code: number, message: string) =>
  reply.code(status).send({ jsonrpc: '2.0', error: { code, message }, id: null });

export const mcpUrl = (config: { host: string; port: number }, repoId: string) => `http://${config.host}:${config.port}/mcp/${repoId}`;
export const featureMcpUrl = (config: { host: string; port: number }, featureId: string) => `http://${config.host}:${config.port}/mcp/features/${featureId}`;

const serve = async (req: FastifyRequest, reply: FastifyReply, ctx: McpContext) => {
  const server = buildMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  reply.hijack();
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
  return reply;
};

export const mcpRoutes = (app: FastifyInstance, deps: AppDeps) => {
  app.post('/mcp/features/:featureId', async (req, reply) => {
    const { featureId } = req.params as { featureId: string };
    const feature = await findFeature(deps.config.home, featureId);
    if (!feature) return rpcError(reply, 404, NOT_FOUND, 'Unknown feature.');
    const dir = featureDir(deps.config.home, feature.id);
    return serve(req, reply, { dir, events: deps.events, now: () => nowOf(deps), systemMap: () => readSystemMap(dir, null) });
  });

  app.post('/mcp/:repoId', async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const repo = await findRepo(deps.config.home, repoId);
    if (!repo) return rpcError(reply, 404, NOT_FOUND, 'Unknown repository.');
    const dir = repoDir(repo);
    return serve(req, reply, { dir, events: deps.events, now: () => nowOf(deps), systemMap: async () => readSystemMap(dir, (await gitInfo(repo.path)).head) });
  });

  for (const method of ['GET', 'DELETE'] as const) {
    for (const url of ['/mcp/:repoId', '/mcp/features/:featureId']) {
      app.route({ method, url, handler: async (_req, reply) => rpcError(reply, 405, METHOD_NOT_ALLOWED, 'Method not allowed.') });
    }
  }
};
