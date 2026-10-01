import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { resolveApiToken } from '../db/queries/tokens';
import { nowOf, type AppDeps } from '../http/deps';
import { buildMcpServer } from './server';

const BEARER = /^Bearer\s+(\S+)$/i;
const UNAUTHORIZED = -32001;
const METHOD_NOT_ALLOWED = -32000;

const rpcError = (reply: FastifyReply, status: number, code: number, message: string) =>
  reply.code(status).send({ jsonrpc: '2.0', error: { code, message }, id: null });

export const mcpRoutes = (app: FastifyInstance, deps: AppDeps) => {
  app.post('/mcp', async (req, reply) => {
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    const identity = token ? await resolveApiToken(deps.pool, token, nowOf(deps)) : null;
    if (!identity) return rpcError(reply, 401, UNAUTHORIZED, 'A valid Repository Designer access token is required.');
    const server = buildMcpServer({ orgId: identity.orgId, userId: identity.userId, pool: deps.pool, redis: deps.redis, graph: deps.graph });
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
    app.route({ method, url: '/mcp', handler: async (_req, reply) => rpcError(reply, 405, METHOD_NOT_ALLOWED, 'Method not allowed.') });
  }
};
