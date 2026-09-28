import type { Db } from './users';

export type RepoStage = { name: 'clone' | 'parse' | 'detect' | 'summarize' | 'link'; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string };
export type RepoStatus = 'pending' | 'indexing' | 'ready' | 'error';
export type RepoRow = {
  id: string; org_id: string; installation_id: string | null; full_name: string; default_branch: string; languages: string[];
  status: RepoStatus; stages: RepoStage[]; error: string | null; last_synced_at: Date | null; created_at: Date;
};

export const listRepos = async (db: Db, orgId: string): Promise<RepoRow[]> =>
  (await db.query<RepoRow>('select * from repos where org_id = $1 order by full_name', [orgId])).rows;

export const countRepos = async (db: Db, orgId: string): Promise<number> =>
  Number((await db.query<{ count: string }>('select count(*) from repos where org_id = $1', [orgId])).rows[0]?.count ?? 0);

export const upsertRepo = async (
  db: Db,
  input: { orgId: string; fullName: string; defaultBranch: string; languages: string[]; status: RepoStatus; stages: RepoStage[]; error?: string | null; lastSyncedAt?: Date | null },
): Promise<RepoRow> =>
  (
    await db.query<RepoRow>(
      `insert into repos (org_id, full_name, default_branch, languages, status, stages, error, last_synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (org_id, full_name) do update set default_branch = excluded.default_branch, languages = excluded.languages,
         status = excluded.status, stages = excluded.stages, error = excluded.error, last_synced_at = excluded.last_synced_at
       returning *`,
      [input.orgId, input.fullName, input.defaultBranch, input.languages, input.status, JSON.stringify(input.stages), input.error ?? null, input.lastSyncedAt ?? null],
    )
  ).rows[0]!;

export const PENDING_STAGES: RepoStage[] = (['clone', 'parse', 'detect', 'summarize', 'link'] as const).map((name) => ({ name, status: 'pending' }));

export const findRepo = async (db: Db, orgId: string, repoId: string): Promise<RepoRow | null> =>
  (await db.query<RepoRow>('select * from repos where org_id = $1 and id = $2', [orgId, repoId])).rows[0] ?? null;

export const insertPendingRepo = async (db: Db, input: { orgId: string; fullName: string; defaultBranch: string; installationRowId: string | null }): Promise<RepoRow> =>
  (
    await db.query<RepoRow>(
      `insert into repos (org_id, installation_id, full_name, default_branch, status, stages)
       values ($1, $2, $3, $4, 'pending', $5)
       on conflict (org_id, full_name) do update set status = 'pending', stages = excluded.stages, error = null
       returning *`,
      [input.orgId, input.installationRowId, input.fullName, input.defaultBranch, JSON.stringify(PENDING_STAGES)],
    )
  ).rows[0]!;

export const resetRepoStages = async (db: Db, orgId: string, repoId: string): Promise<number> =>
  (await db.query("update repos set status = 'pending', stages = $3, error = null where org_id = $1 and id = $2", [orgId, repoId, JSON.stringify(PENDING_STAGES)])).rowCount ?? 0;

export const deleteRepoRow = async (db: Db, orgId: string, repoId: string): Promise<number> =>
  (await db.query('delete from repos where org_id = $1 and id = $2', [orgId, repoId])).rowCount ?? 0;
