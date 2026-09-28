import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

describe('session and dev routes', () => {
  it('answers 401 without a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthorized' } });
  });

  it('creates a demo session with a secure http-only cookie, an org and a csrf token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/dev/demo-session', payload: {} });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/rdi_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const body = res.json();
    expect(body.orgs).toHaveLength(1);
    expect(body.orgs[0]).toMatchObject({ name: 'Demo', role: 'owner', defaultTheme: 'mission' });
    const session = await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: cookieFrom(res) } });
    expect(session.json()).toMatchObject({ user: { email: body.user.email }, csrfToken: body.csrfToken });
  });

  it('rejects mutating requests without the csrf header and accepts them with it', async () => {
    const demo = await ctx.app.inject({ method: 'POST', url: '/api/dev/demo-session', payload: {} });
    const cookie = cookieFrom(demo);
    const orgId = demo.json().orgs[0].id;
    const denied = await ctx.app.inject({ method: 'POST', url: `/api/dev/orgs/${orgId}/seed-repos`, headers: { cookie }, payload: {} });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: { code: 'csrf' } });
    const forged = await ctx.app.inject({ method: 'POST', url: `/api/dev/orgs/${orgId}/seed-repos`, headers: { cookie, 'x-csrf-token': 'nope' }, payload: {} });
    expect(forged.statusCode).toBe(403);
    const ok = await ctx.app.inject({ method: 'POST', url: `/api/dev/orgs/${orgId}/seed-repos`, headers: { cookie, 'x-csrf-token': demo.json().csrfToken }, payload: {} });
    expect(ok.statusCode).toBe(201);
  });

  it('exposes the dev mailbox', async () => {
    await ctx.mailer.send({ to: 'x@example.com', subject: 's', text: 't', kind: 'verify', link: 'http://l' });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/dev/mailbox?to=X@example.com' });
    expect(res.json().messages).toEqual([{ to: 'x@example.com', subject: 's', text: 't', kind: 'verify', link: 'http://l' }]);
  });

  it('keeps health working without deps', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
