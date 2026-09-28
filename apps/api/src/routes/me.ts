import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import { LEVEL_IDS, THEME_IDS, UI_LANGUAGES } from '../domain/constants';
import { invalidateEmailTokens } from '../db/queries/emailTokens';
import { listUserSessions, revokeByPublicId, revokeUserSessions } from '../db/queries/sessions';
import { updatePassword, updateUser, type UserPatch } from '../db/queries/users';
import { clearSessionCookie, fail, isUuid, requireAuth } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';
import { publicUser } from '../http/payloads';

const MAX_NAME = 80;
const MAX_PASSWORD = 200;

const prefsSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME).optional(),
    uiLanguage: z.enum(UI_LANGUAGES).nullable().optional(),
    explanationLanguage: z.enum(UI_LANGUAGES).nullable().optional(),
    theme: z.enum(THEME_IDS).nullable().optional(),
    initialLevel: z.enum(LEVEL_IDS).nullable().optional(),
  })
  .strict();

const passwordSchema = z.object({ currentPassword: z.string().max(MAX_PASSWORD), newPassword: z.string().max(MAX_PASSWORD) });

const COLUMN: Record<keyof z.infer<typeof prefsSchema>, keyof UserPatch> = {
  name: 'name', uiLanguage: 'ui_language', explanationLanguage: 'explanation_language', theme: 'theme', initialLevel: 'initial_level',
};

export const meRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.patch('/me', { preHandler: requireAuth }, async (req) => {
    const body = prefsSchema.parse(req.body);
    const patch = Object.fromEntries(Object.entries(body).map(([key, value]) => [COLUMN[key as keyof typeof COLUMN], value])) as UserPatch;
    return publicUser((await updateUser(deps.pool, req.auth!.user.id, patch))!);
  });

  api.post('/me/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = passwordSchema.parse(req.body);
    if (!(await verifyPassword(req.auth!.user.password_hash, body.currentPassword))) return fail(reply, 400, 'invalid_credentials');
    const problem = passwordProblem(body.newPassword);
    if (problem) return fail(reply, 400, 'weak_password', { reason: problem });
    await updatePassword(deps.pool, req.auth!.user.id, await hashPassword(body.newPassword));
    await invalidateEmailTokens(deps.pool, req.auth!.user.id, 'reset', nowOf(deps));
    await revokeUserSessions(deps.pool, req.auth!.user.id, nowOf(deps), req.auth!.session.id_hash);
    return { ok: true };
  });

  api.get('/me/sessions', { preHandler: requireAuth }, async (req) =>
    (await listUserSessions(deps.pool, req.auth!.user.id, nowOf(deps))).map((s) => ({
      id: s.public_id, createdAt: s.created_at.toISOString(), lastSeenAt: s.last_seen_at.toISOString(),
      userAgent: s.user_agent, ip: s.ip, current: s.id_hash === req.auth!.session.id_hash,
    })),
  );

  api.delete('/me/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    const revoked = await revokeByPublicId(deps.pool, req.auth!.user.id, id, nowOf(deps));
    if (revoked === 0) return fail(reply, 404, 'not_found');
    if (id === req.auth!.session.public_id) clearSessionCookie(reply);
    return reply.code(204).send();
  });
};
