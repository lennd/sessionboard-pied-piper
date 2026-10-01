import type { SolutionDraft, SolutionStatus, TaskStatus } from '@rdi/scene';
import type pg from 'pg';
import type { Db } from './users';

export type Author = 'web' | 'claude-code';
export type SolutionRow = { id: string; org_id: string; created_by: string | null; conversation_id: string | null; title: string; status: SolutionStatus; created_at: Date; updated_at: Date };
export type VersionRow = { solution_id: string; n: number; author: Author; draft: SolutionDraft; created_at: Date };
export type TaskStatusRow = { task_id: string; status: TaskStatus; note: string | null; updated_at: Date };

const insertVersion = async (db: Db, solutionId: string, author: Author, draft: SolutionDraft): Promise<VersionRow> =>
  (
    await db.query<VersionRow>(
      `insert into solution_versions (solution_id, n, author, draft)
       values ($1, coalesce((select max(n) from solution_versions where solution_id = $1), 0) + 1, $2, $3) returning *`,
      [solutionId, author, JSON.stringify(draft)],
    )
  ).rows[0]!;

const inTransaction = async <T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

export const createSolution = (
  pool: pg.Pool,
  input: { orgId: string; userId: string | null; title: string; conversationId: string | null; draft: SolutionDraft; author: Author },
): Promise<{ solution: SolutionRow; version: VersionRow }> =>
  inTransaction(pool, async (client) => {
    const solution = (await client.query<SolutionRow>('insert into solutions (org_id, created_by, conversation_id, title) values ($1, $2, $3, $4) returning *', [input.orgId, input.userId, input.conversationId, input.title])).rows[0]!;
    return { solution, version: await insertVersion(client, solution.id, input.author, input.draft) };
  });

export const addVersion = (pool: pg.Pool, solutionId: string, author: Author, draft: SolutionDraft): Promise<VersionRow> =>
  inTransaction(pool, async (client) => {
    await client.query('select id from solutions where id = $1 for update', [solutionId]);
    const version = await insertVersion(client, solutionId, author, draft);
    await client.query('update solutions set updated_at = now() where id = $1', [solutionId]);
    return version;
  });

export const listSolutions = async (db: Db, orgId: string) =>
  (
    await db.query<SolutionRow & { latest_n: number; tasks_total: number; tasks_done: number }>(
      `select s.*, v.n as latest_n, jsonb_array_length(v.draft->'plan') as tasks_total,
         (select count(*)::int from solution_task_status t where t.solution_id = s.id and t.status = 'done'
            and t.task_id in (select p->>'id' from jsonb_array_elements(v.draft->'plan') p)) as tasks_done
       from solutions s
       join lateral (select n, draft from solution_versions where solution_id = s.id order by n desc limit 1) v on true
       where s.org_id = $1 order by s.updated_at desc`,
      [orgId],
    )
  ).rows;

export const findSolution = async (db: Db, orgId: string, id: string): Promise<SolutionRow | null> =>
  (await db.query<SolutionRow>('select * from solutions where org_id = $1 and id = $2', [orgId, id])).rows[0] ?? null;

export const listVersions = async (db: Db, solutionId: string) =>
  (await db.query<{ n: number; author: Author; summary: string; created_at: Date }>("select n, author, draft->>'summary' as summary, created_at from solution_versions where solution_id = $1 order by n", [solutionId])).rows;

export const getVersion = async (db: Db, solutionId: string, n?: number): Promise<VersionRow | null> =>
  (
    await db.query<VersionRow>(
      n === undefined ? 'select * from solution_versions where solution_id = $1 order by n desc limit 1' : 'select * from solution_versions where solution_id = $1 and n = $2',
      n === undefined ? [solutionId] : [solutionId, n],
    )
  ).rows[0] ?? null;

export const updateSolution = async (db: Db, id: string, patch: { title?: string; status?: SolutionStatus }): Promise<void> => {
  await db.query('update solutions set title = coalesce($2, title), status = coalesce($3, status), updated_at = now() where id = $1', [id, patch.title ?? null, patch.status ?? null]);
};

export const setTaskStatus = async (db: Db, solutionId: string, taskId: string, status: TaskStatus, note: string | null): Promise<void> => {
  await db.query(
    `insert into solution_task_status (solution_id, task_id, status, note) values ($1, $2, $3, $4)
     on conflict (solution_id, task_id) do update set status = excluded.status, note = excluded.note, updated_at = now()`,
    [solutionId, taskId, status, note],
  );
  await db.query('update solutions set updated_at = now() where id = $1', [solutionId]);
};

export const listTaskStatuses = async (db: Db, solutionId: string): Promise<TaskStatusRow[]> =>
  (await db.query<TaskStatusRow>('select task_id, status, note, updated_at from solution_task_status where solution_id = $1 order by task_id', [solutionId])).rows;
