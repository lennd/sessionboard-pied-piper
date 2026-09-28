import type pg from 'pg';

export type StageName = 'clone' | 'parse' | 'detect' | 'summarize' | 'link';
export type Stage = { name: StageName; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string };
export type IndexableRepo = { id: string; orgId: string; fullName: string; defaultBranch: string; githubInstallationId: number | null };

export const loadRepo = async (pool: pg.Pool, repoId: string): Promise<IndexableRepo | null> => {
  const row = (
    await pool.query<{ id: string; org_id: string; full_name: string; default_branch: string; gh: string | null }>(
      'select r.id, r.org_id, r.full_name, r.default_branch, gi.installation_id::text as gh from repos r left join github_installations gi on gi.id = r.installation_id where r.id = $1',
      [repoId],
    )
  ).rows[0];
  return row ? { id: row.id, orgId: row.org_id, fullName: row.full_name, defaultBranch: row.default_branch, githubInstallationId: row.gh ? Number(row.gh) : null } : null;
};

export const listLiveRepoIds = async (pool: pg.Pool, orgId: string): Promise<string[]> =>
  (await pool.query<{ id: string }>('select id from repos where org_id = $1', [orgId])).rows.map((r) => r.id);

export const saveProgress = async (
  pool: pg.Pool,
  repoId: string,
  update: { status: 'pending' | 'indexing' | 'ready' | 'error'; stages: Stage[]; languages?: string[]; error?: string | null; lastSyncedAt?: Date },
): Promise<void> => {
  await pool.query(
    `update repos set status = $2, stages = $3, languages = coalesce($4, languages), error = $5, last_synced_at = coalesce($6, last_synced_at) where id = $1`,
    [repoId, update.status, JSON.stringify(update.stages), update.languages ?? null, update.error ?? null, update.lastSyncedAt ?? null],
  );
};
