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
  it('defaults to local development values', () => {
    expect(loadConfig({})).toEqual({
      port: 4040,
      databaseUrl: 'postgres://rdi:rdi@localhost:5548/rdi',
      neo4jUrl: 'bolt://localhost:7690',
      neo4jUser: 'neo4j',
      neo4jPassword: 'rdi-dev-password',
      redisUrl: 'redis://localhost:6391',
      nodeEnv: 'development',
      appUrl: 'http://localhost:5177',
      devRoutes: false,
      cookieSecure: true,
      rateLimitPrefix: 'rl',
      rateLimitsEnabled: true,
      dbEnsure: false,
      trustProxy: false,
      demoRepos: true,
      github: null,
      agent: { enabled: false, fake: false, model: 'claude-opus-5', monthlyTokenBudget: 2_000_000 },
    });
  });

  it('reads overrides from env', () => {
    expect(loadConfig({ API_PORT: '5000', REDIS_URL: 'redis://x:1', RDI_DEV_ROUTES: 'true', RATE_LIMITS: 'off' })).toMatchObject({
      port: 5000, redisUrl: 'redis://x:1', devRoutes: true, rateLimitsEnabled: false,
    });
  });

  it('never enables dev routes, disables rate limits or insecure cookies in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', RDI_DEV_ROUTES: 'true', RATE_LIMITS: 'off', COOKIE_SECURE: 'false' })).toMatchObject({ devRoutes: false, rateLimitsEnabled: true, cookieSecure: true });
  });

  it('parses proxy trust as boolean, hop count or address list', () => {
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: '10.0.0.0/8' }).trustProxy).toBe('10.0.0.0/8');
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });

  it('enables the agent from credentials and never uses the fake model in production', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: 'k' }).agent.enabled).toBe(true);
    expect(loadConfig({ AGENT_ENABLED: 'true', AGENT_MODEL: 'claude-sonnet-5' }).agent).toMatchObject({ enabled: true, model: 'claude-sonnet-5' });
    expect(loadConfig({ RDI_FAKE_LLM: 'true' }).agent).toMatchObject({ enabled: true, fake: true });
    expect(loadConfig({ NODE_ENV: 'production', RDI_FAKE_LLM: 'true' }).agent).toMatchObject({ enabled: false, fake: false });
  });

  it('reads GitHub App settings only when complete and never offers demo repos in production', () => {
    const env = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'k\\nk', GITHUB_APP_SLUG: 's', GITHUB_WEBHOOK_SECRET: 'w', GITHUB_STATE_SECRET: 'st' };
    expect(loadConfig(env).github).toEqual({ appId: '1', privateKey: 'k\nk', slug: 's', webhookSecret: 'w', stateSecret: 'st' });
    expect(loadConfig({ GITHUB_APP_ID: '1' }).github).toBeNull();
    expect(loadConfig({ NODE_ENV: 'production', DEMO_REPOS: 'true' }).demoRepos).toBe(false);
  });
});
