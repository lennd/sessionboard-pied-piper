import { hashToken, randomToken } from '../../auth/tokens';
import type { Db } from './users';

export type EmailTokenKind = 'verify' | 'reset';
const MINUTE_MS = 60_000;

export const issueEmailToken = async (db: Db, userId: string, kind: EmailTokenKind, ttlMinutes: number, now: Date): Promise<string> => {
  const token = randomToken();
  await db.query('insert into email_tokens (user_id, kind, token_hash, expires_at) values ($1, $2, $3, $4)', [userId, kind, hashToken(token), new Date(now.getTime() + ttlMinutes * MINUTE_MS)]);
  return token;
};

export const consumeEmailToken = async (db: Db, token: string, kind: EmailTokenKind, now: Date): Promise<string | null> =>
  (
    await db.query<{ user_id: string }>(
      'update email_tokens set used_at = $3 where token_hash = $1 and kind = $2 and used_at is null and expires_at > $3 returning user_id',
      [hashToken(token), kind, now],
    )
  ).rows[0]?.user_id ?? null;
