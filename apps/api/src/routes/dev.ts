import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import { randomToken } from '../auth/tokens';
import { createOrg } from '../db/queries/orgs';
import { upsertRepo, type RepoStage } from '../db/queries/repos';
import { createSession } from '../db/queries/sessions';
import { findUserById, insertUser, markVerified } from '../db/queries/users';
import { requireAuth, requireMember, setSessionCookie } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';
import { sessionPayload } from '../http/payloads';
import type { DevMailer } from '../mail/mailer';

const MINUTE_MS = 60_000;
const DEMO_TOKEN_BYTES = 6;

const DEMO_REPOS = (now: Date) => [
  {
    fullName: 'acme/web-store', defaultBranch: 'main', languages: ['TypeScript', 'React'], status: 'ready' as const, lastSyncedAt: new Date(now.getTime() - 4 * MINUTE_MS),
    stages: (['clone', 'parse', 'detect', 'summarize', 'link'] as const).map((name): RepoStage => ({ name, status: 'done' })),
  },
  {
    fullName: 'acme/orders-api', defaultBranch: 'main', languages: ['TypeScript', 'Node'], status: 'indexing' as const, lastSyncedAt: null,
    stages: [
      { name: 'clone', status: 'done' }, { name: 'parse', status: 'done' }, { name: 'detect', status: 'done', detail: '12 endpoints · 3 queues · 9 tables' },
      { name: 'summarize', status: 'running', progress: 64 }, { name: 'link', status: 'pending' },
    ] as RepoStage[],
  },
  {
    fullName: 'acme/ml-ranker', defaultBranch: 'develop', languages: ['Python'], status: 'error' as const, lastSyncedAt: new Date(now.getTime() - 24 * 60 * MINUTE_MS),
    error: 'repository exceeds 500k LOC',
    stages: [{ name: 'clone', status: 'done' }, { name: 'parse', status: 'error', detail: 'repository exceeds 500k LOC' }] as RepoStage[],
  },
];

export const devRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/dev/mailbox', async (req) => {
    const { to } = z.object({ to: z.string().min(1) }).parse(req.query);
    return { messages: (deps.mailer as Partial<DevMailer>).inbox?.(to) ?? [] };
  });

  api.post('/dev/demo-session', async (req, reply) => {
    const now = nowOf(deps);
    const email = `demo-${randomToken(DEMO_TOKEN_BYTES).toLowerCase().replace(/[^a-z0-9]/g, 'x')}@example.com`;
    const user = await insertUser(deps.pool, { email, name: 'Demo User', passwordHash: await hashPassword(randomToken()) });
    await markVerified(deps.pool, user.id, now);
    await createOrg(deps.pool, { name: 'Demo', ownerId: user.id });
    const { token, session } = await createSession(deps.pool, { userId: user.id, userAgent: req.headers['user-agent'] ?? null, ip: req.ip, now });
    setSessionCookie(reply, deps.config, token);
    return sessionPayload(deps.pool, (await findUserById(deps.pool, user.id))!, session);
  });

  api.post('/dev/orgs/:orgId/seed-repos', { preHandler: [requireAuth, requireMember(deps)] }, async (req, reply) => {
    for (const repo of DEMO_REPOS(nowOf(deps))) await upsertRepo(deps.pool, { orgId: req.member!.org.id, ...repo });
    return reply.code(201).send({ ok: true });
  });
};
