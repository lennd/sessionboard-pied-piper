import type { Db } from './users';

export const DEFAULT_CONVERSATION_TITLE = 'New conversation';
const CONVERSATION_LIST_LIMIT = 50;

export type ConversationRow = { id: string; org_id: string; user_id: string; title: string; created_at: Date; updated_at: Date };
export type StoredMessage = { role: 'user' | 'assistant'; content: unknown; excluded?: boolean };
export type SceneRow = { id: string; org_id: string; conversation_id: string | null; source_scene_id: string | null; turn: number; scene: unknown; created_at: Date };

export const createConversation = async (db: Db, input: { orgId: string; userId: string; title?: string }): Promise<ConversationRow> =>
  (await db.query<ConversationRow>('insert into conversations (org_id, user_id, title) values ($1, $2, $3) returning *', [input.orgId, input.userId, input.title ?? DEFAULT_CONVERSATION_TITLE])).rows[0]!;

export const listConversations = async (db: Db, orgId: string, userId: string): Promise<ConversationRow[]> =>
  (await db.query<ConversationRow>('select * from conversations where org_id = $1 and user_id = $2 order by updated_at desc limit $3', [orgId, userId, CONVERSATION_LIST_LIMIT])).rows;

export const findConversation = async (db: Db, orgId: string, userId: string, id: string): Promise<ConversationRow | null> =>
  (await db.query<ConversationRow>('select * from conversations where org_id = $1 and user_id = $2 and id = $3', [orgId, userId, id])).rows[0] ?? null;

export const renameConversation = async (db: Db, id: string, title: string): Promise<void> => {
  await db.query('update conversations set title = $2, updated_at = now() where id = $1', [id, title]);
};

export const appendMessages = async (db: Db, conversationId: string, messages: StoredMessage[]): Promise<void> => {
  if (messages.length === 0) return;
  await db.query(
    `insert into conversation_messages (conversation_id, role, content, excluded)
     select $1, t.e->>'role', t.e->'content', coalesce((t.e->>'excluded')::boolean, false) from jsonb_array_elements($2::jsonb) with ordinality as t(e, n) order by t.n`,
    [conversationId, JSON.stringify(messages)],
  );
  await db.query('update conversations set updated_at = now() where id = $1', [conversationId]);
};

export const listMessages = async (db: Db, conversationId: string): Promise<StoredMessage[]> =>
  (await db.query<StoredMessage>('select role, content, excluded from conversation_messages where conversation_id = $1 order by id', [conversationId])).rows;

export const insertScene = async (
  db: Db,
  input: { orgId: string; conversationId: string | null; sourceSceneId: string | null; turn: number; scene: unknown },
): Promise<SceneRow> =>
  (
    await db.query<SceneRow>(
      'insert into scenes (org_id, conversation_id, source_scene_id, turn, scene) values ($1, $2, $3, $4, $5) returning *',
      [input.orgId, input.conversationId, input.sourceSceneId, input.turn, JSON.stringify(input.scene)],
    )
  ).rows[0]!;

export const findScene = async (db: Db, orgId: string, userId: string, id: string): Promise<SceneRow | null> =>
  (
    await db.query<SceneRow>(
      `select s.* from scenes s left join conversations c on c.id = s.conversation_id
       where s.org_id = $1 and s.id = $2 and (s.conversation_id is null or c.user_id = $3)`,
      [orgId, id, userId],
    )
  ).rows[0] ?? null;

export const listConversationScenes = async (db: Db, conversationId: string): Promise<SceneRow[]> =>
  (await db.query<SceneRow>('select * from scenes where conversation_id = $1 order by created_at', [conversationId])).rows;

export const currentMonth = (now: Date): string => now.toISOString().slice(0, 7);

export const addUsage = async (db: Db, orgId: string, month: string, input: number, output: number): Promise<void> => {
  await db.query(
    `insert into agent_usage (org_id, month, input_tokens, output_tokens) values ($1, $2, $3, $4)
     on conflict (org_id, month) do update set input_tokens = agent_usage.input_tokens + excluded.input_tokens,
       output_tokens = agent_usage.output_tokens + excluded.output_tokens`,
    [orgId, month, input, output],
  );
};

export const getUsage = async (db: Db, orgId: string, month: string): Promise<{ input: number; output: number }> => {
  const row = (await db.query<{ input_tokens: string; output_tokens: string }>('select input_tokens, output_tokens from agent_usage where org_id = $1 and month = $2', [orgId, month])).rows[0];
  return { input: Number(row?.input_tokens ?? 0), output: Number(row?.output_tokens ?? 0) };
};

export const readSource = async (db: Db, orgId: string, repoFullName: string, path: string): Promise<{ content: string; language: string } | null> =>
  (
    await db.query<{ content: string; language: string }>(
      'select sf.content, sf.language from source_files sf join repos r on r.id = sf.repo_id where r.org_id = $1 and r.full_name = $2 and sf.path = $3',
      [orgId, repoFullName, path],
    )
  ).rows[0] ?? null;

export const findRepoInstallation = async (db: Db, orgId: string, repoFullName: string): Promise<number | null> => {
  const row = (
    await db.query<{ installation_id: string }>(
      'select gi.installation_id::text from repos r join github_installations gi on gi.id = r.installation_id where r.org_id = $1 and r.full_name = $2',
      [orgId, repoFullName],
    )
  ).rows[0];
  return row ? Number(row.installation_id) : null;
};
