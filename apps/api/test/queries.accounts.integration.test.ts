import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgPool } from '../src/checks';
import { consumeEmailToken, issueEmailToken } from '../src/db/queries/emailTokens';
import { createSession, findActiveSession, listUserSessions, revokeByPublicId, revokeUserSessions } from '../src/db/queries/sessions';
import { findUserByEmail, insertUser, markVerified, updateUser } from '../src/db/queries/users';
import { TEST_DATABASE_URL } from './setup/env';

const pool = createPgPool(TEST_DATABASE_URL);
const now = new Date('2026-09-28T12:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);
const HOUR = 3_600_000;

beforeEach(() => pool.query('truncate users cascade'));
afterAll(() => pool.end());

const user = () => insertUser(pool, { email: 'Ana@Example.com', name: 'Ana', passwordHash: 'h' });

describe('users', () => {
  it('finds users by email case-insensitively and updates whitelisted fields', async () => {
    const u = await user();
    expect((await findUserByEmail(pool, 'ana@example.com'))?.id).toBe(u.id);
    await markVerified(pool, u.id, now);
    const updated = await updateUser(pool, u.id, { theme: 'paper', ui_language: 'es' });
    expect(updated).toMatchObject({ theme: 'paper', ui_language: 'es', name: 'Ana' });
    expect(updated?.email_verified_at?.toISOString()).toBe(now.toISOString());
    expect((await updateUser(pool, u.id, { theme: null }))?.theme).toBeNull();
  });
});

describe('sessions', () => {
  it('creates, finds, slides and revokes sessions', async () => {
    const u = await user();
    const { token, session } = await createSession(pool, { userId: u.id, userAgent: 'test', ip: '1.1.1.1', now });
    expect(session.csrf_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.id_hash).not.toBe(token);
    expect((await findActiveSession(pool, token, later(10 * 60_000)))?.last_seen_at.toISOString()).toBe(now.toISOString());
    const slid = await findActiveSession(pool, token, later(2 * HOUR));
    expect(slid?.last_seen_at.toISOString()).toBe(later(2 * HOUR).toISOString());
    expect(await findActiveSession(pool, 'wrong', now)).toBeNull();
    expect(await findActiveSession(pool, token, later(40 * 24 * HOUR))).toBeNull();
    expect(await revokeByPublicId(pool, u.id, session.public_id, now)).toBe(1);
    expect(await findActiveSession(pool, token, now)).toBeNull();
  });

  it('revokes every session of a user except one', async () => {
    const u = await user();
    const a = await createSession(pool, { userId: u.id, userAgent: null, ip: null, now });
    const b = await createSession(pool, { userId: u.id, userAgent: null, ip: null, now });
    await revokeUserSessions(pool, u.id, now, a.session.id_hash);
    expect(await findActiveSession(pool, a.token, now)).not.toBeNull();
    expect(await findActiveSession(pool, b.token, now)).toBeNull();
    expect((await listUserSessions(pool, u.id, now)).map((s) => s.id_hash)).toEqual([a.session.id_hash]);
  });
});

describe('email tokens', () => {
  it('are single use, kind-bound and expire', async () => {
    const u = await user();
    const token = await issueEmailToken(pool, u.id, 'reset', 30, now);
    expect(await consumeEmailToken(pool, token, 'verify', now)).toBeNull();
    expect(await consumeEmailToken(pool, token, 'reset', later(31 * 60_000))).toBeNull();
    expect(await consumeEmailToken(pool, token, 'reset', later(60_000))).toBe(u.id);
    expect(await consumeEmailToken(pool, token, 'reset', later(60_000))).toBeNull();
  });
});
