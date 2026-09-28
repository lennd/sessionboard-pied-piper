import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Check } from './checks';
import { registerAuth } from './http/auth';
import type { AppDeps } from './http/deps';
import { authRoutes } from './routes/auth';
import { devRoutes } from './routes/dev';
import { invitationRoutes } from './routes/invitations';
import { meRoutes } from './routes/me';
import { orgRoutes } from './routes/orgs';

const DEFAULT_CHECK_TIMEOUT_MS = 3000;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;
const HTTP_INTERNAL = 500;

type BuildAppOptions = { checks: Record<string, Check>; onClose?: () => Promise<void>; checkTimeoutMs?: number; deps?: AppDeps };

const withTimeout = (check: Check, ms: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    check().then(
      () => { clearTimeout(timer); resolve(); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });

export const buildApp = ({ checks, onClose, checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS, deps }: BuildAppOptions): FastifyInstance => {
  const app = Fastify({ logger: false, trustProxy: true });

  app.get('/health', async (_request, reply) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check, checkTimeoutMs);
          return [name, 'ok'] as const;
        } catch (error) {
          return [name, error instanceof Error ? error.message : String(error)] as const;
        }
      }),
    );
    const allOk = entries.every(([, result]) => result === 'ok');
    return reply.code(allOk ? HTTP_OK : HTTP_UNAVAILABLE).send({ status: allOk ? 'ok' : 'degraded', checks: Object.fromEntries(entries) });
  });

  if (deps) {
    app.register(cookie);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(HTTP_BAD_REQUEST).send({ error: { code: 'validation', fields: error.issues.map((i) => i.path.join('.')) } });
      if ((error as { statusCode?: number }).statusCode === HTTP_BAD_REQUEST) return reply.code(HTTP_BAD_REQUEST).send({ error: { code: 'validation' } });
      console.error(error);
      return reply.code(HTTP_INTERNAL).send({ error: { code: 'internal' } });
    });
    app.register(
      async (api) => {
        registerAuth(api, deps);
        authRoutes(api, deps);
        meRoutes(api, deps);
        orgRoutes(api, deps);
        invitationRoutes(api, deps);
        if (deps.config.devRoutes) devRoutes(api, deps);
      },
      { prefix: '/api' },
    );
  }

  if (onClose) app.addHook('onClose', onClose);
  return app;
};
