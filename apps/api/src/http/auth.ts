import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { SESSION_TTL_DAYS } from '../domain/constants';
import { can, type Action, type Role } from '../domain/roles';
import { findMembership, type OrgRow } from '../db/queries/orgs';
import { findActiveSession, type SessionRow } from '../db/queries/sessions';
import { findUserById, type UserRow } from '../db/queries/users';
import { nowOf, type AppDeps } from './deps';

export const SESSION_COOKIE = 'rdi_session';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_SECONDS = 86_400;

export type AuthContext = { user: UserRow; session: SessionRow; token: string };
export type MemberContext = { org: OrgRow; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    member: MemberContext | null;
  }
}

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export const fail = (reply: FastifyReply, status: number, code: string, extra: Record<string, unknown> = {}) =>
  reply.code(status).send({ error: { code, ...extra } });

export const setSessionCookie = (reply: FastifyReply, config: Config, token: string) =>
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_DAYS * DAY_SECONDS });

export const clearSessionCookie = (reply: FastifyReply) => reply.clearCookie(SESSION_COOKIE, { path: '/' });

export const registerAuth = (api: FastifyInstance, deps: AppDeps) => {
  api.decorateRequest('auth', null);
  api.decorateRequest('member', null);
  api.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await findActiveSession(deps.pool, token, nowOf(deps));
    if (!session) return;
    const user = await findUserById(deps.pool, session.user_id);
    if (user) req.auth = { user, session, token };
  });
};

export const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.auth) return fail(reply, 401, 'unauthorized');
  if (MUTATING.has(req.method) && req.headers['x-csrf-token'] !== req.auth.session.csrf_token) return fail(reply, 403, 'csrf');
};

export const requireMember = (deps: AppDeps) => async (req: FastifyRequest, reply: FastifyReply) => {
  const orgId = (req.params as { orgId?: string }).orgId;
  if (!req.auth || !isUuid(orgId)) return fail(reply, 404, 'not_found');
  const found = await findMembership(deps.pool, orgId, req.auth.user.id);
  if (!found) return fail(reply, 404, 'not_found');
  req.member = found;
};

export const requireAction = (action: Action) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.member || !can(req.member.role, action)) return fail(reply, 403, 'forbidden');
};
