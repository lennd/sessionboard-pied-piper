import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './users';

export const TOKEN_PREFIX = 'rdi_';
export const MAX_TOKENS_PER_USER = 10;
const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 10;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const createApiToken = async (db: Db, input: { orgId: string; userId: string; name: string }) => {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  const prefix = token.slice(0, DISPLAY_PREFIX_LENGTH);
  const row = (
    await db.query<{ id: string; name: string; created_at: Date }>(
      'insert into api_tokens (org_id, user_id, name, prefix, token_hash) values ($1, $2, $3, $4, $5) returning id, name, created_at',
      [input.orgId, input.userId, input.name, prefix, hashToken(token)],
    )
  ).rows[0]!;
  return { ...row, token, prefix };
};

export const listApiTokens = async (db: Db, orgId: string, userId: string) =>
  (
    await db.query<{ id: string; name: string; prefix: string; last_used_at: Date | null; created_at: Date }>(
      'select id, name, prefix, last_used_at, created_at from api_tokens where org_id = $1 and user_id = $2 and revoked_at is null order by created_at desc',
      [orgId, userId],
    )
  ).rows;

export const countApiTokens = async (db: Db, orgId: string, userId: string): Promise<number> =>
  Number((await db.query<{ n: string }>('select count(*) as n from api_tokens where org_id = $1 and user_id = $2 and revoked_at is null', [orgId, userId])).rows[0]?.n ?? 0);

export const revokeApiToken = async (db: Db, orgId: string, userId: string, id: string): Promise<number> =>
  (await db.query('update api_tokens set revoked_at = now() where org_id = $1 and user_id = $2 and id = $3 and revoked_at is null', [orgId, userId, id])).rowCount ?? 0;

export const resolveApiToken = async (db: Db, token: string, now: Date): Promise<{ tokenId: string; orgId: string; userId: string } | null> => {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = (
    await db.query<{ id: string; org_id: string; user_id: string }>(
      `update api_tokens t set last_used_at = $2
       from memberships m where t.token_hash = $1 and t.revoked_at is null and m.org_id = t.org_id and m.user_id = t.user_id
       returning t.id, t.org_id, t.user_id`,
      [hashToken(token), now],
    )
  ).rows[0];
  return row ? { tokenId: row.id, orgId: row.org_id, userId: row.user_id } : null;
};
