import type { FastifyInstance } from 'fastify';
import { fail } from '../http/auth';
import type { AppDeps } from '../http/deps';
import { sessionPayload } from '../http/payloads';

export const authRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/auth/session', async (req, reply) => {
    if (!req.auth) return fail(reply, 401, 'unauthorized');
    return sessionPayload(deps.pool, req.auth.user, req.auth.session);
  });
};
