import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

describe('GET /health', () => {
  it('returns 200 when every check passes', async () => {
    const app = buildApp({ checks: { postgres: async () => {}, redis: async () => {} } });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
    await app.close();
  });

  it('returns 503 with the failing check message', async () => {
    const app = buildApp({
      checks: {
        postgres: async () => {},
        neo4j: async () => {
          throw new Error('connection refused');
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { postgres: 'ok', neo4j: 'connection refused' } });
    await app.close();
  });

  it('times out slow checks', async () => {
    const app = buildApp({ checks: { slow: () => new Promise(() => {}) }, checkTimeoutMs: 50 });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'degraded', checks: { slow: 'timed out after 50ms' } });
    await app.close();
  });
});

describe('loadConfig', () => {
  it('defaults to local ports', () => {
    expect(loadConfig({})).toEqual({
      port: 4040,
      databaseUrl: 'postgres://rdi:rdi@localhost:5548/rdi',
      neo4jUrl: 'bolt://localhost:7690',
      neo4jUser: 'neo4j',
      neo4jPassword: 'rdi-dev-password',
      redisUrl: 'redis://localhost:6391',
    });
  });

  it('reads overrides from env', () => {
    expect(loadConfig({ API_PORT: '5000', REDIS_URL: 'redis://x:1' })).toMatchObject({ port: 5000, redisUrl: 'redis://x:1' });
  });
});
