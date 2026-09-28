import type pg from 'pg';

export type Db = Pick<pg.Pool, 'query'>;

export type UserRow = {
  id: string; email: string; name: string; password_hash: string; email_verified_at: Date | null;
  ui_language: string | null; explanation_language: string | null; theme: string | null; initial_level: string | null; created_at: Date;
};

export type UserPatch = Partial<Pick<UserRow, 'name' | 'ui_language' | 'explanation_language' | 'theme' | 'initial_level'>>;

const PATCHABLE = ['name', 'ui_language', 'explanation_language', 'theme', 'initial_level'] as const;

export const findUserByEmail = async (db: Db, email: string): Promise<UserRow | null> =>
  (await db.query<UserRow>('select * from users where email = $1', [email])).rows[0] ?? null;

export const findUserById = async (db: Db, id: string): Promise<UserRow | null> =>
  (await db.query<UserRow>('select * from users where id = $1', [id])).rows[0] ?? null;

export const insertUser = async (db: Db, input: { email: string; name: string; passwordHash: string }): Promise<UserRow> =>
  (await db.query<UserRow>('insert into users (email, name, password_hash) values ($1, $2, $3) returning *', [input.email, input.name, input.passwordHash])).rows[0]!;

export const markVerified = async (db: Db, id: string, now: Date): Promise<void> => {
  await db.query('update users set email_verified_at = coalesce(email_verified_at, $2) where id = $1', [id, now]);
};

export const updatePassword = async (db: Db, id: string, passwordHash: string): Promise<void> => {
  await db.query('update users set password_hash = $2 where id = $1', [id, passwordHash]);
};

export const updateUser = async (db: Db, id: string, patch: UserPatch): Promise<UserRow | null> => {
  const entries = PATCHABLE.filter((column) => column in patch).map((column) => [column, patch[column]] as const);
  if (entries.length === 0) return findUserById(db, id);
  const sets = entries.map(([column], i) => `${column} = $${i + 2}`).join(', ');
  return (await db.query<UserRow>(`update users set ${sets} where id = $1 returning *`, [id, ...entries.map(([, value]) => value)])).rows[0] ?? null;
};
