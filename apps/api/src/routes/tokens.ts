import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { countApiTokens, createApiToken, listApiTokens, MAX_TOKENS_PER_USER, revokeApiToken } from '../db/queries/tokens';
import { fail, isUuid, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';

export const MCP_SERVER_NAME = 'repository-designer';
const MAX_NAME = 80;

export const tokenRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];

  api.get('/orgs/:orgId/tokens', { preHandler: member }, async (req) =>
    (await listApiTokens(deps.pool, req.member!.org.id, req.auth!.user.id)).map((t) => ({
      id: t.id, name: t.name, prefix: t.prefix, lastUsedAt: t.last_used_at?.toISOString() ?? null, createdAt: t.created_at.toISOString(),
    })));

  api.post('/orgs/:orgId/tokens', { preHandler: member }, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(MAX_NAME) }).parse(req.body);
    const orgId = req.member!.org.id;
    if ((await countApiTokens(deps.pool, orgId, req.auth!.user.id)) >= MAX_TOKENS_PER_USER) return fail(reply, 409, 'token_limit');
    const created = await createApiToken(deps.pool, { orgId, userId: req.auth!.user.id, name });
    return reply.code(201).send({ id: created.id, name: created.name, prefix: created.prefix, token: created.token, createdAt: created.created_at.toISOString() });
  });

  api.delete('/orgs/:orgId/tokens/:id', { preHandler: member }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id) || (await revokeApiToken(deps.pool, req.member!.org.id, req.auth!.user.id, id)) === 0) return fail(reply, 404, 'not_found');
    return reply.code(204).send();
  });

  api.get('/mcp-info', { preHandler: requireAuth }, async () => ({ url: `${deps.config.publicApiUrl}/mcp`, serverName: MCP_SERVER_NAME }));
};
