import { hashToken, randomToken } from '../../auth/tokens';
import { SESSION_TTL_DAYS } from '../../domain/constants';
import type { Db } from './users';

export type SessionRow = {
  id_hash: string; public_id: string; user_id: string; csrf_token: string; created_at: Date; last_seen_at: Date;
  expires_at: Date; revoked_at: Date | null; user_agent: string | null; ip: string | null;
};

const DAY_MS = 86_400_000;
const SLIDE_AFTER_MS = 3_600_000;
const expiryFrom = (now: Date) => new Date(now.getTime() + SESSION_TTL_DAYS * DAY_MS);

export const createSession = async (db: Db, input: { userId: string; userAgent: string | null; ip: string | null; now: Date }) => {
  const token = randomToken();
  const { rows } = await db.query<SessionRow>(
    `insert into sessions (id_hash, user_id, csrf_token, expires_at, user_agent, ip, created_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning *`,
    [hashToken(token), input.userId, randomToken(), expiryFrom(input.now), input.userAgent, input.ip, input.now],
  );
  return { token, session: rows[0]! };
};

export const findActiveSession = async (db: Db, token: string, now: Date): Promise<SessionRow | null> => {
  const session = (await db.query<SessionRow>('select * from sessions where id_hash = $1 and revoked_at is null and expires_at > $2', [hashToken(token), now])).rows[0];
  if (!session) return null;
  if (now.getTime() - session.last_seen_at.getTime() <= SLIDE_AFTER_MS) return session;
  const { rows } = await db.query<SessionRow>('update sessions set last_seen_at = $2, expires_at = $3 where id_hash = $1 returning *', [session.id_hash, now, expiryFrom(now)]);
  return rows[0] ?? session;
};

export const revokeSession = async (db: Db, idHash: string, now: Date): Promise<void> => {
  await db.query('update sessions set revoked_at = $2 where id_hash = $1 and revoked_at is null', [idHash, now]);
};

export const revokeUserSessions = async (db: Db, userId: string, now: Date, exceptIdHash?: string): Promise<void> => {
  await db.query("update sessions set revoked_at = $2 where user_id = $1 and revoked_at is null and id_hash <> coalesce($3, '')", [userId, now, exceptIdHash ?? null]);
};

export const listUserSessions = async (db: Db, userId: string, now: Date): Promise<SessionRow[]> =>
  (await db.query<SessionRow>('select * from sessions where user_id = $1 and revoked_at is null and expires_at > $2 order by last_seen_at desc', [userId, now])).rows;

export const revokeByPublicId = async (db: Db, userId: string, publicId: string, now: Date): Promise<number> =>
  (await db.query('update sessions set revoked_at = $3 where user_id = $1 and public_id = $2 and revoked_at is null', [userId, publicId, now])).rowCount ?? 0;
