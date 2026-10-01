import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_TOKENS_PER_USER } from '../src/db/queries/tokens';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};

describe('access tokens', () => {
  it('creates a token shown once, lists it without the secret and revokes it', async () => {
    const { owner, org } = await setup();
    const created = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/tokens`, headers: authed(owner), payload: { name: 'laptop' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().token).toMatch(/^rdi_/);
    const list = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/tokens`, headers: { cookie: owner.cookie } })).json();
    expect(list).toEqual([{ id: created.json().id, name: 'laptop', prefix: created.json().prefix, lastUsedAt: null, createdAt: expect.any(String) }]);
    expect(JSON.stringify(list)).not.toContain(created.json().token);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/orgs/${org.id}/tokens/${created.json().id}`, headers: authed(owner) })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/orgs/${org.id}/tokens/${created.json().id}`, headers: authed(owner) })).statusCode).toBe(404);
  });

  it('limits tokens per user and exposes the MCP url', async () => {
    const { owner, org } = await setup();
    for (let i = 0; i < MAX_TOKENS_PER_USER; i++) await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/tokens`, headers: authed(owner), payload: { name: `t${i}` } });
    expect((await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/tokens`, headers: authed(owner), payload: { name: 'one more' } })).json()).toEqual({ error: { code: 'token_limit' } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/mcp-info', headers: { cookie: owner.cookie } })).json()).toEqual({ url: 'http://localhost:4040/mcp', serverName: 'repository-designer' });
  });
});
