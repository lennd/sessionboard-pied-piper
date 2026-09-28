import Fastify, { type FastifyInstance } from 'fastify';
import type { Check } from './checks';

const DEFAULT_CHECK_TIMEOUT_MS = 3000;
const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;

type BuildAppOptions = { checks: Record<string, Check>; onClose?: () => Promise<void>; checkTimeoutMs?: number };

const withTimeout = (check: Check, ms: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    check().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export const buildApp = ({ checks, onClose, checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS }: BuildAppOptions): FastifyInstance => {
  const app = Fastify({ logger: false });

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
    return reply
      .code(allOk ? HTTP_OK : HTTP_UNAVAILABLE)
      .send({ status: allOk ? 'ok' : 'degraded', checks: Object.fromEntries(entries) });
  });

  if (onClose) app.addHook('onClose', onClose);
  return app;
};
