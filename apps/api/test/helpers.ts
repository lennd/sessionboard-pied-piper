import { createGraphStore } from '@rdi/graph';
import type { GitHubClient } from '@rdi/providers';
import type { LlmClient } from '../src/agent/llm';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { createPgPool, createRedisClient } from '../src/checks';
import { loadConfig, type Config } from '../src/config';
import { createDevMailer } from '../src/mail/mailer';
import type { IndexJobData } from '../src/queue/indexQueue';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './setup/env';

const TABLES = ['repos', 'github_installations', 'invitations', 'email_tokens', 'sessions', 'memberships', 'orgs', 'users'];
const RATE_PREFIX = 'rltest';

export const createTestContext = async (options: { github?: Config['github']; githubClient?: GitHubClient; llm?: LlmClient | null; heartbeatMs?: number } = {}) => {
  const base = loadConfig({ DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL, RDI_DEV_ROUTES: 'true', RATE_LIMIT_PREFIX: RATE_PREFIX });
  const config: Config = { ...base, github: options.github ?? null, agent: { ...base.agent, heartbeatMs: options.heartbeatMs ?? base.agent.heartbeatMs } };
  const pool = createPgPool(config.databaseUrl, 5);
  const redis = createRedisClient(config.redisUrl);
  const mailer = createDevMailer(() => {});
  const graph = createGraphStore('bolt://localhost:7690', 'neo4j', 'rdi-dev-password');
  await graph.ensureSchema();
  const jobs: IndexJobData[] = [];
  const indexQueue = { enqueue: async (job: IndexJobData) => { jobs.push(job); }, close: async () => {} };
  const app = buildApp({ checks: {}, deps: { config, pool, redis, mailer, graph, indexQueue, github: options.githubClient ?? null, llm: options.llm ?? null } });
  await app.ready();
  const reset = async () => {
    await pool.query(`truncate ${TABLES.join(', ')} cascade`);
    const keys = await redis.keys(`${RATE_PREFIX}:*`);
    if (keys.length) await redis.del(...keys);
    jobs.length = 0;
  };
  const close = async () => {
    await app.close();
    await pool.end();
    redis.disconnect();
    await graph.close();
  };
  return { app, pool, redis, mailer, config, graph, jobs, reset, close };
};

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

export const cookieFrom = (res: LightMyRequestResponse): string => {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith('rdi_session='))?.split(';')[0] ?? '';
};

export const tokenFromLink = (link: string): string => new URL(link).searchParams.get('token') ?? link.split('/').pop() ?? '';

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${Date.now()}${counter++}@example.com`;

export const signupVerified = async (ctx: TestContext, email = uniqueEmail(), password = 'correct horse battery') => {
  await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, name: 'Test User', password } });
  const mail = ctx.mailer.inbox(email).find((m) => m.kind === 'verify');
  if (mail?.link) await ctx.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: tokenFromLink(mail.link) } });
  const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const body = login.json();
  return { email, password, cookie: cookieFrom(login), csrf: body.csrfToken as string, userId: body.user?.id as string };
};

export const authed = (s: { cookie: string; csrf: string }) => ({ cookie: s.cookie, 'x-csrf-token': s.csrf });
