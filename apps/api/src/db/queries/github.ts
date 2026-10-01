import type { Db } from './users';

export type InstallationRow = { id: string; org_id: string; installation_id: string; account_login: string };

export const bindInstallation = async (db: Db, input: { orgId: string; installationId: number; accountLogin: string }): Promise<InstallationRow | null> =>
  (
    await db.query<InstallationRow>(
      `insert into github_installations (org_id, installation_id, account_login) values ($1, $2, $3)
       on conflict (installation_id) do update set account_login = excluded.account_login
       where github_installations.org_id = excluded.org_id
       returning id, org_id, installation_id::text, account_login`,
      [input.orgId, input.installationId, input.accountLogin],
    )
  ).rows[0] ?? null;

export const findInstallationForOrg = async (db: Db, orgId: string): Promise<InstallationRow | null> =>
  (await db.query<InstallationRow>('select id, org_id, installation_id::text, account_login from github_installations where org_id = $1 order by created_at desc limit 1', [orgId])).rows[0] ?? null;

export const listInstallationsForOrg = async (db: Db, orgId: string): Promise<InstallationRow[]> =>
  (await db.query<InstallationRow>('select id, org_id, installation_id::text, account_login from github_installations where org_id = $1 order by created_at, id', [orgId])).rows;

export const findReposForInstallationAndName = async (db: Db, installationId: number, fullName: string): Promise<{ id: string; org_id: string; default_branch: string }[]> =>
  (
    await db.query<{ id: string; org_id: string; default_branch: string }>(
      'select r.id, r.org_id, r.default_branch from repos r join github_installations gi on gi.id = r.installation_id where gi.installation_id = $1 and r.full_name = $2',
      [installationId, fullName],
    )
  ).rows;
