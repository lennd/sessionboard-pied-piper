# Plan 4 — Agent and Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user ask questions in a chat docked in the workspace. An agent (Claude, via the Anthropic TypeScript SDK) explores the org's System Graph and indexed source with tools, streams its answer over SSE and emits validated Scene v2 documents that the canvas animates immediately. Scenes can be regenerated in another language, and code opens on demand from the real indexed source.

**Architecture:** `apps/api/src/agent/` holds a provider-neutral `LlmClient` interface (Anthropic implementation + a deterministic scripted fake for dev/E2E), the tool set (graph search, neighbours, paths, code reading, PR diffs, `emit_scene`), the system prompt and a manual streaming agent loop. Conversations, messages (full content blocks, append-only), scenes and monthly token usage live in Postgres. The worker now stores indexed source files so `read_code` and the code drawer work after the clone is gone. The web adds a streaming chat client, a `ChatPanel` in the workspace sidebar, on-demand code loading and agent usage.

**Tech Stack:** `@anthropic-ai/sdk` 0.129 (beta Messages stream, adaptive thinking, server-side fallbacks `"default"`, eager input streaming, top-level prompt caching), Zod 4 (`z.toJSONSchema`), Fastify raw SSE, `fetch` + `ReadableStream` on the web.

**Spec:** `docs/superpowers/specs/2026-09-28-repository-designer-ide-design.md` §4 (agent, tools, chat, limits) and §2 (scene validation: invalid scene → errors back to the agent, 2 retries, then text-only). Solutions (`upsert_solution`) and the MCP server are plan 5.

## Global Constraints

- Model is configurable with `AGENT_MODEL`, default **`claude-opus-5`** (claude-api skill default). Every request uses `thinking: { type: "adaptive" }`, `output_config: { effort: "high" }`, streaming, top-level `cache_control: { type: "ephemeral" }`, `eager_input_streaming: true` on every tool, and — for `claude-opus-5`, `claude-opus-5-5`, `claude-fable-5-1` — `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`.
- The agent is enabled when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set, or `AGENT_ENABLED=true` (for `ant auth login` profiles). `RDI_FAKE_LLM=true` swaps in the scripted fake and is **never** honoured in production.
- Conversation history is append-only: assistant content blocks are stored and replayed unchanged (thinking blocks included); a turn is persisted only as complete `assistant(tool_use)` + `user(tool_result)` pairs.
- Tool inputs are validated with Zod before running (eager input streaming disables server-side validation). `stop_reason` `refusal` and `max_tokens` never run tools.
- Every graph/code access is scoped to the conversation's org. Conversations are private to their author (other users, even in the same org, get 404).
- Limits: 20 agent requests per user per minute; monthly token budget per org `AGENT_MONTHLY_TOKEN_BUDGET` (default 2,000,000; input incl. cache tokens + output); at most 10 model iterations per turn; `read_code` returns at most 400 lines.
- UI strings through `t()` (en/es/pt). Code/commit comments in English. Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Another user's or org's conversation, scene or source** is never readable, writable or translatable (404). Pinned in Tasks 3, 8 and 9.
2. **A model that keeps emitting invalid scenes** gets the validation errors back, is told to stop after the third failure, and no invalid scene is ever stored or sent to the canvas. Pinned in Task 7.
3. **A client that disconnects mid-answer** aborts the model request, and the stored history never contains a `tool_use` without its `tool_result`. Pinned in Tasks 7 and 8.
4. **Agent not configured or budget exhausted** returns a clear error code and the chat shows a notice instead of failing silently. Pinned in Tasks 8 and 11.
5. **A translated scene that changes structure** (ids, edges, steps) is rejected and retried; the original is never overwritten. Pinned in Task 9.

---

## File Structure

```
apps/api/src/db/migrations/002_agent.sql
apps/api/src/db/queries/agent.ts
apps/api/src/agent/{llm,anthropicLlm,fakeLlm,tools,prompt,runAgent,translate}.ts
apps/api/src/routes/{code,agent}.ts
apps/api/src/{config,app,server}.ts, http/deps.ts (+ llm)
apps/api/test/{agentQueries,code,agentRoutes}.integration.test.ts
apps/api/test/agent/{tools,anthropicLlm,prompt,runAgent,translate,fakeLlm}.test.ts, test/agent/orgGraph.ts
apps/worker/src/{repoStore,pipeline}.ts (+ source files)
packages/indexer/src/{repoGraph,systemMap}.ts (+ endpoint file/line, code refs, graphRef)
packages/providers/src/github.ts (+ listPullFiles)
apps/web/src/shell/api.ts (+ getCsrfToken)
apps/web/src/shell/chat/{chatApi,ChatPanel}.tsx
apps/web/src/workspace/{Workspace.tsx, panels/ExplorerPanel.tsx, panels/CodeDrawer.tsx, workspace.css}
apps/web/src/shell/pages/ExplorePage.tsx, shell/settings/UsagePage.tsx, i18n/shellMessages.ts
apps/web/test/shell/{chatApi,chatPanel,usage}.test.tsx, test/workspace/{chatSidebar,codeDrawer}.test.tsx
apps/web/e2e/chat.spec.ts, apps/web/playwright.config.ts
```

---

### Task 1: Agent tables and queries

**Files:**
- Create: `apps/api/src/db/migrations/002_agent.sql`, `apps/api/src/db/queries/agent.ts`
- Test: `apps/api/test/agentQueries.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  DEFAULT_CONVERSATION_TITLE = 'New conversation'
  type ConversationRow = { id: string; org_id: string; user_id: string; title: string; created_at: Date; updated_at: Date }
  type StoredMessage = { role: 'user' | 'assistant'; content: unknown }
  type SceneRow = { id: string; org_id: string; conversation_id: string | null; source_scene_id: string | null; turn: number; scene: unknown; created_at: Date }
  createConversation(db, { orgId, userId, title? }): Promise<ConversationRow>
  listConversations(db, orgId, userId): Promise<ConversationRow[]>            // newest first, max 50
  findConversation(db, orgId, userId, id): Promise<ConversationRow | null>
  renameConversation(db, id, title): Promise<void>                              // also bumps updated_at
  appendMessages(db, conversationId, messages: StoredMessage[]): Promise<void>  // bumps updated_at
  listMessages(db, conversationId): Promise<StoredMessage[]>
  insertScene(db, { orgId, conversationId, sourceSceneId, turn, scene }): Promise<SceneRow>
  findScene(db, orgId, id): Promise<SceneRow | null>
  listConversationScenes(db, conversationId): Promise<SceneRow[]>
  currentMonth(now: Date): string                                               // "2026-09"
  addUsage(db, orgId, month, input, output): Promise<void>
  getUsage(db, orgId, month): Promise<{ input: number; output: number }>
  readSource(db, orgId, repoFullName, path): Promise<{ content: string; language: string } | null>
  findRepoInstallation(db, orgId, repoFullName): Promise<number | null>
  ```

- [ ] **Step 1: Write the failing test**

`apps/api/test/agentQueries.integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addUsage, appendMessages, createConversation, currentMonth, DEFAULT_CONVERSATION_TITLE, findConversation, findRepoInstallation, findScene,
  getUsage, insertScene, listConversations, listConversationScenes, listMessages, readSource, renameConversation,
} from '../src/db/queries/agent';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};

describe('agent queries', () => {
  it('stores conversations privately per user with append-only messages', async () => {
    const { owner, org } = await setup();
    const conv = await createConversation(ctx.pool, { orgId: org.id, userId: owner.userId });
    expect(conv.title).toBe(DEFAULT_CONVERSATION_TITLE);
    await appendMessages(ctx.pool, conv.id, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }, { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }]);
    await appendMessages(ctx.pool, conv.id, [{ role: 'user', content: [{ type: 'text', text: 'more' }] }]);
    expect((await listMessages(ctx.pool, conv.id)).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    await renameConversation(ctx.pool, conv.id, 'Orders flow');
    expect((await listConversations(ctx.pool, org.id, owner.userId)).map((c) => c.title)).toEqual(['Orders flow']);
    const other = await signupVerified(ctx);
    expect(await findConversation(ctx.pool, org.id, other.userId, conv.id)).toBeNull();
    expect(await listConversations(ctx.pool, org.id, other.userId)).toEqual([]);
  });

  it('stores scenes per org and conversation turn', async () => {
    const { owner, org } = await setup();
    const conv = await createConversation(ctx.pool, { orgId: org.id, userId: owner.userId });
    const row = await insertScene(ctx.pool, { orgId: org.id, conversationId: conv.id, sourceSceneId: null, turn: 1, scene: { id: 's' } });
    expect(await findScene(ctx.pool, org.id, row.id)).toMatchObject({ turn: 1, scene: { id: 's' } });
    expect((await listConversationScenes(ctx.pool, conv.id)).map((s) => s.id)).toEqual([row.id]);
    const other = await setup();
    expect(await findScene(ctx.pool, other.org.id, row.id)).toBeNull();
  });

  it('accumulates monthly token usage', async () => {
    const { org } = await setup();
    const month = currentMonth(new Date('2026-09-28T10:00:00Z'));
    expect(month).toBe('2026-09');
    await addUsage(ctx.pool, org.id, month, 100, 20);
    await addUsage(ctx.pool, org.id, month, 50, 5);
    expect(await getUsage(ctx.pool, org.id, month)).toEqual({ input: 150, output: 25 });
    expect(await getUsage(ctx.pool, org.id, '2026-10')).toEqual({ input: 0, output: 0 });
  });

  it('reads indexed source and installations only within the org', async () => {
    const { org } = await setup();
    const repo = (await ctx.pool.query<{ id: string }>("insert into repos (org_id, full_name) values ($1, 'acme/api') returning id", [org.id])).rows[0]!.id;
    await ctx.pool.query("insert into source_files (repo_id, path, language, content) values ($1, 'src/a.ts', 'typescript', 'export const a = 1;')", [repo]);
    expect(await readSource(ctx.pool, org.id, 'acme/api', 'src/a.ts')).toEqual({ content: 'export const a = 1;', language: 'typescript' });
    const other = await setup();
    expect(await readSource(ctx.pool, other.org.id, 'acme/api', 'src/a.ts')).toBeNull();
    expect(await findRepoInstallation(ctx.pool, org.id, 'acme/api')).toBeNull();
    const inst = (await ctx.pool.query<{ id: string }>("insert into github_installations (org_id, installation_id, account_login) values ($1, 777, 'acme') returning id", [org.id])).rows[0]!.id;
    await ctx.pool.query('update repos set installation_id = $1 where id = $2', [inst, repo]);
    expect(await findRepoInstallation(ctx.pool, org.id, 'acme/api')).toBe(777);
  });
});
```

Run: `npm run test:integration -w @rdi/api -- agentQueries`
Expected: FAIL — `../src/db/queries/agent` not found.

- [ ] **Step 2: Implement**

`apps/api/src/db/migrations/002_agent.sql`:
```sql
create table source_files (
  repo_id uuid not null references repos (id) on delete cascade,
  path text not null,
  language text not null,
  content text not null,
  primary key (repo_id, path)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_org_user on conversations (org_id, user_id, updated_at desc);

create table conversation_messages (
  id bigserial primary key,
  conversation_id uuid not null references conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index conversation_messages_conversation on conversation_messages (conversation_id, id);

create table scenes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete cascade,
  source_scene_id uuid references scenes (id) on delete set null,
  turn integer not null default 0,
  scene jsonb not null,
  created_at timestamptz not null default now()
);
create index scenes_conversation on scenes (conversation_id, created_at);

create table agent_usage (
  org_id uuid not null references orgs (id) on delete cascade,
  month text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (org_id, month)
);
```

`apps/api/src/db/queries/agent.ts`:
```ts
import type { Db } from './users';

export const DEFAULT_CONVERSATION_TITLE = 'New conversation';
const CONVERSATION_LIST_LIMIT = 50;

export type ConversationRow = { id: string; org_id: string; user_id: string; title: string; created_at: Date; updated_at: Date };
export type StoredMessage = { role: 'user' | 'assistant'; content: unknown };
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
    `insert into conversation_messages (conversation_id, role, content)
     select $1, m.role, m.content from jsonb_to_recordset($2::jsonb) with ordinality as m(role text, content jsonb, n int) order by n`,
    [conversationId, JSON.stringify(messages)],
  );
  await db.query('update conversations set updated_at = now() where id = $1', [conversationId]);
};

export const listMessages = async (db: Db, conversationId: string): Promise<StoredMessage[]> =>
  (await db.query<StoredMessage>('select role, content from conversation_messages where conversation_id = $1 order by id', [conversationId])).rows;

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

export const findScene = async (db: Db, orgId: string, id: string): Promise<SceneRow | null> =>
  (await db.query<SceneRow>('select * from scenes where org_id = $1 and id = $2', [orgId, id])).rows[0] ?? null;

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
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add conversations, scenes, usage and source file storage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Indexed source, endpoint locations and code references in the system map

**Files:**
- Modify: `apps/worker/src/repoStore.ts`, `apps/worker/src/pipeline.ts`, `packages/indexer/src/repoGraph.ts`, `packages/indexer/src/systemMap.ts`
- Test: `apps/worker/test/pipeline.integration.test.ts`, `packages/indexer/test/repoGraph.test.ts`, `packages/indexer/test/systemMap.test.ts`

**Interfaces:**
- Produces: `replaceSourceFiles(pool, repoId, files: { path; language; content }[]): Promise<void>` (worker); Endpoint node props gain `file: string`, `line: number`; system-map nodes carry `graphRef` (graph node id) and endpoints carry `code: { repo, path, startLine, endLine, language }` (no snippet — loaded on demand).

- [ ] **Step 1: Write the failing tests**

Append inside `describe('buildRepoGraph', …)` of `packages/indexer/test/repoGraph.test.ts`:
```ts
  it('records where each endpoint is declared', async () => {
    const g = await graphFor('shop-api');
    expect(g.nodes.find((n) => n.id === 'ep:shop-api:POST /api/orders')!.props).toMatchObject({ method: 'POST', path: '/api/orders', file: 'src/server.ts', line: 6 });
  });
```

Append inside `describe('buildSystemMap', …)` of `packages/indexer/test/systemMap.test.ts`:
```ts
  it('links pieces back to the graph and endpoints to their source', async () => {
    const scene = buildSystemMap(await orgGraph())!;
    const ep = scene.nodes.find((n) => n.label === 'POST /api/orders')!;
    expect(ep.graphRef).toBe('ep:shop-api:POST /api/orders');
    expect(ep.code).toEqual({ repo: 'acme-demo/shop-api', path: 'src/server.ts', startLine: 4, endLine: 18, language: 'typescript' });
    expect(scene.nodes.find((n) => n.label === 'shop-api')!.graphRef).toBe('svc:shop-api');
  });
```

Append inside `describe('runIndexJob', …)` of `apps/worker/test/pipeline.integration.test.ts` (after the first test, which leaves the three demo repos indexed):
```ts
  it('stores the indexed source files of each repository', async () => {
    const api = (await pool.query<{ id: string }>("select id from repos where org_id = $1 and full_name = 'acme-demo/shop-api'", [orgId])).rows[0]!.id;
    const files = (await pool.query<{ path: string; language: string; content: string }>('select path, language, content from source_files where repo_id = $1 order by path', [api])).rows;
    expect(files.map((f) => f.path)).toEqual(['src/db.ts', 'src/orders.ts', 'src/server.ts']);
    expect(files[2]).toMatchObject({ language: 'typescript' });
    expect(files[2]!.content).toContain("app.post('/api/orders'");
  });
```

Run: `npm test -w @rdi/indexer; npm run test:integration -w @rdi/worker`
Expected: FAIL — endpoint props lack `file`/`line`, scene nodes lack `graphRef`/`code`, `source_files` is empty.

- [ ] **Step 2: Implement**

In `packages/indexer/src/repoGraph.ts`, change the endpoint node props from `{ method: ep.method, path: ep.path }` to:
```ts
props: { method: ep.method, path: ep.path, file: ep.file, line: ep.line }
```

In `packages/indexer/src/systemMap.ts`:
- add constants `const CODE_CONTEXT_BEFORE = 2;` and `const CODE_CONTEXT_AFTER = 12;`
- give `include` an optional `code` argument and set `graphRef` on every node:
```ts
  const include = (node: GraphNode, role: 'compute' | 'channel' | 'storage' | 'external', kind: string, parent?: string, code?: SceneInput['nodes'][number]['code']) => {
    included.add(node.id);
    nodes.push({
      id: sceneId(node.id), label: clip(node.name), role, kind, summary: clip(node.summary || node.name, MAX_SUMMARY), graphRef: node.id,
      ...(parent ? { parent: sceneId(parent) } : {}),
      ...(node.label === 'Service' && typeof node.props.repo === 'string' ? { repo: clip(node.props.repo) } : {}),
      ...(code ? { code } : {}),
    });
  };
```
- add, before the endpoint loop, a helper that builds the code reference from the endpoint's `file`/`line` props, the service's `repo` prop and the file node's `language` prop:
```ts
  const endpointCode = (ep: GraphNode, svc: GraphNode): SceneInput['nodes'][number]['code'] => {
    const file = typeof ep.props.file === 'string' ? ep.props.file : null;
    const line = typeof ep.props.line === 'number' ? ep.props.line : null;
    const repo = typeof svc.props.repo === 'string' ? svc.props.repo : null;
    if (!file || !line || !repo || !ep.repoId) return undefined;
    const language = byId.get(`file:${ep.repoId}:${file}`)?.props.language;
    return { repo: clip(repo), path: file, startLine: Math.max(1, line - CODE_CONTEXT_BEFORE), endLine: line + CODE_CONTEXT_AFTER, language: typeof language === 'string' ? language : 'text' };
  };
```
- in the endpoint loop use `include(ep, 'compute', 'HTTP endpoint', svc.id, endpointCode(ep, svc))`.

In `apps/worker/src/repoStore.ts` append:
```ts
const SOURCE_BATCH = 200;

export const replaceSourceFiles = async (pool: pg.Pool, repoId: string, files: { path: string; language: string; content: string }[]): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from source_files where repo_id = $1', [repoId]);
    for (let i = 0; i < files.length; i += SOURCE_BATCH) {
      const batch = files.slice(i, i + SOURCE_BATCH);
      await client.query(
        'insert into source_files (repo_id, path, language, content) select $1, * from unnest($2::text[], $3::text[], $4::text[])',
        [repoId, batch.map((f) => f.path), batch.map((f) => f.language), batch.map((f) => f.content)],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};
```

In `apps/worker/src/pipeline.ts` import `replaceSourceFiles` and make the link stage store sources before committing the graph:
```ts
    await stage('link', async () => {
      await replaceSourceFiles(deps.pool, repo.id, walk.files);
      return deps.graph.commitRepoGraph(repo.orgId, repo.id, graph, await listLiveRepoIds(deps.pool, repo.orgId));
    }, (links) => `${links} cross-repo links`);
```
(A repo deleted before the insert makes it fail on the foreign key, which ends the job before any graph write; one deleted after it cascades its sources away.)

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/indexer && npm run test:integration -w @rdi/worker && npm run typecheck -w @rdi/indexer && npm run typecheck -w @rdi/worker`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(indexer,worker): store indexed source and link system map pieces to graph and code

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Code on demand API

**Files:**
- Create: `apps/api/src/routes/code.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/code.integration.test.ts`

**Interfaces:**
- Produces: `MAX_CODE_LINES = 400`; `sliceLines(content, start, end): { startLine; endLine; snippet }`; `GET /api/orgs/:orgId/code?repo=&path=&start=&end=` → `{ repo, path, language, startLine, endLine, snippet }` · 404 `not_found`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/code.integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sliceLines } from '../src/routes/code';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const CONTENT = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n');

const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  const repo = (await ctx.pool.query<{ id: string }>("insert into repos (org_id, full_name) values ($1, 'acme/api') returning id", [org.id])).rows[0]!.id;
  await ctx.pool.query("insert into source_files (repo_id, path, language, content) values ($1, 'src/big.ts', 'typescript', $2)", [repo, CONTENT]);
  return { owner, org };
};
const get = (who: { cookie: string }, orgId: string, query: string) => ctx.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/code?${query}`, headers: { cookie: who.cookie } });

describe('sliceLines', () => {
  it('clamps the range to the file and to the maximum window', () => {
    expect(sliceLines('a\nb\nc', 2, 9)).toEqual({ startLine: 2, endLine: 3, snippet: 'b\nc' });
    expect(sliceLines('a\nb\nc', 0, 1)).toEqual({ startLine: 1, endLine: 1, snippet: 'a' });
    expect(sliceLines(CONTENT, 10, 5000).endLine).toBe(409);
    expect(sliceLines(CONTENT, 5000, 6000)).toEqual({ startLine: 1000, endLine: 1000, snippet: 'line 1000' });
  });
});

describe('GET /code', () => {
  it('returns a slice of an indexed file', async () => {
    const { owner, org } = await setup();
    const res = await get(owner, org.id, 'repo=acme/api&path=src/big.ts&start=3&end=5');
    expect(res.json()).toEqual({ repo: 'acme/api', path: 'src/big.ts', language: 'typescript', startLine: 3, endLine: 5, snippet: 'line 3\nline 4\nline 5' });
  });

  it('never exposes another organization or a missing file', async () => {
    const { org } = await setup();
    const other = await setup();
    expect((await get(other.owner, org.id, 'repo=acme/api&path=src/big.ts')).statusCode).toBe(404);
    expect((await get(other.owner, other.org.id, 'repo=acme/api&path=src/none.ts')).json()).toEqual({ error: { code: 'not_found' } });
  });
});
```
Note the second test: `other` has its own `acme/api` repo; the request for `org.id` fails membership (404) and the missing path fails lookup (404).

Run: `npm run test:integration -w @rdi/api -- code`
Expected: FAIL — `../src/routes/code` not found.

- [ ] **Step 2: Implement**

`apps/api/src/routes/code.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readSource } from '../db/queries/agent';
import { fail, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';

export const MAX_CODE_LINES = 400;
const MAX_PATH = 500;
const MAX_REPO = 200;

const codeQuery = z.object({
  repo: z.string().min(1).max(MAX_REPO),
  path: z.string().min(1).max(MAX_PATH),
  start: z.coerce.number().int().optional(),
  end: z.coerce.number().int().optional(),
});

export const sliceLines = (content: string, start: number, end: number) => {
  const lines = content.split('\n');
  const startLine = Math.min(Math.max(1, start), lines.length);
  const endLine = Math.min(Math.max(startLine, end), lines.length, startLine + MAX_CODE_LINES - 1);
  return { startLine, endLine, snippet: lines.slice(startLine - 1, endLine).join('\n') };
};

export const codeRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/orgs/:orgId/code', { preHandler: [requireAuth, requireMember(deps)] }, async (req, reply) => {
    const query = codeQuery.parse(req.query);
    const source = await readSource(deps.pool, req.member!.org.id, query.repo, query.path);
    if (!source) return fail(reply, 404, 'not_found');
    const start = query.start ?? 1;
    return { repo: query.repo, path: query.path, language: source.language, ...sliceLines(source.content, start, query.end ?? start + MAX_CODE_LINES - 1) };
  });
};
```

In `apps/api/src/app.ts` import `codeRoutes` and register it after `githubRoutes(api, deps);`:
```ts
        codeRoutes(api, deps);
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): serve indexed code on demand

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Agent tools

**Files:**
- Create: `apps/api/src/agent/tools.ts`, `apps/api/test/agent/orgGraph.ts`
- Modify: `packages/providers/src/github.ts`, `apps/api/package.json` (+ `@anthropic-ai/sdk`), `apps/api/vitest.config.ts` only if the new `test/agent` folder is excluded (it must run with unit tests)
- Test: `apps/api/test/agent/tools.test.ts`, `packages/providers/test/github.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // providers
  GitHubClient.listPullFiles(installationId: number, fullName: string, number: number): Promise<{ filename: string; status: string; patch?: string }[]>
  // api agent
  type ToolContext = {
    loadGraph(): Promise<OrgGraph>;
    readSource(repo: string, path: string): Promise<{ content: string; language: string } | null>;
    prFiles(repo: string, number: number): Promise<{ filename: string; status: string; patch?: string }[] | null>;  // null = no GitHub installation for repo
  }
  type ToolOutcome = { content: string; isError?: boolean; scene?: Scene; summary: string }
  TOOL_NAMES = ['search_graph','get_neighbors','find_path','read_code','get_pr_diff','emit_scene'] as const
  toolDefinitions: Anthropic.Beta.BetaTool[]
  executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome>
  sceneInputSchema: Record<string, unknown>      // JSON Schema of a Scene (input side)
  MAX_READ_LINES = 400
  ```

- [ ] **Step 1: Dependencies**

Run:
```bash
npm install -w @rdi/api @anthropic-ai/sdk@0.129.0 --save-exact
grep -n '"@anthropic-ai/sdk"' apps/api/package.json
grep -n "exclude\|include" apps/api/vitest.config.ts
```
Expected: SDK pinned at `0.129.0`; unit config excludes only `*.integration.test.ts`.

- [ ] **Step 2: Write the failing tests**

Append inside `describe('createGitHubClient', …)` of `packages/providers/test/github.test.ts`:
```ts
  it('lists the files of a pull request with an installation token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ token: 'ghs_pr' }, 201))
      .mockResolvedValueOnce(json([{ filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@', additions: 1 }]));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    expect(await client.listPullFiles(9, 'acme/api', 42)).toEqual([{ filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' }]);
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.github.com/repos/acme/api/pulls/42/files?per_page=100');
    expect(fetchMock.mock.calls[1]![1].headers.authorization).toBe('token ghs_pr');
  });
```

`apps/api/test/agent/orgGraph.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { buildRepoGraph, detect, linkInputsFromGraph, linkRepos, parseRepository, walkRepository, type OrgGraph } from '@rdi/indexer';

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/repos', import.meta.url));
export const TEST_ORG_ID = 'org-t';
export const REPOS = ['shop-web', 'shop-api', 'shop-worker'] as const;

export const fixtureSources = async (): Promise<Map<string, { content: string; language: string }>> => {
  const map = new Map<string, { content: string; language: string }>();
  for (const repo of REPOS) {
    for (const f of (await walkRepository(`${FIXTURES}/${repo}`)).files) map.set(`acme-demo/${repo}|${f.path}`, { content: f.content, language: f.language });
  }
  return map;
};

export const fixtureOrgGraph = async (): Promise<OrgGraph> => {
  const graphs = [];
  for (const repo of REPOS) {
    const walk = await walkRepository(`${FIXTURES}/${repo}`);
    const facts = await parseRepository(walk.files);
    graphs.push(buildRepoGraph({ orgId: TEST_ORG_ID, repoId: repo, fullName: `acme-demo/${repo}`, walk, facts, detections: detect(facts) }));
  }
  const nodes = [...new Map(graphs.flatMap((g) => g.nodes).map((n) => [n.id, n])).values()];
  return { nodes, edges: [...graphs.flatMap((g) => g.edges), ...linkRepos(linkInputsFromGraph(nodes))] };
};
```

`apps/api/test/agent/tools.test.ts`:
```ts
import { sampleRegistry } from '@rdi/scene';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeTool, sceneInputSchema, TOOL_NAMES, toolDefinitions, type ToolContext } from '../../src/agent/tools';
import { fixtureOrgGraph, fixtureSources } from './orgGraph';

let ctx: ToolContext;
beforeAll(async () => {
  const graph = await fixtureOrgGraph();
  const sources = await fixtureSources();
  ctx = {
    loadGraph: async () => graph,
    readSource: async (repo, path) => sources.get(`${repo}|${path}`) ?? null,
    prFiles: async (repo, number) => (repo === 'acme-demo/shop-api' && number === 7 ? [{ filename: 'src/orders.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }] : null),
  };
});
const run = async (name: string, input: unknown) => executeTool(name, input, ctx);
const json = (content: string) => JSON.parse(content);

describe('tool definitions', () => {
  it('declares every tool with an object input schema', () => {
    expect(toolDefinitions.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const tool of toolDefinitions) expect(tool.input_schema.type).toBe('object');
    expect(sceneInputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['id', 'title', 'language', 'nodes']) });
    expect(sceneInputSchema).not.toHaveProperty('$schema');
  });
});

describe('search_graph', () => {
  it('ranks pieces by name and summary matches and includes the repository', async () => {
    const result = json((await run('search_graph', { query: 'orders queue' })).content);
    expect(result[0]).toMatchObject({ id: 'queue:org-t:orders', label: 'Queue', name: 'orders' });
    const endpoint = result.find((r: { id: string }) => r.id === 'ep:shop-api:POST /api/orders');
    expect(endpoint).toMatchObject({ repo: 'acme-demo/shop-api' });
  });

  it('filters by label and reports invalid input as an error', async () => {
    const result = json((await run('search_graph', { query: 'orders', labels: ['Table'] })).content);
    expect(result.map((r: { label: string }) => r.label)).toEqual(['Table']);
    expect(await run('search_graph', { query: '' })).toMatchObject({ isError: true });
  });
});

describe('get_neighbors and find_path', () => {
  it('lists typed neighbours in both directions', async () => {
    const result = json((await run('get_neighbors', { id: 'queue:org-t:orders' })).content);
    expect(result.node).toMatchObject({ id: 'queue:org-t:orders' });
    expect(result.edges).toEqual(expect.arrayContaining([
      { type: 'PUBLISHES', direction: 'in', other: { id: 'file:shop-api:src/orders.ts', label: 'File', name: 'src/orders.ts' } },
      { type: 'CONSUMES', direction: 'in', other: { id: 'file:shop-worker:worker.py', label: 'File', name: 'worker.py' } },
    ]));
    expect(await run('get_neighbors', { id: 'nope' })).toMatchObject({ isError: true, content: 'Unknown piece id "nope".' });
  });

  it('finds a path across repositories', async () => {
    const result = json((await run('find_path', { from: 'file:shop-web:src/api.ts', to: 'ext:org-t:api.stripe.com' })).content);
    expect(result.path[0]).toBe('file:shop-web:src/api.ts');
    expect(result.path.at(-1)).toBe('ext:org-t:api.stripe.com');
    expect(result.edges[0]).toBe('CALLS_HTTP');
  });
});

describe('read_code', () => {
  it('returns numbered lines and caps the window', async () => {
    const outcome = await run('read_code', { repo: 'acme-demo/shop-api', path: 'src/server.ts', startLine: 6, endLine: 7 });
    expect(outcome.content).toBe("acme-demo/shop-api/src/server.ts (typescript)\n6: app.post('/api/orders', createOrderHandler);\n7: app.get('/api/orders/:id', getOrderHandler);");
    expect(await run('read_code', { repo: 'acme-demo/shop-api', path: 'missing.ts' })).toMatchObject({ isError: true });
  });
});

describe('get_pr_diff', () => {
  it('maps changed files to graph pieces', async () => {
    const result = json((await run('get_pr_diff', { repo: 'acme-demo/shop-api', number: 7 })).content);
    expect(result.files).toEqual([{ filename: 'src/orders.ts', status: 'modified', pieceId: 'file:shop-api:src/orders.ts', patch: '@@ -1 +1 @@\n-a\n+b' }]);
    expect(await run('get_pr_diff', { repo: 'acme-demo/shop-web', number: 1 })).toMatchObject({ isError: true });
  });
});

describe('emit_scene', () => {
  it('accepts a valid scene and returns it', async () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const outcome = await run('emit_scene', scene);
    expect(outcome.isError).toBeFalsy();
    expect(outcome.scene?.id).toBe('iot-telemetry');
    expect(outcome.content).toMatch(/^Scene "IoT telemetry ingestion" rendered/);
  });

  it('returns validation errors for an invalid scene', async () => {
    const outcome = await run('emit_scene', { id: 'x', title: 'X', language: 'en', nodes: [{ id: 'a', label: 'A', role: 'compute', kind: 'svc', summary: 's' }], edges: [{ id: 'e', from: 'a', to: 'ghost', kind: 'sync' }] });
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).toMatch(/ghost/);
    expect(outcome.scene).toBeUndefined();
  });

  it('rejects unknown tools', async () => {
    expect(await run('rm_rf', {})).toMatchObject({ isError: true, content: 'Unknown tool "rm_rf".' });
  });
});
```

Run: `npm test -w @rdi/providers; npm test -w @rdi/api -- agent/tools`
Expected: FAIL — `listPullFiles` is not a function; `../../src/agent/tools` not found.

- [ ] **Step 3: Implement**

In `packages/providers/src/github.ts` add `listPullFiles(installationId: number, fullName: string, number: number): Promise<{ filename: string; status: string; patch?: string }[]>;` to `GitHubClient`, and to the returned object:
```ts
    async listPullFiles(installationId, fullName, number) {
      const token = await installationToken(installationId);
      const files = await request<{ filename: string; status: string; patch?: string }[]>(`/repos/${fullName}/pulls/${number}/files?per_page=100`, `token ${token}`);
      return files.map((f) => ({ filename: f.filename, status: f.status, ...(f.patch === undefined ? {} : { patch: f.patch }) }));
    },
```
Also add `listPullFiles: async () => []` to the fake client in `apps/api/test/github.integration.test.ts` so it still satisfies the type.

`apps/api/src/agent/tools.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import { EDGE_TYPES, NODE_LABELS, type GraphNode, type OrgGraph } from '@rdi/indexer';
import { sceneSchema, validateScene, type Scene } from '@rdi/scene';
import { z } from 'zod';

export type ToolContext = {
  loadGraph(): Promise<OrgGraph>;
  readSource(repo: string, path: string): Promise<{ content: string; language: string } | null>;
  prFiles(repo: string, number: number): Promise<{ filename: string; status: string; patch?: string }[] | null>;
};
export type ToolOutcome = { content: string; isError?: boolean; scene?: Scene; summary: string };

export const TOOL_NAMES = ['search_graph', 'get_neighbors', 'find_path', 'read_code', 'get_pr_diff', 'emit_scene'] as const;
export const MAX_READ_LINES = 400;
const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 30;
const MAX_NEIGHBORS = 60;
const DEFAULT_PATH_DEPTH = 5;
const MAX_PATH_DEPTH = 7;
const MAX_PR_FILES = 25;
const MAX_PATCH_CHARS = 4000;
const MAX_SUMMARY_CHARS = 240;
const MAX_ERRORS = 25;
const NAME_WEIGHT = 3;
const ID_WEIGHT = 2;

const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  labels: z.array(z.enum(NODE_LABELS)).optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
});
const neighborsInput = z.object({
  id: z.string().min(1).max(500),
  direction: z.enum(['in', 'out', 'both']).optional(),
  types: z.array(z.enum(EDGE_TYPES)).optional(),
});
const pathInput = z.object({ from: z.string().min(1).max(500), to: z.string().min(1).max(500), maxDepth: z.number().int().min(1).max(MAX_PATH_DEPTH).optional() });
const readInput = z.object({ repo: z.string().min(1).max(200), path: z.string().min(1).max(500), startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional() });
const prInput = z.object({ repo: z.string().min(1).max(200), number: z.number().int().positive() });

const jsonSchemaOf = (schema: z.ZodType): Anthropic.Beta.BetaTool['input_schema'] => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  return rest as Anthropic.Beta.BetaTool['input_schema'];
};

export const sceneInputSchema = jsonSchemaOf(sceneSchema) as Record<string, unknown>;

export const toolDefinitions: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_graph',
    description: 'Search the organization System Graph (services, endpoints, files, queues, tables, external APIs, config keys) by keywords. Returns the best matching pieces with their ids, which the other tools accept.',
    input_schema: jsonSchemaOf(searchInput),
  },
  {
    name: 'get_neighbors',
    description: 'List the pieces directly connected to a piece id, with the relationship type (CONTAINS, IMPORTS, HANDLES, PUBLISHES, CONSUMES, READS, WRITES, CALLS, USES_CONFIG, CALLS_HTTP) and direction.',
    input_schema: jsonSchemaOf(neighborsInput),
  },
  {
    name: 'find_path',
    description: 'Find the shortest chain of relationships between two piece ids, across repositories. Use it to explain how a request travels.',
    input_schema: jsonSchemaOf(pathInput),
  },
  {
    name: 'read_code',
    description: `Read indexed source code of a file (repo is the full name like "acme/api"). Returns numbered lines, at most ${MAX_READ_LINES}. Only read code when the graph is not enough to answer.`,
    input_schema: jsonSchemaOf(readInput),
  },
  {
    name: 'get_pr_diff',
    description: 'Get the files changed by a GitHub pull request, mapped to graph piece ids where possible. Only works for repositories connected through GitHub.',
    input_schema: jsonSchemaOf(prInput),
  },
  {
    name: 'emit_scene',
    description: 'Render an animated Scene v2 on the canvas. The input is the complete scene. Returns validation errors if the scene is invalid; fix them and call again.',
    input_schema: sceneInputSchema as Anthropic.Beta.BetaTool['input_schema'],
  },
];

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const clipText = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const brief = (n: GraphNode) => ({ id: n.id, label: n.label, name: n.name });

const repoNames = (graph: OrgGraph) =>
  new Map(graph.nodes.filter((n) => n.label === 'Repo' && n.repoId).map((n) => [n.repoId as string, String(n.props.fullName ?? n.name)]));

const invalid = (name: string, error: z.ZodError): ToolOutcome => ({
  content: `Invalid input for ${name}: ${error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`,
  isError: true,
  summary: `${name} (invalid input)`,
});

const searchGraph = async (input: z.infer<typeof searchInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const graph = await ctx.loadGraph();
  const repos = repoNames(graph);
  const terms = words(input.query);
  const scored = graph.nodes
    .filter((n) => !input.labels || input.labels.includes(n.label))
    .map((n) => {
      const name = n.name.toLowerCase();
      const summary = n.summary.toLowerCase();
      const id = n.id.toLowerCase();
      const score = terms.reduce((sum, term) => sum + NAME_WEIGHT * count(name, term) + ID_WEIGHT * count(id, term) + count(summary, term), 0);
      return { n, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.n.name.localeCompare(b.n.name))
    .slice(0, input.limit ?? DEFAULT_SEARCH_LIMIT);
  const result = scored.map(({ n }) => ({ ...brief(n), summary: clipText(n.summary, MAX_SUMMARY_CHARS), ...(n.repoId && repos.has(n.repoId) ? { repo: repos.get(n.repoId) } : {}) }));
  return { content: JSON.stringify(result), summary: `search_graph "${input.query}" → ${result.length}` };
};

const getNeighbors = async (input: z.infer<typeof neighborsInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const graph = await ctx.loadGraph();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(input.id);
  if (!node) return { content: `Unknown piece id "${input.id}".`, isError: true, summary: 'get_neighbors (unknown id)' };
  const direction = input.direction ?? 'both';
  const edges = graph.edges
    .filter((e) => !input.types || input.types.includes(e.type))
    .flatMap((e) => {
      const out = e.from === node.id && direction !== 'in' ? [{ type: e.type, direction: 'out' as const, other: byId.get(e.to) }] : [];
      const inc = e.to === node.id && direction !== 'out' ? [{ type: e.type, direction: 'in' as const, other: byId.get(e.from) }] : [];
      return [...out, ...inc];
    })
    .filter((e): e is { type: typeof e.type; direction: 'in' | 'out'; other: GraphNode } => e.other !== undefined)
    .slice(0, MAX_NEIGHBORS)
    .map((e) => ({ type: e.type, direction: e.direction, other: brief(e.other) }));
  return { content: JSON.stringify({ node: { ...brief(node), summary: node.summary }, edges }), summary: `get_neighbors ${node.name} → ${edges.length}` };
};

const findPath = async (input: z.infer<typeof pathInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const graph = await ctx.loadGraph();
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const id of [input.from, input.to]) {
    if (!ids.has(id)) return { content: `Unknown piece id "${id}".`, isError: true, summary: 'find_path (unknown id)' };
  }
  const adjacency = new Map<string, { to: string; type: string }[]>();
  const link = (a: string, b: string, type: string) => adjacency.set(a, [...(adjacency.get(a) ?? []), { to: b, type }]);
  for (const e of graph.edges) {
    link(e.from, e.to, e.type);
    link(e.to, e.from, e.type);
  }
  const maxDepth = input.maxDepth ?? DEFAULT_PATH_DEPTH;
  const previous = new Map<string, { from: string; type: string }>([[input.from, { from: '', type: '' }]]);
  let frontier = [input.from];
  for (let depth = 0; depth < maxDepth && !previous.has(input.to) && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const step of adjacency.get(id) ?? []) {
        if (previous.has(step.to)) continue;
        previous.set(step.to, { from: id, type: step.type });
        next.push(step.to);
      }
    }
    frontier = next;
  }
  if (!previous.has(input.to)) return { content: `No path within ${maxDepth} hops.`, summary: 'find_path → none' };
  const path: string[] = [];
  const edges: string[] = [];
  for (let at = input.to; at !== input.from; at = previous.get(at)!.from) {
    path.unshift(at);
    edges.unshift(previous.get(at)!.type);
  }
  path.unshift(input.from);
  return { content: JSON.stringify({ path, edges }), summary: `find_path → ${edges.length} hops` };
};

const readCode = async (input: z.infer<typeof readInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const source = await ctx.readSource(input.repo, input.path);
  if (!source) return { content: `No indexed file ${input.repo}/${input.path}.`, isError: true, summary: 'read_code (not found)' };
  const lines = source.content.split('\n');
  const start = Math.min(input.startLine ?? 1, lines.length);
  const end = Math.min(input.endLine ?? start + MAX_READ_LINES - 1, lines.length, start + MAX_READ_LINES - 1);
  const body = lines.slice(start - 1, Math.max(start, end)).map((line, i) => `${start + i}: ${line}`).join('\n');
  return { content: `${input.repo}/${input.path} (${source.language})\n${body}`, summary: `read_code ${input.path}:${start}-${end}` };
};

const getPrDiff = async (input: z.infer<typeof prInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const files = await ctx.prFiles(input.repo, input.number);
  if (!files) return { content: `Pull request diffs need a GitHub connection for ${input.repo}.`, isError: true, summary: 'get_pr_diff (not connected)' };
  const graph = await ctx.loadGraph();
  const repoId = [...repoNames(graph).entries()].find(([, name]) => name === input.repo)?.[0];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const mapped = files.slice(0, MAX_PR_FILES).map((f) => {
    const pieceId = repoId ? `file:${repoId}:${f.filename}` : null;
    return { filename: f.filename, status: f.status, pieceId: pieceId && ids.has(pieceId) ? pieceId : null, ...(f.patch === undefined ? {} : { patch: clipText(f.patch, MAX_PATCH_CHARS) }) };
  });
  return { content: JSON.stringify({ files: mapped, truncated: files.length > MAX_PR_FILES }), summary: `get_pr_diff #${input.number} → ${mapped.length} files` };
};

const emitScene = (input: unknown): ToolOutcome => {
  const result = validateScene(input);
  if (!result.ok) {
    return { content: `The scene is invalid:\n${result.errors.slice(0, MAX_ERRORS).join('\n')}`, isError: true, summary: 'emit_scene (invalid)' };
  }
  const { scene } = result;
  return { content: `Scene "${scene.title}" rendered with ${scene.nodes.length} pieces and ${scene.steps.length} steps.`, scene, summary: `emit_scene "${scene.title}"` };
};

export const executeTool = async (name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> => {
  switch (name) {
    case 'search_graph': {
      const parsed = searchInput.safeParse(input);
      return parsed.success ? searchGraph(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'get_neighbors': {
      const parsed = neighborsInput.safeParse(input);
      return parsed.success ? getNeighbors(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'find_path': {
      const parsed = pathInput.safeParse(input);
      return parsed.success ? findPath(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'read_code': {
      const parsed = readInput.safeParse(input);
      return parsed.success ? readCode(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'get_pr_diff': {
      const parsed = prInput.safeParse(input);
      return parsed.success ? getPrDiff(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'emit_scene':
      return emitScene(input);
    default:
      return { content: `Unknown tool "${name}".`, isError: true, summary: `${name} (unknown)` };
  }
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/providers && npm test -w @rdi/api && npm run typecheck -w @rdi/api && npm run typecheck -w @rdi/providers`
Expected: PASS. If `z.toJSONSchema` emits `$ref`s into a `$defs` block for the recursive steps, keep it (the root object is the tool schema, so refs resolve).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add agent tools over the System Graph, indexed code and PR diffs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: LLM client — Anthropic implementation and scripted fake

**Files:**
- Create: `apps/api/src/agent/llm.ts`, `apps/api/src/agent/anthropicLlm.ts`, `apps/api/src/agent/fakeLlm.ts`
- Test: `apps/api/test/agent/anthropicLlm.test.ts`, `apps/api/test/agent/fakeLlm.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type LlmTurnInput = { system: string; messages: Anthropic.Beta.BetaMessageParam[]; tools: Anthropic.Beta.BetaTool[]; onText?: (delta: string) => void; signal?: AbortSignal }
  type LlmClient = { model: string; turn(input: LlmTurnInput): Promise<Anthropic.Beta.BetaMessage> }
  AGENT_MAX_TOKENS = 32000; FALLBACK_BETA = 'server-side-fallback-2026-07-01'; FALLBACK_MODELS: Set<string>
  buildTurnParams(model: string, input: LlmTurnInput): Anthropic.Beta.MessageCreateParamsStreaming-compatible object
  createAnthropicLlm(model: string, client?: Anthropic): LlmClient
  FAKE_MODEL = 'fake-scripted'; createFakeLlm(): LlmClient
  TRANSLATE_MARKER = 'Target language:'      // used by translate (Task 9) and understood by the fake
  ```
  Fake script: user text → `search_graph {query: text}`; search result → `emit_scene` built from up to 5 results (roles by label, `calls` edges between consecutive pieces, one travelling step per edge, narration "Step n: <name>."); scene result → final text; translation request (`TRANSLATE_MARKER <lang>` + scene JSON) → `emit_scene` with the same scene and `language` set to `<lang>`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/agent/anthropicLlm.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { AGENT_MAX_TOKENS, buildTurnParams, FALLBACK_BETA } from '../../src/agent/anthropicLlm';

const input = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], tools: [{ name: 't', description: 'd', input_schema: { type: 'object' as const, properties: {} } }] };

describe('buildTurnParams', () => {
  it('streams with adaptive thinking, caching, eager tool input and server-side fallbacks on Opus 5', () => {
    const params = buildTurnParams('claude-opus-5', input);
    expect(params).toMatchObject({
      model: 'claude-opus-5', max_tokens: AGENT_MAX_TOKENS, system: 'sys', thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' }, betas: [FALLBACK_BETA], fallbacks: 'default',
    });
    expect(params.tools).toEqual([{ ...input.tools[0], eager_input_streaming: true }]);
  });

  it('omits fallbacks for models that do not support them', () => {
    const params = buildTurnParams('claude-sonnet-5', input);
    expect(params).not.toHaveProperty('fallbacks');
    expect(params).not.toHaveProperty('betas');
  });
});
```

`apps/api/test/agent/fakeLlm.test.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createFakeLlm, TRANSLATE_MARKER } from '../../src/agent/fakeLlm';

type Param = Anthropic.Beta.BetaMessageParam;
const llm = createFakeLlm();
const turn = (messages: Param[]) => llm.turn({ system: 's', messages, tools: [] });
const toolUse = (message: Anthropic.Beta.BetaMessage) => message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')!;

describe('createFakeLlm', () => {
  it('searches, emits a scene from the results, then answers', async () => {
    const user: Param = { role: 'user', content: [{ type: 'text', text: 'Respond in Spanish (es).' }, { type: 'text', text: 'orders' }] };
    const first = await turn([user]);
    expect(first.stop_reason).toBe('tool_use');
    expect(toolUse(first)).toMatchObject({ name: 'search_graph', input: { query: 'orders' } });
    const results = [{ id: 'queue:o:orders', label: 'Queue', name: 'orders', summary: 'q' }, { id: 'table:o:orders', label: 'Table', name: 'orders', summary: 't' }];
    const second = await turn([user, { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse(first).id, content: JSON.stringify(results) }] }]);
    const scene = toolUse(second).input as { language: string; nodes: { role: string }[]; steps: unknown[] };
    expect(toolUse(second).name).toBe('emit_scene');
    expect(scene.language).toBe('es');
    expect(scene.nodes.map((n) => n.role)).toEqual(['channel', 'storage']);
    expect(scene.steps).toHaveLength(1);
    const third = await turn([user, { role: 'assistant', content: second.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse(second).id, content: 'Scene "x" rendered' }] }]);
    expect(third.stop_reason).toBe('end_turn');
    expect(third.content[0]).toMatchObject({ type: 'text' });
  });

  it('translates by echoing the scene with the new language', async () => {
    const scene = { id: 's', title: 'T', language: 'en', nodes: [{ id: 'a', label: 'A', role: 'compute', kind: 'k', summary: 's' }] };
    const message = await turn([{ role: 'user', content: `${TRANSLATE_MARKER} pt\n\n${JSON.stringify(scene)}` }]);
    expect(toolUse(message)).toMatchObject({ name: 'emit_scene', input: { ...scene, language: 'pt' } });
  });
});
```

Run: `npm test -w @rdi/api -- agent/`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement**

`apps/api/src/agent/llm.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';

export type LlmTurnInput = {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  onText?: (delta: string) => void;
  signal?: AbortSignal;
};

export type LlmClient = { model: string; turn(input: LlmTurnInput): Promise<Anthropic.Beta.BetaMessage> };
```

`apps/api/src/agent/anthropicLlm.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmTurnInput } from './llm';

export const AGENT_MAX_TOKENS = 32_000;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1']);

export const buildTurnParams = (model: string, input: LlmTurnInput) => ({
  model,
  max_tokens: AGENT_MAX_TOKENS,
  system: input.system,
  messages: input.messages,
  tools: input.tools.map((tool) => ({ ...tool, eager_input_streaming: true })),
  thinking: { type: 'adaptive' as const },
  output_config: { effort: 'high' as const },
  cache_control: { type: 'ephemeral' as const },
  ...(FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
});

export const createAnthropicLlm = (model: string, client: Anthropic = new Anthropic()): LlmClient => ({
  model,
  async turn(input) {
    const stream = client.beta.messages.stream(buildTurnParams(model, input), { signal: input.signal });
    if (input.onText) stream.on('text', input.onText);
    return stream.finalMessage();
  },
});
```

`apps/api/src/agent/fakeLlm.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient } from './llm';

type Message = Anthropic.Beta.BetaMessage;
type Param = Anthropic.Beta.BetaMessageParam;
type SearchHit = { id: string; label: string; name: string; summary?: string };

export const FAKE_MODEL = 'fake-scripted';
export const TRANSLATE_MARKER = 'Target language:';
const MAX_SCENE_PIECES = 5;
const LANGUAGE_DIRECTIVE = /\(([a-z]{2,3}(?:-[A-Za-z0-9]+)*)\)\./;
const ROLE_BY_LABEL: Record<string, string> = { Queue: 'channel', Table: 'storage', External: 'external', ConfigKey: 'data', File: 'logic' };

let counter = 0;
const nextId = (prefix: string) => `${prefix}_fake_${++counter}`;

const message = (content: unknown[], stopReason: 'tool_use' | 'end_turn'): Message =>
  ({
    id: nextId('msg'), type: 'message', role: 'assistant', model: FAKE_MODEL, content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  }) as unknown as Message;

const toolUse = (name: string, input: unknown) => message([{ type: 'tool_use', id: nextId('toolu'), name, input }], 'tool_use');
const text = (value: string) => message([{ type: 'text', text: value, citations: null }], 'end_turn');

const blocks = (param: Param): { type: string; text?: string; tool_use_id?: string; content?: unknown }[] =>
  typeof param.content === 'string' ? [{ type: 'text', text: param.content }] : (param.content as { type: string }[]);

const textOf = (param: Param) => blocks(param).filter((b) => b.type === 'text').map((b) => b.text ?? '');

const toolNameFor = (messages: Param[], toolUseId: string): string | null => {
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const b of blocks(m) as { type: string; id?: string; name?: string }[]) if (b.type === 'tool_use' && b.id === toolUseId) return b.name ?? null;
  }
  return null;
};

const languageOf = (messages: Param[]) => {
  for (const m of [...messages].reverse()) {
    if (m.role !== 'user') continue;
    for (const t of textOf(m)) {
      const match = LANGUAGE_DIRECTIVE.exec(t);
      if (match?.[1]) return match[1];
    }
  }
  return 'en';
};

const sceneFrom = (hits: SearchHit[], language: string) => {
  const pieces = hits.slice(0, MAX_SCENE_PIECES);
  const nodes = pieces.map((h, i) => ({ id: `p${i + 1}`, label: h.name.slice(0, 110), role: ROLE_BY_LABEL[h.label] ?? 'compute', kind: h.label, summary: h.summary || h.name, graphRef: h.id }));
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i + 1}`, from: nodes[i]!.id, to: n.id, kind: 'calls' }));
  const steps = edges.map((e, i) => ({ id: `s${i + 1}`, narration: `Step ${i + 1}: ${nodes[i + 1]!.label}.`, focus: [e.to], travel: { edgeId: e.id } }));
  return { id: nextId('scene'), title: `About ${pieces[0]?.name ?? 'the system'}`, language, nodes, edges, steps };
};

export const createFakeLlm = (): LlmClient => ({
  model: FAKE_MODEL,
  async turn({ messages, onText }) {
    const last = messages.at(-1);
    if (!last || last.role !== 'user') return text('Nothing to answer.');
    const lastBlocks = blocks(last);
    const result = lastBlocks.find((b) => b.type === 'tool_result');
    if (!result) {
      const question = textOf(last).at(-1) ?? '';
      if (question.startsWith(TRANSLATE_MARKER)) {
        const [header, ...rest] = question.split('\n');
        const language = header!.slice(TRANSLATE_MARKER.length).trim();
        const scene = JSON.parse(rest.join('\n').trim()) as Record<string, unknown>;
        return toolUse('emit_scene', { ...scene, language });
      }
      return toolUse('search_graph', { query: question });
    }
    const tool = toolNameFor(messages, result.tool_use_id ?? '');
    const payload = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    if (tool === 'search_graph') {
      const hits = JSON.parse(payload) as SearchHit[];
      if (hits.length === 0) {
        onText?.('I could not find matching pieces in the indexed repositories.');
        return text('I could not find matching pieces in the indexed repositories.');
      }
      return toolUse('emit_scene', sceneFrom(hits, languageOf(messages)));
    }
    const answer = `Here is how it fits together. ${payload.split('\n')[0]}`;
    onText?.(answer);
    return text(answer);
  },
});
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS. If the SDK's `stream()` params type rejects the spread object, type `buildTurnParams`'s return as `Anthropic.Beta.Messages.MessageCreateParamsStreaming` minus `stream` (ledger the exact type name used).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add the Anthropic LLM client and a scripted fake for dev and tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: System prompt and user turns

**Files:**
- Create: `apps/api/src/agent/prompt.ts`
- Test: `apps/api/test/agent/prompt.test.ts`

**Interfaces:**
- Produces:
  ```ts
  SYSTEM_PROMPT: string      // constant (cache-stable)
  LANGUAGE_NAMES: Record<string, string>
  userTurn(question: string, options: { language: string; focus?: { label: string; graphRef: string } | null; repos: string[] }): Anthropic.Beta.BetaMessageParam
  questionOf(message: { role: string; content: unknown }): string | null   // the user's own words (last text block)
  ```

- [ ] **Step 1: Write the failing test**

`apps/api/test/agent/prompt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { questionOf, SYSTEM_PROMPT, userTurn } from '../../src/agent/prompt';

describe('SYSTEM_PROMPT', () => {
  it('explains the product, the tools and the scene vocabulary', () => {
    for (const word of ['search_graph', 'emit_scene', 'actor', 'compute', 'storage', 'channel', 'external', 'logic', 'data', 'risks', 'substeps', 'graphRef']) {
      expect(SYSTEM_PROMPT).toContain(word);
    }
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('userTurn', () => {
  it('puts the language, repositories and focus before the question', () => {
    const turn = userTurn('How are orders paid?', { language: 'es', focus: { label: 'worker', graphRef: 'svc:r1' }, repos: ['acme/api', 'acme/worker'] });
    expect(turn.role).toBe('user');
    const texts = (turn.content as { type: string; text: string }[]).map((b) => b.text);
    expect(texts[0]).toBe('Respond in Spanish (es). Scene titles, labels, summaries and narration must be in that language.');
    expect(texts[1]).toBe('Indexed repositories: acme/api, acme/worker.');
    expect(texts[2]).toBe('The user is looking at "worker" (graph id svc:r1).');
    expect(texts.at(-1)).toBe('How are orders paid?');
    expect(questionOf(turn)).toBe('How are orders paid?');
  });

  it('handles unknown languages and no repositories', () => {
    const texts = (userTurn('q', { language: 'fr', repos: [] }).content as { text: string }[]).map((b) => b.text);
    expect(texts[0]).toBe('Respond in fr (fr). Scene titles, labels, summaries and narration must be in that language.');
    expect(texts[1]).toBe('No repositories are indexed yet.');
    expect(questionOf({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y' }] })).toBeNull();
  });
});
```

Run: `npm test -w @rdi/api -- agent/prompt`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

`apps/api/src/agent/prompt.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';

export const LANGUAGE_NAMES: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

export const SYSTEM_PROMPT = [
  'You are the guide inside Repository Designer, a workspace where people understand software systems without reading code.',
  'The organization has indexed its repositories into a System Graph: services, HTTP endpoints, files, queues, tables, external APIs and config keys, connected by CONTAINS, IMPORTS, HANDLES, PUBLISHES, CONSUMES, READS, WRITES, CALLS, USES_CONFIG and cross-repository CALLS_HTTP relationships.',
  '',
  'How to work:',
  '- Ground every claim in the graph. Start with search_graph, then get_neighbors and find_path to follow how data and requests move. Read code with read_code only when the graph cannot answer (an algorithm, a branch, a data shape).',
  '- For pull requests use get_pr_diff and explain the impact on the pieces that changed.',
  '- When a picture helps (flows, architecture, impact, algorithms), call emit_scene exactly once per answer with a complete scene, then reply with a short text that complements it. Do not repeat the whole narration in text.',
  '- If emit_scene returns validation errors, fix exactly those problems and call it again. If told to stop, answer in text only.',
  '- Say plainly when something is not in the index instead of guessing.',
  '',
  'Scene vocabulary (the emit_scene input schema is authoritative):',
  '- nodes: role is one of actor, compute, storage, channel, external, logic, data; kind is a free label such as "Express API" or "BullMQ queue". Use parent to nest internal pieces (functions, data structures) inside a service so people can open it; use repo on top-level pieces so they group by repository. Set graphRef to the System Graph id of the piece whenever there is one.',
  '- Add code {repo, path, startLine, endLine, language} on pieces whose source matters; leave snippet out, the app loads code on demand.',
  '- edges: kind is sync, async, read, write or calls, between node ids.',
  '- steps: an ordered walkthrough of one concrete request. Each step has narration in plain language, focus node ids and usually travel {edgeId, payload} along an edge. Use payload {format, before, after} to show example data changing. Use expand + substeps to let people open a step into detail.',
  '- risks: performance, security, complexity and reliability weaknesses with severity, explanation, affected nodeIds and mitigation.',
  '- scale on important pieces: how they behave at low, medium and high volume (ok, strained, limit, saturated) plus the strategy to scale.',
  '- Keep scenes focused: at most about 25 pieces and 12 top-level steps, ids short and stable.',
  '',
  'Write for someone who does not want to read code: short sentences, concrete examples, no jargon without explanation.',
].join('\n');

const languageName = (tag: string) => LANGUAGE_NAMES[tag] ?? tag;

export const userTurn = (
  question: string,
  options: { language: string; focus?: { label: string; graphRef: string } | null; repos: string[] },
): Anthropic.Beta.BetaMessageParam => {
  const content: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: `Respond in ${languageName(options.language)} (${options.language}). Scene titles, labels, summaries and narration must be in that language.` },
    { type: 'text', text: options.repos.length > 0 ? `Indexed repositories: ${options.repos.join(', ')}.` : 'No repositories are indexed yet.' },
  ];
  if (options.focus) content.push({ type: 'text', text: `The user is looking at "${options.focus.label}" (graph id ${options.focus.graphRef}).` });
  content.push({ type: 'text', text: question });
  return { role: 'user', content };
};

export const questionOf = (message: { role: string; content: unknown }): string | null => {
  if (message.role !== 'user') return null;
  if (typeof message.content === 'string') return message.content;
  const texts = (message.content as { type: string; text?: string }[]).filter((b) => b.type === 'text');
  return texts.at(-1)?.text ?? null;
};
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add the agent system prompt and user turn framing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Agent loop

**Files:**
- Create: `apps/api/src/agent/runAgent.ts`
- Test: `apps/api/test/agent/runAgent.test.ts`

**Interfaces:**
- Consumes: `LlmClient` (Task 5), `executeTool`, `toolDefinitions`, `ToolContext` (Task 4).
- Produces:
  ```ts
  type AgentEvent =
    | { type: 'text'; delta: string }
    | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
    | { type: 'scene'; scene: Scene }
    | { type: 'error'; code: 'refusal' | 'max_tokens' | 'max_iterations' | 'llm_error' | 'aborted'; message: string }
  type AgentResult = { appended: Anthropic.Beta.BetaMessageParam[]; scenes: Scene[]; usage: { input: number; output: number }; stop: 'end_turn' | 'error' }
  MAX_ITERATIONS = 10; MAX_JSON_RETRIES = 2; MAX_INVALID_SCENES = 3
  STOP_EMITTING = 'Do not call emit_scene again in this answer; explain in text instead.'
  runAgent(input: { llm: LlmClient; system: string; tools?: BetaTool[]; history: BetaMessageParam[]; user: BetaMessageParam; ctx: ToolContext;
                    emit: (event: AgentEvent) => void | Promise<void>; signal?: AbortSignal }): Promise<AgentResult>
  ```
  `appended` never includes the user message; it only contains complete `assistant` / `user(tool_result…)` pairs plus the final assistant message.

- [ ] **Step 1: Write the failing test**

`apps/api/test/agent/runAgent.test.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { sampleRegistry } from '@rdi/scene';
import { describe, expect, it, vi } from 'vitest';
import type { LlmClient, LlmTurnInput } from '../../src/agent/llm';
import { MAX_INVALID_SCENES, MAX_ITERATIONS, runAgent, STOP_EMITTING, type AgentEvent } from '../../src/agent/runAgent';
import type { ToolContext } from '../../src/agent/tools';

type Message = Anthropic.Beta.BetaMessage;
const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 };
const msg = (content: unknown[], stop_reason: string): Message => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason, stop_sequence: null, usage }) as unknown as Message;
const textMsg = (text: string) => msg([{ type: 'text', text }], 'end_turn');
const toolMsg = (...uses: { id: string; name: string; input: unknown }[]) => msg(uses.map((u) => ({ type: 'tool_use', ...u })), 'tool_use');

const scripted = (steps: (Message | Error | ((input: LlmTurnInput) => Message))[]) => {
  const calls: LlmTurnInput[] = [];
  const llm: LlmClient = {
    model: 'scripted',
    async turn(input) {
      calls.push({ ...input, messages: [...input.messages] });
      const step = steps.shift();
      if (!step) throw new Error('script exhausted');
      if (step instanceof Error) throw step;
      const message = typeof step === 'function' ? step(input) : step;
      for (const b of message.content) if (b.type === 'text') input.onText?.(b.text);
      return message;
    },
  };
  return { llm, calls };
};

const ctx: ToolContext = {
  loadGraph: async () => ({ nodes: [{ id: 'queue:o:orders', label: 'Queue', name: 'orders', summary: 'Orders queue', repoId: null, props: {} }], edges: [] }),
  readSource: async () => null,
  prFiles: async () => null,
};
const user = { role: 'user' as const, content: 'How do orders flow?' };
const collect = () => {
  const events: AgentEvent[] = [];
  return { events, emit: (e: AgentEvent) => { events.push(e); } };
};
const validScene = sampleRegistry['iot-telemetry']!;
const invalidScene = { id: 'x', title: 'X', language: 'en', nodes: [] };

describe('runAgent', () => {
  it('streams a text-only answer', async () => {
    const { llm, calls } = scripted([textMsg('Orders go through a queue.')]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 'sys', history: [], user, ctx, emit });
    expect(events).toEqual([{ type: 'text', delta: 'Orders go through a queue.' }]);
    expect(result).toMatchObject({ stop: 'end_turn', scenes: [], usage: { input: 15, output: 5 } });
    expect(result.appended).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'Orders go through a queue.' }] }]);
    expect(calls[0]!.messages).toEqual([user]);
  });

  it('runs tools, emits the scene and keeps complete pairs', async () => {
    const { llm, calls } = scripted([
      toolMsg({ id: 't1', name: 'search_graph', input: { query: 'orders' } }),
      toolMsg({ id: 't2', name: 'emit_scene', input: validScene }),
      textMsg('Done.'),
    ]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 'sys', history: [], user, ctx, emit });
    expect(events.map((e) => (e.type === 'tool' ? `${e.name}:${e.status}` : e.type))).toEqual(['search_graph:running', 'search_graph:done', 'emit_scene:running', 'emit_scene:done', 'scene', 'text']);
    expect(result.scenes.map((s) => s.id)).toEqual(['iot-telemetry']);
    expect(result.appended.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant']);
    const results = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(JSON.parse(results[0]!.content as string)[0]).toMatchObject({ id: 'queue:o:orders' });
  });

  it('returns all parallel tool results in one user message', async () => {
    const { llm, calls } = scripted([
      toolMsg({ id: 'a', name: 'search_graph', input: { query: 'orders' } }, { id: 'b', name: 'get_neighbors', input: { id: 'queue:o:orders' } }),
      textMsg('ok'),
    ]);
    await runAgent({ llm, system: 's', history: [], user, ctx, emit: () => {} });
    const results = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b']);
  });

  it('sends validation errors back and tells the model to stop after repeated invalid scenes', async () => {
    const invalids = Array.from({ length: MAX_INVALID_SCENES }, (_, i) => toolMsg({ id: `bad${i}`, name: 'emit_scene', input: invalidScene }));
    const { llm, calls } = scripted([...invalids, textMsg('In text then.')]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(result.scenes).toEqual([]);
    expect(events.some((e) => e.type === 'scene')).toBe(false);
    const first = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(first[0]).toMatchObject({ is_error: true });
    expect(first[0]!.content).not.toContain(STOP_EMITTING);
    const last = calls[MAX_INVALID_SCENES]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(last[0]!.content).toContain(STOP_EMITTING);
  });

  it('reports invalid tool input as an error result', async () => {
    const { llm, calls } = scripted([toolMsg({ id: 'x', name: 'search_graph', input: { query: 42 } }), textMsg('ok')]);
    await runAgent({ llm, system: 's', history: [], user, ctx, emit: () => {} });
    expect((calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]).toMatchObject({ is_error: true });
  });

  it('stops on refusal without appending the refused turn', async () => {
    const { llm } = scripted([msg([{ type: 'text', text: '' }], 'refusal')]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(result).toMatchObject({ stop: 'error', appended: [] });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'refusal' });
  });

  it('never runs tools cut off by max_tokens', async () => {
    const run = vi.fn();
    const { llm } = scripted([msg([{ type: 'tool_use', id: 't', name: 'search_graph', input: { query: 'or' } }], 'max_tokens')]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx: { ...ctx, loadGraph: run }, emit });
    expect(run).not.toHaveBeenCalled();
    expect(result.appended).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'max_tokens' });
  });

  it('stops after the iteration cap', async () => {
    const loop = Array.from({ length: MAX_ITERATIONS + 1 }, (_, i) => toolMsg({ id: `l${i}`, name: 'search_graph', input: { query: 'orders' } }));
    const { llm, calls } = scripted(loop);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(calls).toHaveLength(MAX_ITERATIONS);
    expect(result.stop).toBe('error');
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'max_iterations' });
    expect(result.appended.length % 2).toBe(0);
  });

  it('retries a turn whose streamed tool input was not parseable JSON', async () => {
    const { llm, calls } = scripted([new SyntaxError('Unexpected end of JSON input'), textMsg('ok')]);
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit: () => {} });
    expect(calls).toHaveLength(2);
    expect(result.stop).toBe('end_turn');
  });

  it('reports API errors and keeps only complete pairs', async () => {
    const apiError = new Anthropic.APIError(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers());
    const { llm } = scripted([toolMsg({ id: 't1', name: 'search_graph', input: { query: 'orders' } }), apiError]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(result.stop).toBe('error');
    expect(result.appended.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'llm_error' });
  });

  it('stops quietly when the client aborted', async () => {
    const controller = new AbortController();
    const { llm } = scripted([(input) => { controller.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError', signal: input.signal }); }]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit, signal: controller.signal });
    expect(result).toMatchObject({ stop: 'error', appended: [] });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'aborted' });
  });
});
```

Run: `npm test -w @rdi/api -- agent/runAgent`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

`apps/api/src/agent/runAgent.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import type { Scene } from '@rdi/scene';
import type { LlmClient } from './llm';
import { executeTool, toolDefinitions, type ToolContext } from './tools';

type Param = Anthropic.Beta.BetaMessageParam;
type ToolUse = Anthropic.Beta.BetaToolUseBlock;

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
  | { type: 'scene'; scene: Scene }
  | { type: 'error'; code: 'refusal' | 'max_tokens' | 'max_iterations' | 'llm_error' | 'aborted'; message: string };

export type AgentResult = { appended: Param[]; scenes: Scene[]; usage: { input: number; output: number }; stop: 'end_turn' | 'error' };

export const MAX_ITERATIONS = 10;
export const MAX_JSON_RETRIES = 2;
export const MAX_INVALID_SCENES = 3;
export const STOP_EMITTING = 'Do not call emit_scene again in this answer; explain in text instead.';

export const runAgent = async (input: {
  llm: LlmClient;
  system: string;
  tools?: Anthropic.Beta.BetaTool[];
  history: Param[];
  user: Param;
  ctx: ToolContext;
  emit: (event: AgentEvent) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<AgentResult> => {
  const appended: Param[] = [];
  const scenes: Scene[] = [];
  const usage = { input: 0, output: 0 };
  let invalidScenes = 0;
  let jsonRetries = 0;
  const fail = async (code: Extract<AgentEvent, { type: 'error' }>['code'], message: string): Promise<AgentResult> => {
    await input.emit({ type: 'error', code, message });
    return { appended, scenes, usage, stop: 'error' };
  };

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const pendingText: string[] = [];
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await input.llm.turn({
        system: input.system,
        messages: [...input.history, input.user, ...appended],
        tools: input.tools ?? toolDefinitions,
        onText: (delta) => { pendingText.push(delta); },
        signal: input.signal,
      });
      jsonRetries = 0;
    } catch (error) {
      if (input.signal?.aborted) return fail('aborted', 'The request was cancelled.');
      if (error instanceof Anthropic.APIError) return fail('llm_error', error.message);
      if (jsonRetries++ < MAX_JSON_RETRIES) {
        iteration--;
        continue;
      }
      return fail('llm_error', error instanceof Error ? error.message : String(error));
    } finally {
      for (const delta of pendingText.splice(0)) await input.emit({ type: 'text', delta });
    }

    const u = message.usage;
    usage.input += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    usage.output += u.output_tokens;

    if (message.stop_reason === 'refusal') return fail('refusal', 'The model declined to answer this request.');
    const toolUses = message.content.filter((b): b is ToolUse => b.type === 'tool_use');
    if (message.stop_reason === 'max_tokens') return fail('max_tokens', 'The answer was too long and was cut off.');
    if (message.stop_reason === 'pause_turn') {
      appended.push({ role: 'assistant', content: message.content });
      continue;
    }
    if (toolUses.length === 0) {
      appended.push({ role: 'assistant', content: message.content });
      return { appended, scenes, usage, stop: 'end_turn' };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      await input.emit({ type: 'tool', name: use.name, status: 'running', summary: use.name });
      const outcome = await executeTool(use.name, use.input, input.ctx);
      let content = outcome.content;
      if (use.name === 'emit_scene' && outcome.isError && ++invalidScenes >= MAX_INVALID_SCENES) content = `${content}\n${STOP_EMITTING}`;
      await input.emit({ type: 'tool', name: use.name, status: outcome.isError ? 'error' : 'done', summary: outcome.summary });
      if (outcome.scene) {
        scenes.push(outcome.scene);
        await input.emit({ type: 'scene', scene: outcome.scene });
      }
      results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(outcome.isError ? { is_error: true } : {}) });
    }
    appended.push({ role: 'assistant', content: message.content }, { role: 'user', content: results });
  }
  return fail('max_iterations', 'The agent needed too many steps to answer.');
};
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS. If `Anthropic.APIError`'s constructor signature differs in 0.129, build the error in the test with the SDK's actual constructor (check `node_modules/@anthropic-ai/sdk/core/error.d.ts`) and ledger it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add the streaming agent loop with tool execution and scene validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Configuration, conversation routes and SSE streaming

**Files:**
- Create: `apps/api/src/routes/agent.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/http/deps.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/helpers.ts`, `apps/api/test/health.test.ts`
- Test: `apps/api/test/agentRoutes.integration.test.ts`

**Interfaces:**
- Config: `agent: { enabled: boolean; fake: boolean; model: string; monthlyTokenBudget: number }` from `AGENT_ENABLED` (default `false`), `RDI_FAKE_LLM` (default `false`, ignored in production), `AGENT_MODEL` (default `claude-opus-5`), `AGENT_MONTHLY_TOKEN_BUDGET` (default `2000000`), plus `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` presence.
- Deps: `llm?: LlmClient | null`. Test helper option `llm?: LlmClient | null`.
- Routes:
  - `GET /api/orgs/:orgId/agent` → `{ enabled, model, tokensUsed, tokenBudget }`
  - `GET /api/orgs/:orgId/conversations` → `[{ id, title, updatedAt }]`
  - `POST /api/orgs/:orgId/conversations` → 201 `{ id, title, updatedAt }`
  - `GET /api/orgs/:orgId/conversations/:id` → `{ id, title, items: [{ role, text, turn }], scenes: [{ id, turn, scene }] }`
  - `POST /api/orgs/:orgId/conversations/:id/messages {text, language?, focus?}` → `text/event-stream` with events `text`, `tool`, `scene` (`{ id, scene }`), `error`, `done` (`{ sceneIds, usage }`) · 409 `agent_not_configured` · 429 `token_budget_exceeded` / `rate_limited` · 404
- Constants: `AGENT_RATE_LIMIT = 20` per 60 s per user; `TITLE_LENGTH = 60`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/health.test.ts` add to the exact `loadConfig({})` expectation:
```ts
      agent: { enabled: false, fake: false, model: 'claude-opus-5', monthlyTokenBudget: 2_000_000 },
```
and append:
```ts
  it('enables the agent from credentials and never uses the fake model in production', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: 'k' }).agent.enabled).toBe(true);
    expect(loadConfig({ AGENT_ENABLED: 'true', AGENT_MODEL: 'claude-sonnet-5' }).agent).toMatchObject({ enabled: true, model: 'claude-sonnet-5' });
    expect(loadConfig({ RDI_FAKE_LLM: 'true' }).agent).toMatchObject({ enabled: true, fake: true });
    expect(loadConfig({ NODE_ENV: 'production', RDI_FAKE_LLM: 'true' }).agent).toMatchObject({ enabled: false, fake: false });
  });
```

In `apps/api/test/helpers.ts` extend the options to `{ github?; githubClient?; llm?: LlmClient | null }` (import `type { LlmClient } from '../src/agent/llm'`) and pass `llm: options.llm ?? null` in the `buildApp` deps.

`apps/api/test/agentRoutes.integration.test.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { buildRepoGraph, detect, parseRepository, walkRepository } from '@rdi/indexer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeLlm } from '../src/agent/fakeLlm';
import type { LlmClient } from '../src/agent/llm';
import { addUsage, currentMonth } from '../src/db/queries/agent';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
let ctx: TestContext;
let disabled: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ llm: createFakeLlm() });
  disabled = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(async () => {
  await ctx.close();
  await disabled.close();
});

type Who = Awaited<ReturnType<typeof signupVerified>>;
const setup = async (c: TestContext = ctx) => {
  const owner = await signupVerified(c);
  const org = (await c.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};
const indexApi = async (orgId: string) => {
  const repoId = (await ctx.pool.query<{ id: string }>("insert into repos (org_id, full_name, status) values ($1, 'acme-demo/shop-api', 'ready') returning id", [orgId])).rows[0]!.id;
  const walk = await walkRepository(`${FIXTURES}/shop-api`);
  const facts = await parseRepository(walk.files);
  await ctx.graph.commitRepoGraph(orgId, repoId, buildRepoGraph({ orgId, repoId, fullName: 'acme-demo/shop-api', walk, facts, detections: detect(facts) }), [repoId]);
  return repoId;
};
const newConversation = async (who: Who, orgId: string, c: TestContext = ctx) =>
  (await c.app.inject({ method: 'POST', url: `/api/orgs/${orgId}/conversations`, headers: authed(who), payload: {} })).json();
const ask = (who: Who, orgId: string, id: string, payload: object, c: TestContext = ctx) =>
  c.app.inject({ method: 'POST', url: `/api/orgs/${orgId}/conversations/${id}/messages`, headers: authed(who), payload });
const events = (body: string) =>
  body.split('\n\n').filter(Boolean).map((chunk) => {
    const [eventLine, dataLine] = chunk.split('\n');
    return { event: eventLine!.replace('event: ', ''), data: JSON.parse(dataLine!.replace('data: ', '')) };
  });

describe('agent status', () => {
  it('reports whether the agent is configured and the token budget', async () => {
    const { owner, org } = await setup();
    await addUsage(ctx.pool, org.id, currentMonth(new Date()), 1000, 200);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/agent`, headers: { cookie: owner.cookie } })).json()).toEqual({ enabled: true, model: 'fake-scripted', tokensUsed: 1200, tokenBudget: 2_000_000 });
    const off = await setup(disabled);
    expect((await disabled.app.inject({ method: 'GET', url: `/api/orgs/${off.org.id}/agent`, headers: { cookie: off.owner.cookie } })).json()).toMatchObject({ enabled: false });
    const conv = await newConversation(off.owner, off.org.id, disabled);
    expect((await ask(off.owner, off.org.id, conv.id, { text: 'hi' }, disabled)).json()).toEqual({ error: { code: 'agent_not_configured' } });
  });
});

describe('chatting', () => {
  it('streams tool progress, a validated scene and the answer, and persists the turn', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    expect(conv.title).toBe('New conversation');
    const res = await ask(owner, org.id, conv.id, { text: 'orders', language: 'es' });
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    const stream = events(res.body);
    expect(stream.map((e) => e.event)).toEqual(['tool', 'tool', 'tool', 'tool', 'scene', 'text', 'done']);
    const scene = stream.find((e) => e.event === 'scene')!.data;
    expect(scene.scene.language).toBe('es');
    expect(stream.at(-1)!.data).toMatchObject({ sceneIds: [scene.id], usage: { input: 300, output: 60 } });

    const detail = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/conversations/${conv.id}`, headers: { cookie: owner.cookie } })).json();
    expect(detail.title).toBe('orders');
    expect(detail.items).toEqual([{ role: 'user', text: 'orders', turn: 1 }, { role: 'assistant', text: expect.stringMatching(/^Here is how it fits together/), turn: 1 }]);
    expect(detail.scenes).toEqual([{ id: scene.id, turn: 1, scene: scene.scene }]);
    const list = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/conversations`, headers: { cookie: owner.cookie } })).json();
    expect(list).toEqual([{ id: conv.id, title: 'orders', updatedAt: expect.any(String) }]);
    const status = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/agent`, headers: { cookie: owner.cookie } })).json();
    expect(status.tokensUsed).toBe(360);
  });

  it('never lets another user read or write a conversation', async () => {
    const { owner, org } = await setup();
    const conv = await newConversation(owner, org.id);
    const other = await signupVerified(ctx);
    await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/invitations`, headers: authed(owner), payload: { email: other.email, role: 'member' } });
    const stranger = await setup();
    for (const who of [other, stranger.owner]) {
      expect((await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/conversations/${conv.id}`, headers: { cookie: who.cookie } })).statusCode).toBe(404);
      expect((await ask(who, org.id, conv.id, { text: 'hi' })).statusCode).toBe(404);
    }
    expect((await ask(stranger.owner, stranger.org.id, conv.id, { text: 'hi' })).statusCode).toBe(404);
  });

  it('refuses when the monthly token budget is exhausted', async () => {
    const { owner, org } = await setup();
    await addUsage(ctx.pool, org.id, currentMonth(new Date()), 2_000_000, 0);
    const conv = await newConversation(owner, org.id);
    expect((await ask(owner, org.id, conv.id, { text: 'hi' })).json()).toEqual({ error: { code: 'token_budget_exceeded' } });
  });

  it('persists only complete tool pairs when the model fails mid-turn', async () => {
    let calls = 0;
    const failing: LlmClient = {
      model: 'failing',
      async turn(input) {
        calls++;
        if (calls === 1) return createFakeLlm().turn(input);
        throw new (await import('@anthropic-ai/sdk')).default.APIError(500, undefined, 'boom', new Headers());
      },
    };
    const local = await createTestContext({ llm: failing });
    try {
      const { owner, org } = await setup(local);
      const conv = await newConversation(owner, org.id, local);
      const stream = events((await ask(owner, org.id, conv.id, { text: 'orders' }, local)).body);
      expect(stream.map((e) => e.event)).toContain('error');
      expect(stream.at(-1)!.event).toBe('done');
      const rows = (await local.pool.query<{ role: string; content: { type: string }[] }>('select role, content from conversation_messages where conversation_id = $1 order by id', [conv.id])).rows;
      expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'user']);
      expect(rows[2]!.content.every((b) => b.type === 'tool_result')).toBe(true);
    } finally {
      await local.close();
    }
  });
});
```

Run: `npm test -w @rdi/api; npm run test:integration -w @rdi/api -- agentRoutes`
Expected: FAIL — config lacks `agent`, routes missing.

- [ ] **Step 2: Implement**

`apps/api/src/config.ts`:
- `Config` gains `agent: { enabled: boolean; fake: boolean; model: string; monthlyTokenBudget: number };`
- `DEFAULTS` gains `AGENT_ENABLED: 'false', RDI_FAKE_LLM: 'false', AGENT_MODEL: 'claude-opus-5', AGENT_MONTHLY_TOKEN_BUDGET: '2000000',`
- the returned object gains:
```ts
    agent: readAgent(env, production, read),
```
with, above `loadConfig`:
```ts
const readAgent = (env: NodeJS.ProcessEnv, production: boolean, read: (key: keyof typeof DEFAULTS) => string): Config['agent'] => {
  const fake = !production && read('RDI_FAKE_LLM') === 'true';
  const credentials = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  return { enabled: fake || credentials || read('AGENT_ENABLED') === 'true', fake, model: read('AGENT_MODEL'), monthlyTokenBudget: Number(read('AGENT_MONTHLY_TOKEN_BUDGET')) };
};
```

`apps/api/src/http/deps.ts`: add `import type { LlmClient } from '../agent/llm';` and `llm?: LlmClient | null` to `AppDeps`.

`apps/api/src/routes/agent.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { questionOf, SYSTEM_PROMPT, userTurn } from '../agent/prompt';
import { runAgent, type AgentEvent } from '../agent/runAgent';
import type { ToolContext } from '../agent/tools';
import { createRateLimiter } from '../auth/rateLimit';
import {
  addUsage, appendMessages, createConversation, currentMonth, DEFAULT_CONVERSATION_TITLE, findConversation, findRepoInstallation, getUsage,
  insertScene, listConversations, listConversationScenes, listMessages, readSource, renameConversation, type ConversationRow,
} from '../db/queries/agent';
import { listRepos } from '../db/queries/repos';
import { fail, isUuid, requireAuth, requireMember } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';

export const AGENT_RATE_LIMIT = 20;
const AGENT_RATE_WINDOW_SECONDS = 60;
const TITLE_LENGTH = 60;
const MAX_QUESTION = 4000;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const askBody = z.object({
  text: z.string().trim().min(1).max(MAX_QUESTION),
  language: z.string().regex(LANGUAGE_TAG).optional(),
  focus: z.object({ label: z.string().min(1).max(200), graphRef: z.string().min(1).max(500) }).nullish(),
});

const publicConversation = (c: ConversationRow) => ({ id: c.id, title: c.title, updatedAt: c.updated_at.toISOString() });
type Stored = { role: 'user' | 'assistant'; content: unknown };

const itemsOf = (messages: Stored[]) => {
  const items: { role: 'user' | 'assistant'; text: string; turn: number }[] = [];
  let turn = 0;
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as { type: string; text?: string }[]);
    if (m.role === 'user') {
      if (blocks.some((b) => b.type === 'tool_result')) continue;
      turn += 1;
      items.push({ role: 'user', text: questionOf(m) ?? '', turn });
      continue;
    }
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (text) items.push({ role: 'assistant', text, turn });
  }
  return { items, turns: turn };
};

export const agentRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const limiter = createRateLimiter(deps.redis, deps.config.rateLimitPrefix);

  const tokensUsed = async (orgId: string) => {
    const usage = await getUsage(deps.pool, orgId, currentMonth(nowOf(deps)));
    return usage.input + usage.output;
  };
  const ownConversation = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const conversation = isUuid(id) ? await findConversation(deps.pool, req.member!.org.id, req.auth!.user.id, id) : null;
    if (!conversation) {
      fail(reply, 404, 'not_found');
      return null;
    }
    return conversation;
  };

  api.get('/orgs/:orgId/agent', { preHandler: member }, async (req) => ({
    enabled: Boolean(deps.llm),
    model: deps.llm?.model ?? deps.config.agent.model,
    tokensUsed: await tokensUsed(req.member!.org.id),
    tokenBudget: deps.config.agent.monthlyTokenBudget,
  }));

  api.get('/orgs/:orgId/conversations', { preHandler: member }, async (req) =>
    (await listConversations(deps.pool, req.member!.org.id, req.auth!.user.id)).map(publicConversation));

  api.post('/orgs/:orgId/conversations', { preHandler: member }, async (req, reply) =>
    reply.code(201).send(publicConversation(await createConversation(deps.pool, { orgId: req.member!.org.id, userId: req.auth!.user.id }))));

  api.get('/orgs/:orgId/conversations/:id', { preHandler: member }, async (req, reply) => {
    const conversation = await ownConversation(req, reply);
    if (!conversation) return reply;
    const { items } = itemsOf(await listMessages(deps.pool, conversation.id));
    const scenes = (await listConversationScenes(deps.pool, conversation.id)).map((s) => ({ id: s.id, turn: s.turn, scene: s.scene }));
    return { ...publicConversation(conversation), items, scenes };
  });

  api.post('/orgs/:orgId/conversations/:id/messages', { preHandler: member }, async (req, reply) => {
    const body = askBody.parse(req.body);
    const conversation = await ownConversation(req, reply);
    if (!conversation) return reply;
    const llm = deps.llm;
    if (!llm) return fail(reply, 409, 'agent_not_configured');
    const orgId = req.member!.org.id;
    if (deps.config.rateLimitsEnabled) {
      const hit = await limiter.hit(`agent:${req.auth!.user.id}`, AGENT_RATE_LIMIT, AGENT_RATE_WINDOW_SECONDS);
      if (!hit.allowed) return fail(reply, 429, 'rate_limited', { retryAfter: hit.retryAfter });
    }
    if ((await tokensUsed(orgId)) >= deps.config.agent.monthlyTokenBudget) return fail(reply, 429, 'token_budget_exceeded');

    const history = (await listMessages(deps.pool, conversation.id)) as Anthropic.Beta.BetaMessageParam[];
    const turn = itemsOf(history as Stored[]).turns + 1;
    const language = body.language ?? req.auth!.user.explanation_language ?? req.member!.org.default_explanation_language;
    const repos = (await listRepos(deps.pool, orgId)).filter((r) => r.status === 'ready').map((r) => r.full_name);
    const user = userTurn(body.text, { language, focus: body.focus ?? null, repos });

    let graph: ReturnType<ToolContext['loadGraph']> | null = null;
    const toolContext: ToolContext = {
      loadGraph: () => (graph ??= deps.graph ? deps.graph.readOrgGraph(orgId) : Promise.resolve({ nodes: [], edges: [] })),
      readSource: (repo, path) => readSource(deps.pool, orgId, repo, path),
      prFiles: async (repo, number) => {
        const installation = await findRepoInstallation(deps.pool, orgId, repo);
        return installation !== null && deps.github ? deps.github.listPullFiles(installation, repo, number) : null;
      },
    };

    const controller = new AbortController();
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const send = (event: string, data: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const sceneIds: string[] = [];
    const emit = async (event: AgentEvent) => {
      if (event.type === 'scene') {
        const row = await insertScene(deps.pool, { orgId, conversationId: conversation.id, sourceSceneId: null, turn, scene: event.scene });
        sceneIds.push(row.id);
        send('scene', { id: row.id, scene: event.scene });
        return;
      }
      const { type, ...data } = event;
      send(type, data);
    };

    const result = await runAgent({ llm, system: SYSTEM_PROMPT, history, user, ctx: toolContext, emit, signal: controller.signal });
    await appendMessages(deps.pool, conversation.id, [user, ...result.appended] as Stored[]);
    if (conversation.title === DEFAULT_CONVERSATION_TITLE) await renameConversation(deps.pool, conversation.id, body.text.slice(0, TITLE_LENGTH));
    await addUsage(deps.pool, orgId, currentMonth(nowOf(deps)), result.usage.input, result.usage.output);
    send('done', { sceneIds, usage: result.usage });
    reply.raw.end();
    return reply;
  });
};
```

In `apps/api/src/app.ts` import `agentRoutes` and register it after `codeRoutes(api, deps);`:
```ts
        agentRoutes(api, deps);
```

In `apps/api/src/server.ts` import `createAnthropicLlm` and `createFakeLlm`, build the client and pass it in deps:
```ts
const llm = config.agent.fake ? createFakeLlm() : config.agent.enabled ? createAnthropicLlm(config.agent.model) : null;
// deps: { config, pool, redis, mailer, graph, indexQueue, github, llm }
```
and log the agent mode after listening:
```ts
console.log(`agent: ${llm ? llm.model : 'disabled (set ANTHROPIC_API_KEY or AGENT_ENABLED=true)'}`);
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add conversations with streaming agent answers over SSE

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Regenerate a scene in another language

**Files:**
- Create: `apps/api/src/agent/translate.ts`
- Modify: `apps/api/src/routes/agent.ts`
- Test: `apps/api/test/agent/translate.test.ts`, `apps/api/test/agentRoutes.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  sameStructure(a: Scene, b: Scene): string[]          // [] when ids, roles, parents, edges, step tree and risks match
  TRANSLATE_SYSTEM: string; MAX_TRANSLATE_ATTEMPTS = 3
  class TranslateError extends Error
  translateScene(llm: LlmClient, scene: Scene, language: string): Promise<{ scene: Scene; usage: { input: number; output: number } }>
  // route
  POST /api/orgs/:orgId/scenes/:sceneId/translate {language} → 201 { id, scene } ; sceneId is a stored scene uuid or "system-map" · 404 · 409 agent_not_configured · 422 translation_failed · 429
  ```

- [ ] **Step 1: Write the failing tests**

`apps/api/test/agent/translate.test.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import { sampleRegistry, type Scene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../../src/agent/llm';
import { MAX_TRANSLATE_ATTEMPTS, sameStructure, translateScene, TranslateError } from '../../src/agent/translate';

const base = sampleRegistry['checkout-en']!;
const reply = (input: unknown) =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', stop_sequence: null, content: [{ type: 'tool_use', id: 't', name: 'emit_scene', input }], usage: { input_tokens: 7, output_tokens: 3 } }) as unknown as Anthropic.Beta.BetaMessage;
const llmReturning = (...outputs: unknown[]): LlmClient & { calls: number } => {
  const client = { model: 'x', calls: 0, async turn() { client.calls++; return reply(outputs.shift()); } };
  return client;
};
const translated = (scene: Scene, language: string): Scene => ({ ...scene, language, title: `${scene.title} (${language})`, nodes: scene.nodes.map((n) => ({ ...n, summary: `[${language}] ${n.summary}` })) });

describe('sameStructure', () => {
  it('accepts text-only changes and reports structural ones', () => {
    expect(sameStructure(base, translated(base, 'es'))).toEqual([]);
    const moved = { ...base, edges: base.edges.map((e, i) => (i === 0 ? { ...e, to: base.nodes[0]!.id } : e)) };
    expect(sameStructure(base, moved)).toEqual([expect.stringMatching(/^edges differ/)]);
    expect(sameStructure(base, { ...base, nodes: base.nodes.slice(1) })).toEqual([expect.stringMatching(/^nodes differ/)]);
  });
});

describe('translateScene', () => {
  it('returns the translated scene and usage', async () => {
    const llm = llmReturning(translated(base, 'es'));
    const result = await translateScene(llm, base, 'es');
    expect(result.scene.language).toBe('es');
    expect(result.usage).toEqual({ input: 7, output: 3 });
  });

  it('retries structural changes and invalid scenes, then gives up', async () => {
    const bad = { ...translated(base, 'es'), nodes: base.nodes.slice(1) };
    const recovering = llmReturning(bad, { id: 'x' }, translated(base, 'es'));
    expect((await translateScene(recovering, base, 'es')).scene.language).toBe('es');
    expect(recovering.calls).toBe(3);
    const hopeless = llmReturning(...Array.from({ length: MAX_TRANSLATE_ATTEMPTS }, () => bad));
    await expect(translateScene(hopeless, base, 'es')).rejects.toBeInstanceOf(TranslateError);
  });

  it('rejects a result in the wrong language', async () => {
    const llm = llmReturning(...Array.from({ length: MAX_TRANSLATE_ATTEMPTS }, () => translated(base, 'pt')));
    await expect(translateScene(llm, base, 'es')).rejects.toBeInstanceOf(TranslateError);
  });
});
```

Append to `apps/api/test/agentRoutes.integration.test.ts`:
```ts
describe('translating scenes', () => {
  it('stores a translated copy of a conversation scene and of the system map', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    const original = events((await ask(owner, org.id, conv.id, { text: 'orders' })).body).find((e) => e.event === 'scene')!.data;
    const res = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/scenes/${original.id}/translate`, headers: authed(owner), payload: { language: 'pt' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().scene).toMatchObject({ id: original.scene.id, language: 'pt' });
    const row = (await ctx.pool.query('select source_scene_id, conversation_id from scenes where id = $1', [res.json().id])).rows[0];
    expect(row).toEqual({ source_scene_id: original.id, conversation_id: conv.id });
    const map = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/scenes/system-map/translate`, headers: authed(owner), payload: { language: 'es' } });
    expect(map.json().scene).toMatchObject({ id: 'system-map', language: 'es' });
  });

  it('never translates another organization’s scene', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    const original = events((await ask(owner, org.id, conv.id, { text: 'orders' })).body).find((e) => e.event === 'scene')!.data;
    const stranger = await setup();
    const res = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${stranger.org.id}/scenes/${original.id}/translate`, headers: authed(stranger.owner), payload: { language: 'es' } });
    expect(res.statusCode).toBe(404);
  });
});
```

Run: `npm test -w @rdi/api -- agent/translate; npm run test:integration -w @rdi/api -- agentRoutes`
Expected: FAIL — module and route missing.

- [ ] **Step 2: Implement**

`apps/api/src/agent/translate.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import { validateScene, type Scene, type Step } from '@rdi/scene';
import { TRANSLATE_MARKER } from './fakeLlm';
import type { LlmClient } from './llm';
import { toolDefinitions } from './tools';

export const MAX_TRANSLATE_ATTEMPTS = 3;
export const TRANSLATE_SYSTEM = [
  'You translate Repository Designer scenes.',
  'Translate every human-readable text (title, summary, labels, kinds, summaries, details, narration, annotations, payload text that is prose, risk titles, explanations and mitigations, scale notes and advice) into the target language.',
  'Keep every id, role, parent, repo, edge endpoint and kind, step order and structure, graphRef, code reference and JSON payload value exactly as they are. Set language to the target language tag.',
  'Return the result by calling emit_scene once with the complete translated scene.',
].join('\n');

export class TranslateError extends Error {}

const emitSceneTool = toolDefinitions.filter((t) => t.name === 'emit_scene');

const stepShape = (steps: Step[]): unknown => steps.map((s) => [s.id, s.focus, s.travel?.edgeId ?? null, s.expand ?? null, stepShape(s.substeps)]);

export const sameStructure = (a: Scene, b: Scene): string[] => {
  const checks: [string, unknown, unknown][] = [
    ['nodes', a.nodes.map((n) => [n.id, n.role, n.parent ?? null]), b.nodes.map((n) => [n.id, n.role, n.parent ?? null])],
    ['edges', a.edges.map((e) => [e.id, e.from, e.to, e.kind]), b.edges.map((e) => [e.id, e.from, e.to, e.kind])],
    ['steps', stepShape(a.steps), stepShape(b.steps)],
    ['risks', a.risks.map((r) => [r.id, r.category, r.severity, r.nodeIds]), b.risks.map((r) => [r.id, r.category, r.severity, r.nodeIds])],
    ['id', a.id, b.id],
  ];
  return checks.filter(([, x, y]) => JSON.stringify(x) !== JSON.stringify(y)).map(([name]) => `${name} differ from the original`);
};

export const translateScene = async (llm: LlmClient, scene: Scene, language: string): Promise<{ scene: Scene; usage: { input: number; output: number } }> => {
  const usage = { input: 0, output: 0 };
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `${TRANSLATE_MARKER} ${language}\n\n${JSON.stringify(scene)}` }];
  for (let attempt = 0; attempt < MAX_TRANSLATE_ATTEMPTS; attempt++) {
    const message = await llm.turn({ system: TRANSLATE_SYSTEM, messages, tools: emitSceneTool });
    usage.input += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
    usage.output += message.usage.output_tokens;
    const call = message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'emit_scene');
    if (!call) {
      messages.push({ role: 'assistant', content: message.content }, { role: 'user', content: 'Call emit_scene with the translated scene.' });
      continue;
    }
    const result = validateScene(call.input);
    const problems = result.ok ? [...sameStructure(scene, result.scene), ...(result.scene.language === language ? [] : [`language must be "${language}"`])] : result.errors;
    if (result.ok && problems.length === 0) return { scene: result.scene, usage };
    messages.push(
      { role: 'assistant', content: message.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Fix these problems and call emit_scene again:\n${problems.join('\n')}` }] },
    );
  }
  throw new TranslateError(`translation failed after ${MAX_TRANSLATE_ATTEMPTS} attempts`);
};
```

In `apps/api/src/routes/agent.ts`, import `buildSystemMap`, `SYSTEM_MAP_ID` from `@rdi/indexer`, `validateScene` from `@rdi/scene`, `findScene` from the agent queries and `translateScene`, `TranslateError` from `../agent/translate`, then add inside `agentRoutes`:
```ts
  api.post('/orgs/:orgId/scenes/:sceneId/translate', { preHandler: member }, async (req, reply) => {
    const { language } = z.object({ language: z.string().regex(LANGUAGE_TAG) }).parse(req.body);
    const { sceneId } = req.params as { sceneId: string };
    const orgId = req.member!.org.id;
    let source: { id: string | null; conversationId: string | null; turn: number; scene: unknown } | null = null;
    if (sceneId === SYSTEM_MAP_ID) {
      const map = deps.graph ? buildSystemMap(await deps.graph.readOrgGraph(orgId)) : null;
      source = map ? { id: null, conversationId: null, turn: 0, scene: map } : null;
    } else if (isUuid(sceneId)) {
      const row = await findScene(deps.pool, orgId, sceneId);
      source = row ? { id: row.id, conversationId: row.conversation_id, turn: row.turn, scene: row.scene } : null;
    }
    const valid = source ? validateScene(source.scene) : null;
    if (!source || !valid?.ok) return fail(reply, 404, 'not_found');
    const llm = deps.llm;
    if (!llm) return fail(reply, 409, 'agent_not_configured');
    if (deps.config.rateLimitsEnabled) {
      const hit = await limiter.hit(`agent:${req.auth!.user.id}`, AGENT_RATE_LIMIT, AGENT_RATE_WINDOW_SECONDS);
      if (!hit.allowed) return fail(reply, 429, 'rate_limited', { retryAfter: hit.retryAfter });
    }
    if ((await tokensUsed(orgId)) >= deps.config.agent.monthlyTokenBudget) return fail(reply, 429, 'token_budget_exceeded');
    try {
      const { scene, usage } = await translateScene(llm, valid.scene, language);
      await addUsage(deps.pool, orgId, currentMonth(nowOf(deps)), usage.input, usage.output);
      const row = await insertScene(deps.pool, { orgId, conversationId: source.conversationId, sourceSceneId: source.id, turn: source.turn, scene });
      return reply.code(201).send({ id: row.id, scene });
    } catch (error) {
      if (error instanceof TranslateError) return fail(reply, 422, 'translation_failed');
      throw error;
    }
  });
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): regenerate scenes in another language with structure checks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Web streaming chat client

**Files:**
- Create: `apps/web/src/shell/chat/chatApi.ts`
- Modify: `apps/web/src/shell/api.ts`
- Test: `apps/web/test/shell/chatApi.test.ts`

**Interfaces:**
- Produces:
  ```ts
  getCsrfToken(): string | null                          // api.ts
  type SseMessage = { event: string; data: string }
  parseSse(buffer: string): { messages: SseMessage[]; rest: string }
  type ChatEvent =
    | { type: 'text'; delta: string } | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
    | { type: 'scene'; id: string; scene: unknown } | { type: 'error'; code: string; message: string }
    | { type: 'done'; sceneIds: string[]; usage: { input: number; output: number } }
  type AskBody = { text: string; language?: string; focus?: { label: string; graphRef: string } | null }
  streamChat(orgId: string, conversationId: string, body: AskBody, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/shell/chatApi.test.ts`:
```ts
import { ApiError, setCsrfToken } from '../../src/shell/api';
import { parseSse, streamChat, type ChatEvent } from '../../src/shell/chat/chatApi';

const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });

describe('parseSse', () => {
  it('parses complete messages and keeps the incomplete rest', () => {
    expect(parseSse('event: text\ndata: {"delta":"a"}\n\nevent: tool\ndata: {"x":1}\n\nevent: te')).toEqual({
      messages: [{ event: 'text', data: '{"delta":"a"}' }, { event: 'tool', data: '{"x":1}' }],
      rest: 'event: te',
    });
    expect(parseSse('event: done\r\ndata: {}\r\n\r\n')).toEqual({ messages: [{ event: 'done', data: '{}' }], rest: '' });
  });
});

describe('streamChat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts with the CSRF token and dispatches events split across chunks', async () => {
    setCsrfToken('tok');
    const fetchMock = vi.fn().mockResolvedValue(new Response(streamOf(['event: text\ndata: {"delta":"Hel', 'lo"}\n\nevent: done\ndata: {"sceneIds":[],"usage":{"input":1,"output":2}}\n\n']), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const events: ChatEvent[] = [];
    await streamChat('o1', 'c1', { text: 'hi', language: 'es' }, (e) => events.push(e));
    expect(fetchMock).toHaveBeenCalledWith('/api/orgs/o1/conversations/c1/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'hi', language: 'es' }) }));
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ 'x-csrf-token': 'tok', 'content-type': 'application/json' });
    expect(events).toEqual([{ type: 'text', delta: 'Hello' }, { type: 'done', sceneIds: [], usage: { input: 1, output: 2 } }]);
  });

  it('throws API errors for non-stream responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'agent_not_configured' } }), { status: 409 })));
    await expect(streamChat('o1', 'c1', { text: 'hi' }, () => {})).rejects.toEqual(new ApiError(409, 'agent_not_configured'));
  });
});
```

Run: `npm test -w @rdi/web -- chatApi`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

In `apps/web/src/shell/api.ts` add:
```ts
export const getCsrfToken = (): string | null => csrfToken;
```

`apps/web/src/shell/chat/chatApi.ts`:
```ts
import { ApiError, getCsrfToken } from '../api';

export type SseMessage = { event: string; data: string };
export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
  | { type: 'scene'; id: string; scene: unknown }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; sceneIds: string[]; usage: { input: number; output: number } };
export type AskBody = { text: string; language?: string; focus?: { label: string; graphRef: string } | null };

const SEPARATOR = /\r?\n\r?\n/;
const EVENT_TYPES = new Set(['text', 'tool', 'scene', 'error', 'done']);

export const parseSse = (buffer: string): { messages: SseMessage[]; rest: string } => {
  const parts = buffer.split(SEPARATOR);
  const rest = parts.pop() ?? '';
  const messages = parts.filter(Boolean).map((part) => {
    const lines = part.split(/\r?\n/);
    const event = lines.find((l) => l.startsWith('event:'))?.slice('event:'.length).trim() ?? 'message';
    const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice('data:'.length).trim()).join('\n');
    return { event, data };
  });
  return { messages, rest };
};

export const streamChat = async (orgId: string, conversationId: string, body: AskBody, onEvent: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void> => {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
  const csrf = getCsrfToken();
  if (csrf) headers['x-csrf-token'] = csrf;
  const response = await fetch(`/api/orgs/${orgId}/conversations/${conversationId}/messages`, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(response.status, data?.error?.code ?? 'unknown');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { messages, rest } = parseSse(buffer);
    buffer = rest;
    for (const m of messages) {
      if (EVENT_TYPES.has(m.event)) onEvent({ type: m.event, ...(JSON.parse(m.data) as object) } as ChatEvent);
    }
  }
};
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add the streaming chat client

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Chat panel in the workspace

**Files:**
- Create: `apps/web/src/shell/chat/ChatPanel.tsx`
- Modify: `apps/web/src/workspace/Workspace.tsx`, `apps/web/src/workspace/panels/ExplorerPanel.tsx`, `apps/web/src/workspace/workspace.css`, `apps/web/src/shell/pages/ExplorePage.tsx`, `apps/web/src/i18n/shellMessages.ts`, `apps/web/test/shell/explore.test.tsx` (mock signature)
- Test: `apps/web/test/shell/chatPanel.test.tsx`, `apps/web/test/workspace/chatSidebar.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // Workspace
  type ChatContext = { openScene(scene: Scene): void; selected: { label: string; graphRef: string } | null; scene: Scene }
  WorkspaceProps.chat?: (ctx: ChatContext) => ReactNode
  // ChatPanel
  ChatPanel({ orgId, ctx, language }: { orgId: string; ctx: ChatContext; language: string })
  ```
  Testids: `activity-chat`, `chat-panel`, `chat-input`, `chat-send`, `chat-message-<i>`, `chat-tool`, `chat-scene-<sceneId>`, `chat-open-<sceneId>`, `chat-translate-<sceneId>`, `chat-ask-about`, `chat-disabled`, `chat-error`, `chat-new`, `chat-conversations`.

- [ ] **Step 1: Catalog keys**

Add to `shellEn`:
```ts
  'chat.title': 'Ask about your system',
  'chat.placeholder': 'Ask how something works, what a change affects, where the risks are…',
  'chat.send': 'Send',
  'chat.new': 'New conversation',
  'chat.conversations': 'Conversations',
  'chat.thinking': 'Working…',
  'chat.askAbout': 'Ask about {label}',
  'chat.scene': 'Scene: {title}',
  'chat.open': 'Open',
  'chat.translate': 'Regenerate in {language}',
  'chat.disabled': 'The agent is not configured on this server. Set ANTHROPIC_API_KEY to enable it.',
  'chat.empty': 'Ask a question and the answer will be animated on the canvas.',
  'errors.agent_not_configured': 'The agent is not configured on this server.',
  'errors.token_budget_exceeded': 'Your organization used its agent budget for this month.',
  'errors.rate_limited': 'Too many requests. Wait a moment and try again.',
  'errors.translation_failed': 'The scene could not be translated. Try again.',
  'errors.refusal': 'The model declined to answer this request.',
  'errors.max_tokens': 'The answer was too long and was cut off.',
  'errors.max_iterations': 'The agent needed too many steps to answer.',
  'errors.llm_error': 'The model is unavailable right now. Try again.',
  'errors.aborted': 'The answer was cancelled.',
```
Add to `shellEs`:
```ts
  'chat.title': 'Preguntá sobre tu sistema',
  'chat.placeholder': 'Preguntá cómo funciona algo, qué afecta un cambio, dónde están los riesgos…',
  'chat.send': 'Enviar',
  'chat.new': 'Nueva conversación',
  'chat.conversations': 'Conversaciones',
  'chat.thinking': 'Trabajando…',
  'chat.askAbout': 'Preguntar sobre {label}',
  'chat.scene': 'Escena: {title}',
  'chat.open': 'Abrir',
  'chat.translate': 'Regenerar en {language}',
  'chat.disabled': 'El agente no está configurado en este servidor. Definí ANTHROPIC_API_KEY para habilitarlo.',
  'chat.empty': 'Hacé una pregunta y la respuesta se va a animar en el canvas.',
  'errors.agent_not_configured': 'El agente no está configurado en este servidor.',
  'errors.token_budget_exceeded': 'Tu organización usó el presupuesto del agente de este mes.',
  'errors.rate_limited': 'Demasiadas solicitudes. Esperá un momento y volvé a intentar.',
  'errors.translation_failed': 'No se pudo traducir la escena. Volvé a intentar.',
  'errors.refusal': 'El modelo se negó a responder este pedido.',
  'errors.max_tokens': 'La respuesta fue demasiado larga y se cortó.',
  'errors.max_iterations': 'El agente necesitó demasiados pasos para responder.',
  'errors.llm_error': 'El modelo no está disponible ahora. Volvé a intentar.',
  'errors.aborted': 'Se canceló la respuesta.',
```
Add to `shellPt`:
```ts
  'chat.title': 'Pergunte sobre o seu sistema',
  'chat.placeholder': 'Pergunte como algo funciona, o que uma mudança afeta, onde estão os riscos…',
  'chat.send': 'Enviar',
  'chat.new': 'Nova conversa',
  'chat.conversations': 'Conversas',
  'chat.thinking': 'Trabalhando…',
  'chat.askAbout': 'Perguntar sobre {label}',
  'chat.scene': 'Cena: {title}',
  'chat.open': 'Abrir',
  'chat.translate': 'Regenerar em {language}',
  'chat.disabled': 'O agente não está configurado neste servidor. Defina ANTHROPIC_API_KEY para habilitá-lo.',
  'chat.empty': 'Faça uma pergunta e a resposta será animada no canvas.',
  'errors.agent_not_configured': 'O agente não está configurado neste servidor.',
  'errors.token_budget_exceeded': 'Sua organização usou o orçamento do agente deste mês.',
  'errors.rate_limited': 'Muitas solicitações. Aguarde um momento e tente novamente.',
  'errors.translation_failed': 'Não foi possível traduzir a cena. Tente novamente.',
  'errors.refusal': 'O modelo se recusou a responder este pedido.',
  'errors.max_tokens': 'A resposta foi longa demais e foi cortada.',
  'errors.max_iterations': 'O agente precisou de passos demais para responder.',
  'errors.llm_error': 'O modelo não está disponível agora. Tente novamente.',
  'errors.aborted': 'A resposta foi cancelada.',
```
If any `errors.*` key already exists (for example `errors.rate_limited`), keep the existing one and skip the duplicate.

- [ ] **Step 2: Write the failing tests**

`apps/web/test/shell/chatPanel.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { apiFetch } from '../../src/shell/api';
import { ChatPanel } from '../../src/shell/chat/ChatPanel';
import { streamChat, type ChatEvent } from '../../src/shell/chat/chatApi';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/shell/chat/chatApi', async (original) => ({ ...(await original<typeof import('../../src/shell/chat/chatApi')>()), streamChat: vi.fn() }));
const api = vi.mocked(apiFetch);
const stream = vi.mocked(streamChat);
const scene = sampleRegistry['iot-telemetry']!;

const mockApi = (enabled = true, conversation = { id: 'c1', title: 'New conversation', items: [], scenes: [] }) =>
  api.mockImplementation(async (path, init) => {
    const p = String(path);
    if (p.endsWith('/agent')) return { enabled, model: 'm', tokensUsed: 0, tokenBudget: 10 } as never;
    if (p.endsWith('/conversations') && init?.method === 'POST') return { id: 'c1', title: 'New conversation', updatedAt: '2026-09-28T10:00:00Z' } as never;
    if (p.endsWith('/conversations')) return [] as never;
    if (p.includes('/translate')) return { id: 'sc2', scene: { ...scene, language: 'es' } } as never;
    if (p.includes('/conversations/c1')) return conversation as never;
    return sessionFixture() as never;
  });

const render = (selected: { label: string; graphRef: string } | null = null) => {
  const openScene = vi.fn();
  renderShell(<ChatPanel orgId="o1" language="es" ctx={{ openScene, selected, scene }} />, { session: sessionFixture() });
  return { openScene };
};

beforeEach(() => {
  api.mockReset();
  stream.mockReset();
});

describe('ChatPanel', () => {
  it('shows a notice when the agent is not configured', async () => {
    mockApi(false);
    render();
    expect(await screen.findByTestId('chat-disabled')).toBeInTheDocument();
    expect(screen.getByTestId('chat-send')).toBeDisabled();
  });

  it('creates a conversation, streams the answer and opens the scene', async () => {
    mockApi();
    stream.mockImplementation(async (_o, _c, _b, onEvent: (e: ChatEvent) => void) => {
      onEvent({ type: 'tool', name: 'search_graph', status: 'running', summary: 'search_graph' });
      onEvent({ type: 'scene', id: 'sc1', scene });
      onEvent({ type: 'text', delta: 'Readings ' });
      onEvent({ type: 'text', delta: 'flow to the broker.' });
      onEvent({ type: 'done', sceneIds: ['sc1'], usage: { input: 1, output: 1 } });
    });
    const { openScene } = render();
    await screen.findByTestId('chat-input');
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'How do readings flow?' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(stream).toHaveBeenCalledWith('o1', 'c1', { text: 'How do readings flow?', language: 'es', focus: null }, expect.any(Function), expect.any(AbortSignal)));
    expect(await screen.findByText('Readings flow to the broker.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-0')).toHaveTextContent('How do readings flow?');
    expect(screen.getByTestId('chat-scene-sc1')).toHaveTextContent('IoT telemetry ingestion');
    expect(openScene).toHaveBeenCalledWith(scene);
  });

  it('attaches the selected piece and regenerates a scene in another language', async () => {
    mockApi(true, { id: 'c1', title: 'x', items: [{ role: 'user', text: 'q', turn: 1 }], scenes: [{ id: 'sc1', turn: 1, scene }] } as never);
    api.mockImplementationOnce(async () => [{ id: 'c1', title: 'x', updatedAt: '2026-09-28T10:00:00Z' }] as never);
    stream.mockResolvedValue(undefined);
    const { openScene } = render({ label: 'MQTT broker', graphRef: 'svc:broker' });
    fireEvent.click(await screen.findByTestId('chat-ask-about'));
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Why?' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(stream).toHaveBeenCalledWith('o1', 'c1', { text: 'Why?', language: 'es', focus: { label: 'MQTT broker', graphRef: 'svc:broker' } }, expect.any(Function), expect.any(AbortSignal)));
    fireEvent.click(await screen.findByTestId('chat-translate-sc1'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1/scenes/sc1/translate', { method: 'POST', body: { language: 'es' } }));
    await waitFor(() => expect(openScene).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' })));
  });

  it('shows stream errors', async () => {
    mockApi();
    stream.mockImplementation(async (_o, _c, _b, onEvent: (e: ChatEvent) => void) => {
      onEvent({ type: 'error', code: 'token_budget_exceeded', message: 'x' });
    });
    render();
    fireEvent.change(await screen.findByTestId('chat-input'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(await screen.findByTestId('chat-error')).toHaveTextContent('agent budget');
  });
});
```
(The third test's first `mockImplementationOnce` answers the initial `/conversations` list with an existing conversation so the panel opens `c1` without creating one.)

`apps/web/test/workspace/chatSidebar.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { sampleRegistry, type Scene } from '@rdi/scene';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { Workspace, type ChatContext } from '../../src/workspace/Workspace';

const fresh: Scene = { ...sampleRegistry['iot-telemetry']!, id: 'agent-scene', title: 'Agent scene' };

describe('Workspace chat sidebar', () => {
  it('switches the sidebar to the chat and loads scenes the chat opens', () => {
    let captured: ChatContext | null = null;
    render(
      <I18nProvider initialLanguage="en">
        <Workspace chat={(ctx) => { captured = ctx; return <div data-testid="chat-slot">chat</div>; }} />
      </I18nProvider>,
    );
    expect(screen.queryByTestId('chat-slot')).toBeNull();
    fireEvent.click(screen.getByTestId('activity-chat'));
    expect(screen.getByTestId('chat-slot')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('activity-walkthrough'));
    expect(screen.queryByTestId('chat-slot')).toBeNull();
    fireEvent.click(screen.getByTestId('activity-chat'));
    captured!.openScene(fresh);
    expect(screen.getByTestId('scene-select')).toHaveValue('agent-scene');
    expect(screen.getByRole('option', { name: 'Agent scene' })).toBeInTheDocument();
  });
});
```

Run: `npm test -w @rdi/web -- chatPanel chatSidebar`
Expected: FAIL — `ChatPanel` missing; Workspace has no `chat` prop.

- [ ] **Step 3: Implement**

`apps/web/src/workspace/Workspace.tsx`:
- add `import type { ReactNode } from 'react';` (merge into the existing react import) and export:
```ts
export type ChatContext = { openScene(scene: Scene): void; selected: { label: string; graphRef: string } | null; scene: Scene };
```
- `WorkspaceProps` gains `chat?: (ctx: ChatContext) => ReactNode;` and the component destructures `chat`.
- add state and merge chat scenes before the others:
```ts
  const [chatScenes, setChatScenes] = useState<Scene[]>([]);
  const [sidebar, setSidebar] = useState<'explorer' | 'chat'>('explorer');
  const scenes = useMemo(() => {
    const seen = new Set<string>();
    return [...chatScenes, ...extraScenes, ...sampleScenes].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  }, [chatScenes, extraScenes]);
```
- add, next to `loadScene`:
```ts
  const openScene = (next: Scene) => {
    setChatScenes((current) => [next, ...current.filter((s) => s.id !== next.id)]);
    previousFlat.current = [];
    dispatchRaw({ type: 'loadScene', sceneId: next.id, level: explorer.level, mode: availableModes(next)[0] ?? 'walkthrough' });
    dispatchPlayer({ type: 'reset' });
  };
  const chatContext: ChatContext = {
    openScene,
    scene,
    selected: selectedNode?.graphRef ? { label: selectedNode.label, graphRef: selectedNode.graphRef } : null,
  };
```
  (declare these after `selectedNode` exists.)
- change `<div className="ws-body">` to `<div className={sidebar === 'chat' && chat ? 'ws-body chat-open' : 'ws-body'}>` and pass to `ExplorerPanel`:
```tsx
          chatSlot={chat ? chat(chatContext) : undefined} sidebar={chat ? sidebar : 'explorer'} onSidebar={setSidebar}
```
  and make its `onSetMode` also return to the explorer: `onSetMode={(mode) => { setSidebar('explorer'); dispatchRaw({ type: 'setMode', mode }); }}`.

`apps/web/src/workspace/panels/ExplorerPanel.tsx`:
- import `type ReactNode` from react; props gain `chatSlot?: ReactNode; sidebar: 'explorer' | 'chat'; onSidebar: (s: 'explorer' | 'chat') => void;`
- in the activity bar, before the mode buttons:
```tsx
        {p.chatSlot !== undefined && (
          <button type="button" data-testid="activity-chat" aria-pressed={p.sidebar === 'chat'} title={t('chat.title')} onClick={() => p.onSidebar('chat')}>✦</button>
        )}
```
- mode buttons' `aria-pressed` becomes `p.sidebar === 'explorer' && p.explorer.mode === mode`.
- wrap the existing `<aside className="ws-explorer">…</aside>` so that when `p.sidebar === 'chat'` it renders `<aside className="ws-explorer ws-chat" data-testid="chat-panel-host">{p.chatSlot}</aside>` instead.

`apps/web/src/workspace/workspace.css` append:
```css
.ws-body.chat-open { grid-template-columns: 36px 380px minmax(0, 1fr) 320px; }
.ws-chat { display: flex; flex-direction: column; overflow: hidden; }
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.chat-head { display: flex; gap: 6px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.chat-head select { flex: 1; min-width: 0; }
.chat-log { flex: 1; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
.chat-msg { padding: 8px 10px; border-radius: var(--radius); line-height: 1.45; white-space: pre-wrap; }
.chat-msg.user { align-self: flex-end; background: color-mix(in srgb, var(--accent) 16%, transparent); max-width: 90%; }
.chat-msg.assistant { background: color-mix(in srgb, var(--text) 5%, transparent); }
.chat-tool { font-size: 12px; color: var(--muted); }
.chat-scene { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px; }
.chat-input { border-top: 1px solid var(--line); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.chat-input textarea { width: 100%; min-height: 64px; resize: vertical; background: transparent; color: var(--text); border: 1px solid var(--line); border-radius: var(--radius); padding: 8px; font: inherit; }
.chat-chip { align-self: flex-start; font-size: 12px; }
.chat-notice { margin: 10px; padding: 8px 10px; border-radius: var(--radius); background: color-mix(in srgb, var(--warn, #f5a524) 14%, transparent); font-size: 13px; }
```

`apps/web/src/shell/chat/ChatPanel.tsx`:
```tsx
import { validateScene, type Scene } from '@rdi/scene';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import type { ChatContext } from '../../workspace/Workspace';
import { ApiError, apiFetch } from '../api';
import { streamChat, type ChatEvent } from './chatApi';

type Item = { role: 'user' | 'assistant'; text: string; turn: number };
type SceneEntry = { id: string; turn: number; scene: Scene };
type Conversation = { id: string; title: string; items: Item[]; scenes: { id: string; turn: number; scene: unknown }[] };
type Summary = { id: string; title: string; updatedAt: string };
type Agent = { enabled: boolean; model: string; tokensUsed: number; tokenBudget: number };

const LANGUAGE_LABEL: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português' };

const validScenes = (rows: Conversation['scenes']): SceneEntry[] =>
  rows.flatMap((row) => {
    const result = validateScene(row.scene);
    return result.ok ? [{ id: row.id, turn: row.turn, scene: result.scene }] : [];
  });

export const ChatPanel = ({ orgId, ctx, language }: { orgId: string; ctx: ChatContext; language: string }) => {
  const { t } = useI18n();
  const client = useQueryClient();
  const agent = useQuery({ queryKey: ['agent', orgId], queryFn: () => apiFetch<Agent>(`/orgs/${orgId}/agent`) });
  const conversations = useQuery({ queryKey: ['conversations', orgId], queryFn: () => apiFetch<Summary[]>(`/orgs/${orgId}/conversations`) });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  const [tool, setTool] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [focus, setFocus] = useState<{ label: string; graphRef: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const logEnd = useRef<HTMLDivElement | null>(null);

  const errorText = (code: string) => t((`errors.${code}` as MessageKey)) ?? t('errors.unknown');

  useEffect(() => {
    if (conversationId === null && conversations.data?.[0]) setConversationId(conversations.data[0].id);
  }, [conversations.data, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void apiFetch<Conversation>(`/orgs/${orgId}/conversations/${conversationId}`).then((c) => {
      if (cancelled) return;
      setItems(c.items);
      setScenes(validScenes(c.scenes));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, conversationId]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => logEnd.current?.scrollIntoView?.({ block: 'end' }), [items, scenes, tool]);

  const startNew = () => {
    abort.current?.abort();
    setConversationId(null);
    setItems([]);
    setScenes([]);
    setError(null);
    void client.setQueryData(['conversations', orgId], (list: Summary[] | undefined) => list ?? []);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    try {
      const id = conversationId ?? (await apiFetch<Summary>(`/orgs/${orgId}/conversations`, { method: 'POST', body: {} })).id;
      if (!conversationId) setConversationId(id);
      const turn = (items.filter((i) => i.role === 'user').at(-1)?.turn ?? 0) + 1;
      setItems((current) => [...current, { role: 'user', text, turn }, { role: 'assistant', text: '', turn }]);
      const controller = new AbortController();
      abort.current = controller;
      const onEvent = (event: ChatEvent) => {
        if (event.type === 'text') {
          setItems((current) => current.map((item, i) => (i === current.length - 1 ? { ...item, text: item.text + event.delta } : item)));
        } else if (event.type === 'tool') {
          setTool(event.status === 'running' ? event.summary : null);
        } else if (event.type === 'scene') {
          const result = validateScene(event.scene);
          if (!result.ok) return;
          setScenes((current) => [...current, { id: event.id, turn, scene: result.scene }]);
          ctx.openScene(result.scene);
        } else if (event.type === 'error') {
          setError(errorText(event.code));
        }
      };
      await streamChat(orgId, id, { text, language, focus }, onEvent, controller.signal);
      setFocus(null);
      void client.invalidateQueries({ queryKey: ['conversations', orgId] });
      void client.invalidateQueries({ queryKey: ['agent', orgId] });
    } catch (err) {
      setError(err instanceof ApiError ? errorText(err.code) : t('errors.unknown'));
    } finally {
      setTool(null);
      setBusy(false);
    }
  };

  const translate = async (entry: SceneEntry) => {
    setError(null);
    try {
      const result = await apiFetch<{ id: string; scene: unknown }>(`/orgs/${orgId}/scenes/${entry.id}/translate`, { method: 'POST', body: { language } });
      const valid = validateScene(result.scene);
      if (!valid.ok) return;
      setScenes((current) => [...current, { id: result.id, turn: entry.turn, scene: valid.scene }]);
      ctx.openScene(valid.scene);
    } catch (err) {
      setError(err instanceof ApiError ? errorText(err.code) : t('errors.unknown'));
    }
  };

  const disabled = agent.data ? !agent.data.enabled : true;
  const visibleItems = items.filter((item) => item.role === 'user' || item.text);

  return (
    <div className="chat" data-testid="chat-panel">
      <div className="chat-head">
        <select aria-label={t('chat.conversations')} data-testid="chat-conversations" value={conversationId ?? ''} onChange={(e) => setConversationId(e.target.value || null)}>
          <option value="">{t('chat.new')}</option>
          {(conversations.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button type="button" className="btn" data-testid="chat-new" onClick={startNew}>+</button>
      </div>
      {agent.data && disabled && <p className="chat-notice" data-testid="chat-disabled">{t('chat.disabled')}</p>}
      <div className="chat-log">
        {visibleItems.length === 0 && <p className="muted">{t('chat.empty')}</p>}
        {visibleItems.map((item, i) => (
          <div key={i}>
            <div className={`chat-msg ${item.role}`} data-testid={`chat-message-${i}`}>{item.text}</div>
            {item.role === 'assistant' && scenes.filter((s) => s.turn === item.turn).map((entry) => (
              <div key={entry.id} className="chat-scene" data-testid={`chat-scene-${entry.id}`}>
                <span>◆ {t('chat.scene', { title: entry.scene.title })}</span>
                <button type="button" className="btn" data-testid={`chat-open-${entry.id}`} onClick={() => ctx.openScene(entry.scene)}>{t('chat.open')}</button>
                {entry.scene.language !== language && (
                  <button type="button" className="btn" data-testid={`chat-translate-${entry.id}`} disabled={disabled} onClick={() => void translate(entry)}>
                    {t('chat.translate', { language: LANGUAGE_LABEL[language] ?? language })}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        {busy && <div className="chat-tool" data-testid="chat-tool">{tool ?? t('chat.thinking')}</div>}
        {error && <p className="alert error" role="alert" data-testid="chat-error">{error}</p>}
        <div ref={logEnd} />
      </div>
      <div className="chat-input">
        {ctx.selected && !focus && (
          <button type="button" className="btn chat-chip" data-testid="chat-ask-about" onClick={() => setFocus(ctx.selected)}>＋ {t('chat.askAbout', { label: ctx.selected.label })}</button>
        )}
        {focus && <span className="tag chat-chip" data-testid="chat-focus">◎ {focus.label} <button type="button" className="btn" onClick={() => setFocus(null)}>×</button></span>}
        <textarea
          data-testid="chat-input" aria-label={t('chat.title')} placeholder={t('chat.placeholder')} value={draft} disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="btn-primary btn-small" data-testid="chat-send" disabled={disabled || busy || !draft.trim()} onClick={() => void send()}>{t('chat.send')}</button>
      </div>
    </div>
  );
};
```
Note on the third test: the panel always rebuilds the `focus` payload from its own state, so after clicking `chat-ask-about` the next send includes `{ label, graphRef }`; the `send` button is disabled until the draft is non-empty, which the tests satisfy by typing first. In the first test the button stays disabled until `/agent` resolves, so the test waits for `chat-input` and the agent query before clicking — if the click lands early, wait for `chat-send` to be enabled (ledger it).

`apps/web/src/shell/pages/ExplorePage.tsx`: import `ChatPanel` and `effectiveExplanationLanguage`, read `language` from `useI18n()`, and pass to `Workspace`:
```tsx
      chat={(ctx) => <ChatPanel orgId={org.id} ctx={ctx} language={effectiveExplanationLanguage(session.user, org, language)} />}
```
Update the `Workspace` mock in `apps/web/test/shell/explore.test.tsx` to ignore the extra prop (it already only reads `extraScenes`).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add the agent chat to the workspace sidebar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Code drawer loads real code on demand

**Files:**
- Modify: `apps/web/src/workspace/panels/CodeDrawer.tsx`, `apps/web/src/workspace/Workspace.tsx`, `apps/web/src/shell/pages/ExplorePage.tsx`, `apps/web/src/i18n/messages.ts` (+ `code.loading` in en/es/pt workspace catalogs)
- Test: `apps/web/test/workspace/codeDrawer.test.tsx`

**Interfaces:**
- Produces: `type CodeRef = NonNullable<SceneNode['code']>`; `CodeDrawer({ node, onClose, loadCode? })` with `loadCode?: (code: CodeRef) => Promise<string>`; `WorkspaceProps.loadCode?`; testid `code-loading`.

- [ ] **Step 1: Catalog keys**

In `apps/web/src/i18n/messages.ts` add `'code.loading': 'Loading code…'` to `workspaceEn`, `'code.loading': 'Cargando código…'` to `esWorkspace`, `'code.loading': 'Carregando código…'` to `ptWorkspace`.

- [ ] **Step 2: Write the failing test**

`apps/web/test/workspace/codeDrawer.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import type { SceneNode } from '@rdi/scene';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { CodeDrawer } from '../../src/workspace/panels/CodeDrawer';

const node = { id: 'n', label: 'POST /api/orders', role: 'compute', kind: 'HTTP endpoint', summary: 's', code: { repo: 'acme/api', path: 'src/server.ts', startLine: 4, endLine: 8, language: 'typescript' } } as SceneNode;
const wrap = (ui: React.ReactElement) => render(<I18nProvider initialLanguage="en">{ui}</I18nProvider>);

describe('CodeDrawer', () => {
  it('loads code on demand when the scene has no snippet', async () => {
    const loadCode = vi.fn().mockResolvedValue("app.post('/api/orders', createOrderHandler);");
    wrap(<CodeDrawer node={node} onClose={() => {}} loadCode={loadCode} />);
    expect(screen.getByTestId('code-loading')).toBeInTheDocument();
    expect(await screen.findByText(/createOrderHandler/)).toBeInTheDocument();
    expect(loadCode).toHaveBeenCalledWith(node.code);
  });

  it('shows the unavailable notice when loading fails or no loader exists', async () => {
    wrap(<CodeDrawer node={node} onClose={() => {}} loadCode={() => Promise.reject(new Error('404'))} />);
    expect(await screen.findByText('Code is not available for this piece.')).toBeInTheDocument();
  });

  it('prefers an embedded snippet', () => {
    wrap(<CodeDrawer node={{ ...node, code: { ...node.code!, snippet: 'const a = 1;' } }} onClose={() => {}} loadCode={vi.fn()} />);
    expect(screen.getByText(/a = 1/)).toBeInTheDocument();
  });
});
```
Check the English text of `code.unavailable` in `messages.ts` before running; if it differs from `'Code is not available for this piece.'`, use the catalog's exact text in the test.

Run: `npm test -w @rdi/web -- codeDrawer`
Expected: FAIL — no loading state; loader never called.

- [ ] **Step 3: Implement**

`apps/web/src/workspace/panels/CodeDrawer.tsx` — keep `highlightCode`; replace the component:
```tsx
export type CodeRef = NonNullable<SceneNode['code']>;

export const CodeDrawer = ({ node, onClose, loadCode }: { node: SceneNode; onClose: () => void; loadCode?: (code: CodeRef) => Promise<string> }) => {
  const { t } = useI18n();
  const code = node.code;
  const [loaded, setLoaded] = useState<{ key: string; snippet: string | null } | null>(null);
  const key = code ? `${code.repo}|${code.path}|${code.startLine}|${code.endLine}` : '';

  useEffect(() => {
    if (!code || code.snippet || !loadCode) return;
    let cancelled = false;
    loadCode(code)
      .then((snippet) => { if (!cancelled) setLoaded({ key, snippet }); })
      .catch(() => { if (!cancelled) setLoaded({ key, snippet: null }); });
    return () => {
      cancelled = true;
    };
  }, [key, loadCode]);

  if (!code) return null;
  const snippet = code.snippet ?? (loaded?.key === key ? loaded.snippet : undefined);
  const loading = !code.snippet && Boolean(loadCode) && loaded?.key !== key;
  return (
    <aside className="drawer" data-testid="code-drawer">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="kw">⟨/⟩ {t('code.title')} · {node.label}</span>
        <button type="button" className="btn" data-testid="code-close" onClick={onClose}>{t('code.close')}</button>
      </div>
      <div className="muted" style={{ marginTop: 4 }}>{code.repo}/{code.path}:{code.startLine}-{code.endLine}</div>
      {loading ? (
        <p className="muted" data-testid="code-loading">{t('code.loading')}</p>
      ) : snippet ? (
        <pre>{highlightCode(snippet).map((part, i) => (typeof part === 'string' ? part : <span key={i} className="kw">{part.kw}</span>))}</pre>
      ) : (
        <p className="muted">{t('code.unavailable')}</p>
      )}
    </aside>
  );
};
```
with `import { useEffect, useState } from 'react';` at the top.

`apps/web/src/workspace/Workspace.tsx`: `WorkspaceProps` gains `loadCode?: (code: CodeRef) => Promise<string>` (import `type CodeRef` from `./panels/CodeDrawer`); pass `loadCode={loadCode}` to `<CodeDrawer …>`.

`apps/web/src/shell/pages/ExplorePage.tsx`: define outside the component
```tsx
const codeLoader = (orgId: string) => async (code: CodeRef) => {
  const query = new URLSearchParams({ repo: code.repo, path: code.path, start: String(code.startLine), end: String(code.endLine) });
  return (await apiFetch<{ snippet: string }>(`/orgs/${orgId}/code?${query.toString()}`)).snippet;
};
```
and pass `loadCode={codeLoader(org.id)}` wrapped in `useMemo(() => codeLoader(orgId), [orgId])` (declare the memo before the early returns).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): load real source code on demand in the code drawer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Agent usage in settings

**Files:**
- Modify: `apps/web/src/shell/settings/UsagePage.tsx`, `apps/web/src/i18n/shellMessages.ts`
- Test: `apps/web/test/shell/usage.test.tsx`

**Interfaces:**
- Produces: testid `usage-agent`; key `usage.agentTokens` = `{used} of {budget} tokens this month` (es: `{used} de {budget} tokens este mes`, pt: `{used} de {budget} tokens este mês`); `usage.agentOff` = `Agent not configured` (es: `Agente no configurado`, pt: `Agente não configurado`). `usage.agentSoon` stays unused.

- [ ] **Step 1: Write the failing test**

`apps/web/test/shell/usage.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { UsagePage } from '../../src/shell/settings/UsagePage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

const render = (agent: object) => {
  api.mockImplementation(async (path) => (String(path).endsWith('/agent') ? agent : { repos: 2, repoLimit: 10, pieces: 40 }) as never);
  renderShell(
    <Routes><Route path=":orgId/settings" element={<SettingsLayout />}><Route path="*" element={<UsagePage />} /></Route></Routes>,
    { route: '/orgs/o1/settings/usage', path: '/orgs/*', session: sessionFixture() },
  );
};

beforeEach(() => api.mockReset());

describe('UsagePage', () => {
  it('shows the monthly agent token usage', async () => {
    render({ enabled: true, model: 'claude-opus-5', tokensUsed: 12_345, tokenBudget: 2_000_000 });
    expect(await screen.findByTestId('usage-agent')).toHaveTextContent('12,345 of 2,000,000 tokens this month');
  });

  it('says when the agent is not configured', async () => {
    render({ enabled: false, model: 'claude-opus-5', tokensUsed: 0, tokenBudget: 2_000_000 });
    expect(await screen.findByTestId('usage-agent')).toHaveTextContent('Agent not configured');
  });
});
```

Run: `npm test -w @rdi/web -- usage`
Expected: FAIL — no `usage-agent`.

- [ ] **Step 2: Implement**

Add the keys from **Interfaces** to the three shell catalogs. In `UsagePage.tsx` add the agent query and replace the agent card:
```tsx
type Agent = { enabled: boolean; model: string; tokensUsed: number; tokenBudget: number };
// inside the component:
  const { t, language } = useI18n();
  const agent = useQuery({ queryKey: ['agent', org.id], queryFn: () => apiFetch<Agent>(`/orgs/${org.id}/agent`) });
  const number = (n: number) => n.toLocaleString(language === 'en' ? 'en-US' : language);
// card:
        <div className="stat" data-testid="usage-agent">
          {t('usage.agent')}
          <b>{agent.data ? (agent.data.enabled ? t('usage.agentTokens', { used: number(agent.data.tokensUsed), budget: number(agent.data.tokenBudget) }) : t('usage.agentOff')) : '—'}</b>
        </div>
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): show agent token usage in settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: End-to-end chat journey

**Files:**
- Modify: `apps/web/playwright.config.ts` (API env `RDI_FAKE_LLM: 'true'`), `README.md`
- Create: `apps/web/e2e/chat.spec.ts`

- [ ] **Step 1: Enable the fake model for E2E**

In the API `webServer.env` of `apps/web/playwright.config.ts` add `RDI_FAKE_LLM: 'true',`.

- [ ] **Step 2: Write the E2E journey**

`apps/web/e2e/chat.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
});

const indexDemo = async (page: Page) => {
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  const { orgs, csrfToken } = (await demo.json()) as { orgs: { id: string }[]; csrfToken: string };
  const orgId = orgs[0]!.id;
  for (const fullName of ['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']) {
    await page.request.post(`/api/orgs/${orgId}/repos`, { data: { fullName }, headers: { 'x-csrf-token': csrfToken } });
  }
  await expect.poll(async () => ((await (await page.request.get(`/api/orgs/${orgId}/repos`)).json()) as { status: string }[]).every((r) => r.status === 'ready'), { timeout: 120_000 }).toBe(true);
  return orgId;
};

test('ask the agent and watch the answer animate on the canvas', async ({ page }) => {
  test.setTimeout(180_000);
  const orgId = await indexDemo(page);
  await page.goto(`/orgs/${orgId}/explore`);
  await expect(page.getByTestId('scene-select')).toHaveValue('system-map');
  await page.getByTestId('activity-chat').click();
  await page.getByTestId('chat-input').fill('orders');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-1')).toContainText('Here is how it fits together');
  const sceneChip = page.locator('[data-testid^="chat-scene-"]').first();
  await expect(sceneChip).toContainText('About orders');
  await expect(page.getByTestId('scene-select')).not.toHaveValue('system-map');
  await page.getByTestId('player-next').click();
  await expect(page.getByTestId('now')).toContainText('Step 1:');

  await page.reload();
  await page.getByTestId('activity-chat').click();
  await expect(page.getByTestId('chat-message-0')).toContainText('orders');
  await expect(page.locator('[data-testid^="chat-scene-"]').first()).toBeVisible();
});

test('regenerate a scene in another language', async ({ page }) => {
  test.setTimeout(180_000);
  const orgId = await indexDemo(page);
  await page.request.patch('/api/me', { data: { explanationLanguage: 'es' }, headers: { 'x-csrf-token': ((await (await page.request.get('/api/me')).json()) as { csrfToken: string }).csrfToken } });
  await page.goto(`/orgs/${orgId}/explore`);
  await page.getByTestId('activity-chat').click();
  const conversation = ((await (await page.request.post(`/api/orgs/${orgId}/conversations`, { data: {}, headers: { 'x-csrf-token': ((await (await page.request.get('/api/me')).json()) as { csrfToken: string }).csrfToken } })).json()) as { id: string });
  expect(conversation.id).toBeTruthy();
  await page.reload();
  await page.getByTestId('activity-chat').click();
  await page.getByTestId('chat-conversations').selectOption(conversation.id);
  await page.getByTestId('chat-input').fill('orders');
  await page.getByTestId('chat-send').click();
  await expect(page.locator('[data-testid^="chat-scene-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="chat-translate-"]')).toHaveCount(0);
});

test('open real code from the system map', async ({ page }) => {
  test.setTimeout(180_000);
  const orgId = await indexDemo(page);
  await page.goto(`/orgs/${orgId}/explore`);
  await page.getByTestId('level-components').click();
  await page.getByText('POST /api/orders', { exact: true }).first().click();
  await page.getByTestId('view-code').click();
  await expect(page.getByTestId('code-drawer')).toContainText("app.post('/api/orders', createOrderHandler);");
});
```
Before running, check the testid of the component card's "view code" button (`grep -rn "onViewCode" apps/web/src/workspace/panels/ComponentCard.tsx`) and of `/api/me` responses (does `GET /api/me` return `csrfToken`?). If they differ, adapt the selectors/requests to the existing ones and ledger it. The second test pins that a scene already in the explanation language (fake scenes use the requested language) offers no "regenerate" button; the translate round-trip itself is covered by Tasks 9 and 11.

- [ ] **Step 3: Run everything**

Stop any running dev servers, then run:
```bash
npm test && npm run typecheck
npm run test:integration -w @rdi/api && npm run test:integration -w @rdi/graph && npm run test:integration -w @rdi/worker
npm run e2e -w @rdi/web
```
Expected: all PASS; E2E `22 passed` (10 workspace + 7 shell + 2 indexing + 3 chat).

- [ ] **Step 4: README**

Append to `README.md`:
```markdown
### Agent

The chat in the workspace (✦ in the activity bar) talks to Claude through the Anthropic API. Set `ANTHROPIC_API_KEY`
(or `AGENT_ENABLED=true` with an `ant auth login` profile) before `npm run dev`; `AGENT_MODEL` defaults to
`claude-opus-5` and `AGENT_MONTHLY_TOKEN_BUDGET` to 2,000,000 tokens per organization. For offline development and the
E2E suite, `RDI_FAKE_LLM=true` uses a deterministic scripted agent (never in production).
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(web): add end-to-end agent chat journeys

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Agent tools: query_graph (neighbours, paths), search_semantic (keyword search now; embeddings deferred), read_code, get_pr_diff, emit_scene | 4 |
| upsert_solution | Plan 5 |
| SSE streaming of narration + scenes | 7, 8, 10 |
| Invalid scene → errors back to the agent, 2 retries, then text-only | 7 |
| Chat + canvas split view; scenes as canvas entries | 11 |
| Nodes with graphRef → "ask about this" | 2, 11 |
| Code only on demand | 2, 3, 12 |
| Regenerate in language | 9, 11 |
| Conversations, messages, scenes, usage tables | 1 |
| Per-org rate limit + visible token budget | 8, 13 |
| Repo not indexed yet → agent warns | 6 (repository list in the turn), 4 (`read_code` errors) |
