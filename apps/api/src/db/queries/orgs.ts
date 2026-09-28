import type pg from 'pg';
import type { Role } from '../../domain/roles';
import type { Db } from './users';

export type OrgRow = { id: string; name: string; slug: string; default_ui_language: string; default_explanation_language: string; default_theme: string; created_at: Date };
export type OrgWithRole = OrgRow & { role: Role };
export type OrgPatch = Partial<Pick<OrgRow, 'name' | 'default_ui_language' | 'default_explanation_language' | 'default_theme'>>;
export type MemberRow = { user_id: string; email: string; name: string; role: Role; created_at: Date };

const MAX_SLUG = 40;
const PATCHABLE = ['name', 'default_ui_language', 'default_explanation_language', 'default_theme'] as const;

export const slugify = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SLUG) || 'org';

export const createOrg = async (pool: pg.Pool, input: { name: string; ownerId: string }): Promise<OrgRow> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const base = slugify(input.name);
    let slug = base;
    for (let suffix = 2; ((await client.query('select 1 from orgs where slug = $1', [slug])).rowCount ?? 0) > 0; suffix++) slug = `${base}-${suffix}`;
    const org = (await client.query<OrgRow>('insert into orgs (name, slug) values ($1, $2) returning *', [input.name, slug])).rows[0]!;
    await client.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')", [org.id, input.ownerId]);
    await client.query('commit');
    return org;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

export const listOrgsForUser = async (db: Db, userId: string): Promise<OrgWithRole[]> =>
  (await db.query<OrgWithRole>('select o.*, m.role from orgs o join memberships m on m.org_id = o.id where m.user_id = $1 order by o.created_at, o.name', [userId])).rows;

export const findMembership = async (db: Db, orgId: string, userId: string): Promise<{ org: OrgRow; role: Role } | null> => {
  const row = (await db.query<OrgWithRole>('select o.*, m.role from orgs o join memberships m on m.org_id = o.id where o.id = $1 and m.user_id = $2', [orgId, userId])).rows[0];
  if (!row) return null;
  const { role, ...org } = row;
  return { org, role };
};

export const updateOrg = async (db: Db, orgId: string, patch: OrgPatch): Promise<OrgRow | null> => {
  const entries = PATCHABLE.filter((column) => column in patch).map((column) => [column, patch[column]] as const);
  if (entries.length === 0) return (await db.query<OrgRow>('select * from orgs where id = $1', [orgId])).rows[0] ?? null;
  const sets = entries.map(([column], i) => `${column} = $${i + 2}`).join(', ');
  return (await db.query<OrgRow>(`update orgs set ${sets} where id = $1 returning *`, [orgId, ...entries.map(([, value]) => value)])).rows[0] ?? null;
};

const MEMBER_SELECT = 'select m.user_id, u.email, u.name, m.role, m.created_at from memberships m join users u on u.id = m.user_id';

export const listMembers = async (db: Db, orgId: string): Promise<MemberRow[]> =>
  (await db.query<MemberRow>(`${MEMBER_SELECT} where m.org_id = $1 order by m.created_at, u.email`, [orgId])).rows;

export const findMemberByEmail = async (db: Db, orgId: string, email: string): Promise<MemberRow | null> =>
  (await db.query<MemberRow>(`${MEMBER_SELECT} where m.org_id = $1 and u.email = $2`, [orgId, email])).rows[0] ?? null;

export const getMemberRole = async (db: Db, orgId: string, userId: string): Promise<Role | null> =>
  (await db.query<{ role: Role }>('select role from memberships where org_id = $1 and user_id = $2', [orgId, userId])).rows[0]?.role ?? null;

export const countOwners = async (db: Db, orgId: string): Promise<number> =>
  Number((await db.query<{ count: string }>("select count(*) from memberships where org_id = $1 and role = 'owner'", [orgId])).rows[0]?.count ?? 0);

export const setRole = async (db: Db, orgId: string, userId: string, role: Role): Promise<number> =>
  (await db.query('update memberships set role = $3 where org_id = $1 and user_id = $2', [orgId, userId, role])).rowCount ?? 0;

export const removeMember = async (db: Db, orgId: string, userId: string): Promise<number> =>
  (await db.query('delete from memberships where org_id = $1 and user_id = $2', [orgId, userId])).rowCount ?? 0;

export const addMember = async (db: Db, orgId: string, userId: string, role: Role): Promise<void> => {
  await db.query('insert into memberships (org_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [orgId, userId, role]);
};
