import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import { createRateLimiter } from '../auth/rateLimit';
import { randomToken } from '../auth/tokens';
import { RESET_TTL_MINUTES, VERIFY_TTL_MINUTES } from '../domain/constants';
import { consumeEmailToken, invalidateEmailTokens, issueEmailToken } from '../db/queries/emailTokens';
import { createSession, revokeSession, revokeUserSessions } from '../db/queries/sessions';
import { findUserByEmail, insertUser, markVerified, updatePassword, type UserRow } from '../db/queries/users';
import { clearSessionCookie, fail, requireAuth, setSessionCookie } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';
import { sessionPayload } from '../http/payloads';

const MAX_EMAIL = 254;
const MAX_NAME = 80;
const MAX_PASSWORD = 200;
const MAX_TOKEN = 200;
const MINUTE = 60;
const HOUR = 3600;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL));
const tokenSchema = z.object({ token: z.string().min(10).max(MAX_TOKEN) });
const signupSchema = z.object({ email: emailSchema, name: z.string().trim().min(1).max(MAX_NAME), password: z.string().max(MAX_PASSWORD) });
const loginSchema = z.object({ email: emailSchema, password: z.string().max(MAX_PASSWORD) });
const emailOnly = z.object({ email: emailSchema });
const resetSchema = z.object({ token: z.string().min(10).max(MAX_TOKEN), password: z.string().max(MAX_PASSWORD) });

let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

export const authRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const limiter = createRateLimiter(deps.redis, deps.config.rateLimitPrefix);
  const limited = async (reply: FastifyReply, key: string, limit: number, windowSeconds: number): Promise<boolean> => {
    if (!deps.config.rateLimitsEnabled) return false;
    const result = await limiter.hit(key, limit, windowSeconds);
    if (result.allowed) return false;
    reply.header('retry-after', String(result.retryAfter));
    fail(reply, 429, 'rate_limited');
    return true;
  };

  const sendVerification = async (user: UserRow) => {
    const token = await issueEmailToken(deps.pool, user.id, 'verify', VERIFY_TTL_MINUTES, nowOf(deps));
    await deps.mailer.send({ to: user.email, kind: 'verify', subject: 'Verify your email for Repository Designer', text: `Hi ${user.name}, confirm your email to start exploring.`, link: `${deps.config.appUrl}/verify?token=${token}` });
  };

  api.get('/auth/session', async (req, reply) => {
    if (!req.auth) return fail(reply, 401, 'unauthorized');
    return sessionPayload(deps.pool, req.auth.user, req.auth.session);
  });

  api.post('/auth/signup', async (req, reply) => {
    const body = signupSchema.parse(req.body);
    if ((await limited(reply, `signup:ip:${req.ip}`, 5, HOUR)) || (await limited(reply, `signup:email:${body.email}`, 5, HOUR))) return reply;
    const problem = passwordProblem(body.password);
    if (problem) return fail(reply, 400, 'weak_password', { reason: problem });
    if (await findUserByEmail(deps.pool, body.email)) return fail(reply, 409, 'email_taken');
    const user = await insertUser(deps.pool, { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) });
    await sendVerification(user);
    return reply.code(201).send({ ok: true });
  });

  api.post('/auth/verify', async (req, reply) => {
    const { token } = tokenSchema.parse(req.body);
    const userId = await consumeEmailToken(deps.pool, token, 'verify', nowOf(deps));
    if (!userId) return fail(reply, 400, 'invalid_token');
    await markVerified(deps.pool, userId, nowOf(deps));
    return { ok: true };
  });

  api.post('/auth/resend-verification', async (req, reply) => {
    const { email } = emailOnly.parse(req.body);
    if ((await limited(reply, `resend:ip:${req.ip}`, 10, HOUR)) || (await limited(reply, `resend:email:${email}`, 3, HOUR))) return reply;
    const user = await findUserByEmail(deps.pool, email);
    if (user && !user.email_verified_at) await sendVerification(user);
    return { ok: true };
  });

  api.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    if ((await limited(reply, `login:ip:${req.ip}`, 10, 15 * MINUTE)) || (await limited(reply, `login:email:${body.email}`, 10, 15 * MINUTE))) return reply;
    const user = await findUserByEmail(deps.pool, body.email);
    const valid = user ? await verifyPassword(user.password_hash, body.password) : (await verifyPassword(await getDummyHash(), body.password), false);
    if (!user || !valid) return fail(reply, 401, 'invalid_credentials');
    if (!user.email_verified_at) return fail(reply, 403, 'email_not_verified');
    const { token, session } = await createSession(deps.pool, { userId: user.id, userAgent: req.headers['user-agent'] ?? null, ip: req.ip, now: nowOf(deps) });
    setSessionCookie(reply, deps.config, token);
    return sessionPayload(deps.pool, user, session);
  });

  api.post('/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    await revokeSession(deps.pool, req.auth!.session.id_hash, nowOf(deps));
    clearSessionCookie(reply);
    return { ok: true };
  });

  api.post('/auth/forgot', async (req, reply) => {
    const { email } = emailOnly.parse(req.body);
    if ((await limited(reply, `forgot:ip:${req.ip}`, 10, HOUR)) || (await limited(reply, `forgot:email:${email}`, 5, HOUR))) return reply;
    const user = await findUserByEmail(deps.pool, email);
    if (user) {
      const token = await issueEmailToken(deps.pool, user.id, 'reset', RESET_TTL_MINUTES, nowOf(deps));
      await deps.mailer.send({ to: user.email, kind: 'reset', subject: 'Reset your Repository Designer password', text: 'Use this link within 30 minutes to choose a new password.', link: `${deps.config.appUrl}/reset?token=${token}` });
    }
    return { ok: true };
  });

  api.post('/auth/reset', async (req, reply) => {
    const body = resetSchema.parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) return fail(reply, 400, 'weak_password', { reason: problem });
    const now = nowOf(deps);
    const userId = await consumeEmailToken(deps.pool, body.token, 'reset', now);
    if (!userId) return fail(reply, 400, 'invalid_token');
    await updatePassword(deps.pool, userId, await hashPassword(body.password));
    await invalidateEmailTokens(deps.pool, userId, 'reset', now);
    await markVerified(deps.pool, userId, now);
    await revokeUserSessions(deps.pool, userId, now);
    return { ok: true };
  });
};
