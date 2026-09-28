import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, cookieFrom, createTestContext, signupVerified, tokenFromLink, uniqueEmail, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => ctx.app.inject({ method: 'POST', url, payload: payload as object, headers });
const PASSWORD = 'correct horse battery';

describe('sign-up and verification', () => {
  it('rejects weak passwords and duplicate emails', async () => {
    expect((await post('/api/auth/signup', { email: uniqueEmail(), name: 'A', password: 'short' })).json()).toEqual({ error: { code: 'weak_password', reason: 'too_short' } });
    const email = uniqueEmail();
    expect((await post('/api/auth/signup', { email, name: 'A', password: PASSWORD })).statusCode).toBe(201);
    expect((await post('/api/auth/signup', { email: email.toUpperCase(), name: 'A', password: PASSWORD })).json()).toEqual({ error: { code: 'email_taken' } });
  });

  it('validates input shape', async () => {
    const res = await post('/api/auth/signup', { email: 'not-an-email', name: '', password: PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it('requires verification before sign-in and verifies with the emailed link once', async () => {
    const email = uniqueEmail();
    await post('/api/auth/signup', { email, name: 'Ana', password: PASSWORD });
    expect((await post('/api/auth/login', { email, password: PASSWORD })).json()).toEqual({ error: { code: 'email_not_verified' } });
    const mail = ctx.mailer.inbox(email).find((m) => m.kind === 'verify')!;
    expect(mail.link).toMatch(/^http:\/\/localhost:5177\/verify\?token=/);
    expect((await post('/api/auth/verify', { token: tokenFromLink(mail.link!) })).statusCode).toBe(200);
    expect((await post('/api/auth/verify', { token: tokenFromLink(mail.link!) })).json()).toEqual({ error: { code: 'invalid_token' } });
    expect((await post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
  });

  it('resend-verification always answers 200', async () => {
    expect((await post('/api/auth/resend-verification', { email: uniqueEmail() })).statusCode).toBe(200);
  });
});

describe('sign-in and sign-out', () => {
  it('uses the same error for unknown emails and wrong passwords', async () => {
    const s = await signupVerified(ctx);
    const wrong = await post('/api/auth/login', { email: s.email, password: 'wrong horse battery' });
    const unknown = await post('/api/auth/login', { email: uniqueEmail(), password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(unknown.json()).toEqual({ error: { code: 'invalid_credentials' } });
  });

  it('returns the session payload and signs out', async () => {
    const s = await signupVerified(ctx);
    const session = await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } });
    expect(session.json()).toMatchObject({ user: { email: s.email, uiLanguage: null }, orgs: [] });
    expect((await post('/api/auth/logout', {}, authed(s))).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } })).statusCode).toBe(401);
  });

  it('rate-limits sign-in attempts per email', async () => {
    const email = uniqueEmail();
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await post('/api/auth/login', { email, password: 'wrong horse battery' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('rate limits cannot be bypassed', () => {
  it('ignores spoofed X-Forwarded-For when proxies are not trusted', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await post('/api/auth/signup', { email: uniqueEmail(), name: 'A', password: PASSWORD }, { 'x-forwarded-for': `10.0.0.${i}` })).statusCode);
    }
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('limits forgot requests per IP', async () => {
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await post('/api/auth/forgot', { email: uniqueEmail() })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('password reset', () => {
  it('forgot always answers 200 and only mails existing users', async () => {
    const unknown = uniqueEmail();
    expect((await post('/api/auth/forgot', { email: unknown })).statusCode).toBe(200);
    expect(ctx.mailer.inbox(unknown)).toEqual([]);
  });

  it('invalidates every other reset link after a reset', async () => {
    const s = await signupVerified(ctx);
    await post('/api/auth/forgot', { email: s.email });
    await post('/api/auth/forgot', { email: s.email });
    const [first, second] = ctx.mailer.inbox(s.email).filter((m) => m.kind === 'reset').map((m) => tokenFromLink(m.link!));
    expect((await post('/api/auth/reset', { token: second, password: 'brand new passphrase' })).statusCode).toBe(200);
    expect((await post('/api/auth/reset', { token: first, password: 'attacker passphrase 1' })).json()).toEqual({ error: { code: 'invalid_token' } });
  });

  it('resets once and signs out every session', async () => {
    const s = await signupVerified(ctx);
    await post('/api/auth/forgot', { email: s.email });
    const token = tokenFromLink(ctx.mailer.inbox(s.email).find((m) => m.kind === 'reset')!.link!);
    expect((await post('/api/auth/reset', { token, password: 'short' })).json().error.code).toBe('weak_password');
    expect((await post('/api/auth/reset', { token, password: 'brand new passphrase' })).statusCode).toBe(200);
    expect((await post('/api/auth/reset', { token, password: 'another new passphrase' })).json()).toEqual({ error: { code: 'invalid_token' } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } })).statusCode).toBe(401);
    const login = await post('/api/auth/login', { email: s.email, password: 'brand new passphrase' });
    expect(cookieFrom(login)).toMatch(/^rdi_session=/);
  });
});
