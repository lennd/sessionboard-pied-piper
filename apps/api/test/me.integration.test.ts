import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const req = (method: 'GET' | 'PATCH' | 'POST' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });

describe('/api/me', () => {
  it('updates and resets preferences with validation', async () => {
    const s = await signupVerified(ctx);
    const updated = await req('PATCH', '/api/me', authed(s), { uiLanguage: 'es', theme: 'paper', initialLevel: 'components' });
    expect(updated.json()).toMatchObject({ uiLanguage: 'es', theme: 'paper', initialLevel: 'components' });
    expect((await req('PATCH', '/api/me', authed(s), { theme: null })).json().theme).toBeNull();
    expect((await req('PATCH', '/api/me', authed(s), { theme: 'neon' })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/me', authed(s), { email: 'x@y.z' })).statusCode).toBe(400);
  });

  it('requires the csrf header', async () => {
    const s = await signupVerified(ctx);
    expect((await req('PATCH', '/api/me', { cookie: s.cookie }, { theme: 'paper' })).statusCode).toBe(403);
  });

  it('changes the password and signs out other sessions only', async () => {
    const s = await signupVerified(ctx);
    const other = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: s.email, password: s.password } });
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]!;
    expect((await req('POST', '/api/me/password', authed(s), { currentPassword: 'wrong horse battery', newPassword: 'fresh passphrase 99' })).json()).toEqual({ error: { code: 'invalid_credentials' } });
    expect((await req('POST', '/api/me/password', authed(s), { currentPassword: s.password, newPassword: 'fresh passphrase 99' })).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/session', { cookie: s.cookie })).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/session', { cookie: otherCookie })).statusCode).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const s = await signupVerified(ctx);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: s.email, password: s.password } });
    const list = (await req('GET', '/api/me/sessions', { cookie: s.cookie })).json() as { id: string; current: boolean }[];
    expect(list).toHaveLength(2);
    expect(list.filter((x) => x.current)).toHaveLength(1);
    const other = list.find((x) => !x.current)!;
    expect((await req('DELETE', `/api/me/sessions/${other.id}`, authed(s))).statusCode).toBe(204);
    expect((await req('GET', '/api/me/sessions', { cookie: s.cookie })).json()).toHaveLength(1);
    expect((await req('DELETE', '/api/me/sessions/not-a-uuid', authed(s))).statusCode).toBe(404);
  });
});
