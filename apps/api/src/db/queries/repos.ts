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
