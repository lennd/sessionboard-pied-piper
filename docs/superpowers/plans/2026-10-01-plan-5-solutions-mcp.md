# Plan 5 — Solutions, remote MCP and Claude Code handoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "I want Y" into a versioned **Solution** (current vs proposed scene + task plan + risks), make it visible and navigable on the canvas (current / proposed / changes, tasks highlight their pieces), and hand it to **Claude Code** through the product's remote **MCP server**, whose updates (new versions, task progress) stream live back into the web.

**Architecture:** Solution drafts are validated by a shared schema in `@rdi/scene`. Postgres stores solutions, append-only versions, per-task status and personal API tokens (hashed). The API exposes REST + an SSE event stream per solution fed by Redis pub/sub. The agent gets an `upsert_solution` tool. A stateless Streamable HTTP MCP endpoint (`POST /mcp`, `@modelcontextprotocol/sdk` 1.31, JSON responses) authenticates with `Authorization: Bearer <token>` and offers `list_solutions`, `get_solution`, `query_graph`, `update_solution`, `report_task_progress`. The web adds a Solutions list, a Solution workspace (plan panel, version picker, scene diff), access tokens and an "Execute in Claude Code" dialog.

**Tech Stack:** `@modelcontextprotocol/sdk` 1.31.0 (`McpServer.registerTool`, `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, `enableJsonResponse: true`), Zod 4, ioredis pub/sub, Fastify raw SSE, `EventSource` on the web.

**Spec:** `docs/superpowers/specs/2026-09-28-repository-designer-ide-design.md` §4 (Solutions, remote MCP server, "Execute in Claude Code", live updates). Neo4j stays as the graph store (decision 2026-10-01).

## Global Constraints

- Versions are append-only: every change of plan/scenes/risks creates version `n+1` (`author` `web` or `claude-code`). Task status is tracked separately (`todo | in_progress | done | blocked`) and does not create versions.
- Solutions are shared with the whole organization (any member can read and edit); conversations stay private.
- Every MCP call is scoped to the token's organization and user; a revoked token or a lost membership returns 401. Tokens are shown once, stored as SHA-256, prefixed `rdi_`.
- A solution draft is valid only if its scenes validate as Scene v2, task ids are unique, `dependsOn` references existing tasks and every `nodeRefs` id exists in the proposed or current scene.
- Limits: 60 tasks and 40 risks per version; 10 tokens per user per org; MCP payloads go through the same scene limits as the agent.
- UI strings through `t()` (en/es/pt). Comments in English. Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A token from another org or a revoked token** never reads or changes a solution (401 / not found). Pinned in Tasks 5 and 6.
2. **Concurrent new versions** (web and Claude Code at the same time) never produce two versions with the same number. Pinned in Task 2.
3. **An invalid draft from the agent or MCP** (bad scene, unknown nodeRef, unknown dependency) is rejected with readable errors and nothing is stored. Pinned in Tasks 1, 4 and 6.
4. **Progress reported by Claude Code** appears live in an open Solution page without reload. Pinned in Tasks 3 and 12.
5. **Reporting progress on an unknown task or another org's solution** fails without side effects. Pinned in Task 6.

---

## File Structure

```
packages/scene/src/{solution,diff}.ts (+ index exports); test/{solution,diff}.test.ts
apps/api/src/db/migrations/004_solutions.sql
apps/api/src/db/queries/{solutions,tokens}.ts
apps/api/src/solutions/{events,service}.ts
apps/api/src/routes/{solutions,tokens}.ts
apps/api/src/mcp/{server,route}.ts
apps/api/src/agent/{tools,fakeLlm,prompt,runAgent}.ts, routes/agent.ts (+ upsert_solution)
apps/api/src/{config,app}.ts
apps/api/test/{solutions,tokens,mcp}.integration.test.ts, test/agent/*.test.ts
apps/web/src/shell/solutions/{solutionsApi,PlanPanel,HandoffDialog}.tsx
apps/web/src/shell/settings/{SolutionsPage,TokensPage,SettingsLayout}.tsx, shell/pages/SolutionPage.tsx, shell/router.tsx
apps/web/src/shell/chat/ChatPanel.tsx (solution chips), workspace/{Workspace.tsx,panels/ExplorerPanel.tsx}
apps/web/src/i18n/shellMessages.ts
apps/web/test/shell/{solutions,tokens,planPanel,handoff,solutionPage}.test.tsx, test/workspace/panels.test.tsx
apps/web/e2e/solutions.spec.ts
```

---

### Task 1: Solution drafts and scene diffs in `@rdi/scene`

**Files:**
- Create: `packages/scene/src/solution.ts`, `packages/scene/src/diff.ts`
- Modify: `packages/scene/src/index.ts`
- Test: `packages/scene/test/solution.test.ts`, `packages/scene/test/diff.test.ts`

**Interfaces:**
- Produces:
  ```ts
  TASK_STATUSES = ['todo','in_progress','done','blocked'] as const; type TaskStatus
  SOLUTION_STATUSES = ['draft','in_progress','done','archived'] as const; type SolutionStatus
  type SolutionTask = { id: string; title: string; description?: string; nodeRefs: string[]; acceptance: string[]; dependsOn: string[] }
  type SolutionRisk = { title: string; severity: Severity; mitigation?: string }
  type SolutionDraft = { summary: string; sceneCurrent: Scene | null; sceneProposed: Scene | null; plan: SolutionTask[]; risks: SolutionRisk[] }
  validateSolutionDraft(input: unknown): { ok: true; draft: SolutionDraft } | { ok: false; errors: string[] }
  diffScenes(before: Scene, after: Scene): Scene      // after + change flags; removed nodes appended; id `${after.id}-changes`
  ```

- [ ] **Step 1: Write the failing tests**

`packages/scene/test/solution.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sampleRegistry, validateSolutionDraft } from '../src/index';

const scene = sampleRegistry['iot-telemetry']!;
const nodeId = scene.nodes[0]!.id;

describe('validateSolutionDraft', () => {
  it('accepts a draft with a proposed scene and a plan that references its pieces', () => {
    const result = validateSolutionDraft({
      summary: 'Add rate limiting', sceneProposed: scene,
      plan: [{ id: 't1', title: 'Add limiter', nodeRefs: [nodeId], acceptance: ['429 after 100 req/s'] }, { id: 't2', title: 'Tests', dependsOn: ['t1'] }],
      risks: [{ title: 'Legit bursts throttled', severity: 'medium' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.sceneCurrent).toBeNull();
    expect(result.draft.plan[1]).toEqual({ id: 't2', title: 'Tests', nodeRefs: [], acceptance: [], dependsOn: ['t1'] });
  });

  it('reports invalid scenes, duplicate tasks, unknown dependencies and unknown pieces', () => {
    const result = validateSolutionDraft({
      summary: 'x', sceneProposed: { ...scene, nodes: [] },
      plan: [{ id: 't1', title: 'A', nodeRefs: ['ghost'] }, { id: 't1', title: 'B', dependsOn: ['t9'] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/sceneProposed/);
    const second = validateSolutionDraft({ summary: 'x', sceneProposed: scene, plan: [{ id: 't1', title: 'A', nodeRefs: ['ghost'] }, { id: 't1', title: 'B', dependsOn: ['t9'] }] });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errors).toEqual(expect.arrayContaining([
      'plan: duplicate task id "t1"',
      'plan.t1: nodeRefs "ghost" is not a piece of the current or proposed scene',
      'plan.t1: dependsOn "t9" is not a task of this plan',
    ]));
  });

  it('requires something to look at', () => {
    expect(validateSolutionDraft({ summary: 'x' })).toEqual({ ok: false, errors: ['a solution needs a scene or a plan'] });
  });
});
```

`packages/scene/test/diff.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { diffScenes, sampleRegistry, validateScene } from '../src/index';

const before = sampleRegistry['iot-telemetry']!;

describe('diffScenes', () => {
  it('marks added, modified and removed pieces and stays a valid scene', () => {
    const [first, second, ...rest] = before.nodes;
    const after = {
      ...before,
      nodes: [{ ...first!, summary: 'Changed summary' }, ...rest, { id: 'cache', label: 'Cache', role: 'storage' as const, kind: 'Redis', summary: 'New cache' }],
      edges: before.edges.filter((e) => e.from !== second!.id && e.to !== second!.id),
      steps: [],
    };
    const diff = diffScenes(before, after);
    expect(validateScene(diff).ok).toBe(true);
    expect(diff.id).toBe(`${before.id}-changes`);
    const change = Object.fromEntries(diff.nodes.map((n) => [n.id, n.change ?? null]));
    expect(change[first!.id]).toBe('modified');
    expect(change.cache).toBe('added');
    expect(change[second!.id]).toBe('removed');
    expect(change[rest[0]!.id]).toBeNull();
  });
});
```

Run: `npm test -w @rdi/scene`
Expected: FAIL — `validateSolutionDraft` / `diffScenes` not exported.

- [ ] **Step 2: Implement**

`packages/scene/src/solution.ts`:
```ts
import { z } from 'zod';
import { SEVERITIES, type Scene, type Severity } from './schema';
import { validateScene } from './validate';

export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'blocked'] as const;
export const SOLUTION_STATUSES = ['draft', 'in_progress', 'done', 'archived'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type SolutionStatus = (typeof SOLUTION_STATUSES)[number];

const MAX_ID = 120;
const MAX_TITLE = 200;
const MAX_TEXT = 4000;
const MAX_TASKS = 60;
const MAX_RISKS = 40;

const taskSchema = z.object({
  id: z.string().min(1).max(MAX_ID),
  title: z.string().min(1).max(MAX_TITLE),
  description: z.string().min(1).max(MAX_TEXT).optional(),
  nodeRefs: z.array(z.string().min(1).max(MAX_ID)).max(40).default([]),
  acceptance: z.array(z.string().min(1).max(MAX_TEXT)).max(20).default([]),
  dependsOn: z.array(z.string().min(1).max(MAX_ID)).max(20).default([]),
});
const riskSchema = z.object({ title: z.string().min(1).max(MAX_TITLE), severity: z.enum(SEVERITIES), mitigation: z.string().min(1).max(MAX_TEXT).optional() });
const draftSchema = z.object({
  summary: z.string().min(1).max(MAX_TEXT),
  sceneCurrent: z.unknown().optional(),
  sceneProposed: z.unknown().optional(),
  plan: z.array(taskSchema).max(MAX_TASKS).default([]),
  risks: z.array(riskSchema).max(MAX_RISKS).default([]),
});

export type SolutionTask = z.infer<typeof taskSchema>;
export type SolutionRisk = { title: string; severity: Severity; mitigation?: string };
export type SolutionDraft = { summary: string; sceneCurrent: Scene | null; sceneProposed: Scene | null; plan: SolutionTask[]; risks: SolutionRisk[] };

export const solutionDraftInputSchema = draftSchema;

export const validateSolutionDraft = (input: unknown): { ok: true; draft: SolutionDraft } | { ok: false; errors: string[] } => {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'draft'}: ${i.message}`) };
  const errors: string[] = [];
  const scenes: Record<'sceneCurrent' | 'sceneProposed', Scene | null> = { sceneCurrent: null, sceneProposed: null };
  for (const key of ['sceneCurrent', 'sceneProposed'] as const) {
    const raw = parsed.data[key];
    if (raw === undefined || raw === null) continue;
    const result = validateScene(raw);
    if (result.ok) scenes[key] = result.scene;
    else errors.push(...result.errors.map((e) => `${key}: ${e}`));
  }
  if (errors.length > 0) return { ok: false, errors };
  const { plan, risks, summary } = parsed.data;
  if (!scenes.sceneCurrent && !scenes.sceneProposed && plan.length === 0) return { ok: false, errors: ['a solution needs a scene or a plan'] };
  const pieces = new Set([...(scenes.sceneCurrent?.nodes ?? []), ...(scenes.sceneProposed?.nodes ?? [])].map((n) => n.id));
  const taskIds = new Set<string>();
  for (const task of plan) {
    if (taskIds.has(task.id)) errors.push(`plan: duplicate task id "${task.id}"`);
    taskIds.add(task.id);
  }
  for (const task of plan) {
    for (const ref of task.nodeRefs) if (!pieces.has(ref)) errors.push(`plan.${task.id}: nodeRefs "${ref}" is not a piece of the current or proposed scene`);
    for (const dep of task.dependsOn) if (!taskIds.has(dep)) errors.push(`plan.${task.id}: dependsOn "${dep}" is not a task of this plan`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, draft: { summary, ...scenes, plan, risks } };
};
```

`packages/scene/src/diff.ts`:
```ts
import { defineScene } from './samples/define';
import type { Scene, SceneNode } from './schema';

const fingerprint = (n: SceneNode) => JSON.stringify([n.label, n.role, n.kind, n.summary, n.parent ?? null]);

export const diffScenes = (before: Scene, after: Scene): Scene => {
  const previous = new Map(before.nodes.map((n) => [n.id, n]));
  const current = new Set(after.nodes.map((n) => n.id));
  const nodes = after.nodes.map((n) => {
    const old = previous.get(n.id);
    const change = !old ? 'added' : fingerprint(old) !== fingerprint(n) ? 'modified' : undefined;
    const { change: _ignored, ...rest } = n;
    return change ? { ...rest, change } : rest;
  });
  for (const old of before.nodes) {
    if (current.has(old.id)) continue;
    const { parent, change: _ignored, ...rest } = old;
    nodes.push({ ...rest, ...(parent && current.has(parent) ? { parent } : {}), change: 'removed' as const });
  }
  return defineScene({ ...after, id: `${after.id}-changes`.slice(0, 120), title: `${after.title} — changes`.slice(0, 120), nodes });
};
```

Append to `packages/scene/src/index.ts`:
```ts
export * from './solution';
export * from './diff';
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/scene && npm run typecheck -w @rdi/scene`
Expected: PASS. If `defineScene` rejects a removed node whose parent was removed too, the parent drop above handles it; if a removed node collides with the `parent` chain of a kept node, ledger the case.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(scene): add solution drafts and scene diffs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Solution and token storage

**Files:**
- Create: `apps/api/src/db/migrations/004_solutions.sql`, `apps/api/src/db/queries/solutions.ts`, `apps/api/src/db/queries/tokens.ts`
- Test: `apps/api/test/solutionQueries.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // solutions.ts
  type SolutionRow = { id; org_id; created_by; conversation_id: string | null; title; status: SolutionStatus; created_at; updated_at }
  type VersionRow = { solution_id; n: number; author: 'web' | 'claude-code'; draft: SolutionDraft; created_at: Date }
  type TaskStatusRow = { task_id: string; status: TaskStatus; note: string | null; updated_at: Date }
  createSolution(db, { orgId, userId, title, conversationId, draft, author }): Promise<{ solution: SolutionRow; version: VersionRow }>
  addVersion(pool, solutionId, author, draft): Promise<VersionRow>          // locks the solution row; n = max + 1
  listSolutions(db, orgId): Promise<(SolutionRow & { latest_n: number; tasks_total: number; tasks_done: number })[]>
  findSolution(db, orgId, id): Promise<SolutionRow | null>
  listVersions(db, solutionId): Promise<{ n; author; summary; created_at }[]>
  getVersion(db, solutionId, n?: number): Promise<VersionRow | null>         // latest when n omitted
  updateSolution(db, id, patch: { title?; status? }): Promise<void>
  setTaskStatus(db, solutionId, taskId, status, note): Promise<void>
  listTaskStatuses(db, solutionId): Promise<TaskStatusRow[]>
  // tokens.ts
  TOKEN_PREFIX = 'rdi_'; MAX_TOKENS_PER_USER = 10
  hashToken(token): string
  createApiToken(db, { orgId, userId, name }): Promise<{ id; token; prefix; name; created_at }>  // token plaintext returned once
  listApiTokens(db, orgId, userId): Promise<{ id; name; prefix; last_used_at; created_at }[]>
  countApiTokens(db, orgId, userId): Promise<number>
  revokeApiToken(db, orgId, userId, id): Promise<number>
  resolveApiToken(db, token, now): Promise<{ tokenId; orgId; userId } | null>  // not revoked + still a member; touches last_used_at
  ```

- [ ] **Step 1: Write the failing test**

`apps/api/test/solutionQueries.integration.test.ts`:
```ts
import { sampleRegistry, validateSolutionDraft, type SolutionDraft } from '@rdi/scene';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addVersion, createSolution, findSolution, getVersion, listSolutions, listTaskStatuses, listVersions, setTaskStatus, updateSolution } from '../src/db/queries/solutions';
import { createApiToken, listApiTokens, resolveApiToken, revokeApiToken } from '../src/db/queries/tokens';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const scene = sampleRegistry['iot-telemetry']!;
const draft = (summary: string): SolutionDraft => {
  const result = validateSolutionDraft({ summary, sceneProposed: scene, plan: [{ id: 't1', title: 'Do it', nodeRefs: [scene.nodes[0]!.id] }, { id: 't2', title: 'Test it' }] });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.draft;
};
const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};

describe('solutions', () => {
  it('creates a solution with version 1 and appends versions', async () => {
    const { owner, org } = await setup();
    const { solution, version } = await createSolution(ctx.pool, { orgId: org.id, userId: owner.userId, title: 'Rate limits', conversationId: null, draft: draft('v1'), author: 'web' });
    expect(version.n).toBe(1);
    expect((await addVersion(ctx.pool, solution.id, 'claude-code', draft('v2'))).n).toBe(2);
    expect((await listVersions(ctx.pool, solution.id)).map((v) => [v.n, v.author, v.summary])).toEqual([[1, 'web', 'v1'], [2, 'claude-code', 'v2']]);
    expect((await getVersion(ctx.pool, solution.id))!.draft.summary).toBe('v2');
    expect((await getVersion(ctx.pool, solution.id, 1))!.draft.summary).toBe('v1');
  });

  it('never assigns the same version number to concurrent writers', async () => {
    const { owner, org } = await setup();
    const { solution } = await createSolution(ctx.pool, { orgId: org.id, userId: owner.userId, title: 'x', conversationId: null, draft: draft('v1'), author: 'web' });
    const versions = await Promise.all(Array.from({ length: 6 }, (_, i) => addVersion(ctx.pool, solution.id, 'web', draft(`c${i}`))));
    expect(versions.map((v) => v.n).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('tracks task status, progress and org scoping', async () => {
    const { owner, org } = await setup();
    const { solution } = await createSolution(ctx.pool, { orgId: org.id, userId: owner.userId, title: 'x', conversationId: null, draft: draft('v1'), author: 'web' });
    await setTaskStatus(ctx.pool, solution.id, 't1', 'done', 'merged');
    await setTaskStatus(ctx.pool, solution.id, 't1', 'done', 'merged again');
    expect((await listTaskStatuses(ctx.pool, solution.id)).map((t) => [t.task_id, t.status, t.note])).toEqual([['t1', 'done', 'merged again']]);
    await updateSolution(ctx.pool, solution.id, { status: 'in_progress', title: 'Renamed' });
    expect((await listSolutions(ctx.pool, org.id))[0]).toMatchObject({ title: 'Renamed', status: 'in_progress', latest_n: 1, tasks_total: 2, tasks_done: 1 });
    const other = await setup();
    expect(await findSolution(ctx.pool, other.org.id, solution.id)).toBeNull();
  });
});

describe('api tokens', () => {
  it('resolves active tokens only while the user is still a member', async () => {
    const { owner, org } = await setup();
    const created = await createApiToken(ctx.pool, { orgId: org.id, userId: owner.userId, name: 'laptop' });
    expect(created.token).toMatch(/^rdi_[A-Za-z0-9_-]{40,}$/);
    expect(created.prefix).toBe(created.token.slice(0, 10));
    expect(await resolveApiToken(ctx.pool, created.token, new Date())).toEqual({ tokenId: created.id, orgId: org.id, userId: owner.userId });
    expect((await listApiTokens(ctx.pool, org.id, owner.userId))[0]!.last_used_at).not.toBeNull();
    expect(await resolveApiToken(ctx.pool, 'rdi_wrong', new Date())).toBeNull();
    await ctx.pool.query('delete from memberships where org_id = $1 and user_id = $2', [org.id, owner.userId]);
    expect(await resolveApiToken(ctx.pool, created.token, new Date())).toBeNull();
  });

  it('revokes tokens', async () => {
    const { owner, org } = await setup();
    const created = await createApiToken(ctx.pool, { orgId: org.id, userId: owner.userId, name: 'ci' });
    expect(await revokeApiToken(ctx.pool, org.id, owner.userId, created.id)).toBe(1);
    expect(await resolveApiToken(ctx.pool, created.token, new Date())).toBeNull();
    expect(await listApiTokens(ctx.pool, org.id, owner.userId)).toEqual([]);
  });
});
```

Run: `npm run test:integration -w @rdi/api -- solutionQueries`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement**

`apps/api/src/db/migrations/004_solutions.sql`:
```sql
create table solutions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  created_by uuid references users (id) on delete set null,
  conversation_id uuid references conversations (id) on delete set null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'done', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index solutions_org on solutions (org_id, updated_at desc);

create table solution_versions (
  solution_id uuid not null references solutions (id) on delete cascade,
  n integer not null,
  author text not null check (author in ('web', 'claude-code')),
  draft jsonb not null,
  created_at timestamptz not null default now(),
  primary key (solution_id, n)
);

create table solution_task_status (
  solution_id uuid not null references solutions (id) on delete cascade,
  task_id text not null,
  status text not null check (status in ('todo', 'in_progress', 'done', 'blocked')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (solution_id, task_id)
);

create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  prefix text not null,
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_tokens_owner on api_tokens (org_id, user_id);
```

`apps/api/src/db/queries/solutions.ts`:
```ts
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
```

`apps/api/src/db/queries/tokens.ts`:
```ts
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
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): store solutions, versions, task status and API tokens

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Solution service, live events and REST routes

**Files:**
- Create: `apps/api/src/solutions/events.ts`, `apps/api/src/solutions/service.ts`, `apps/api/src/routes/solutions.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/solutions.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // events.ts
  type SolutionEvent = { type: 'version'; n: number; author: Author } | { type: 'task'; taskId: string; status: TaskStatus } | { type: 'meta' }
  solutionChannel(id): string; publishSolutionEvent(redis, id, event): Promise<void>
  // service.ts  (shared by REST, agent and MCP)
  class SolutionError extends Error { code: 'not_found' | 'invalid_draft' | 'unknown_task'; errors: string[] }
  createFromDraft(deps, { orgId, userId, title, conversationId, author, input }): Promise<{ id; n }>
  proposeVersion(deps, { orgId, solutionId, author, input, merge? }): Promise<{ n }>     // merge=true: unspecified fields inherit the latest version
  reportTask(deps, { orgId, solutionId, taskId, status, note }): Promise<void>          // also moves solution status draft→in_progress, all done→done
  solutionDetail(deps, orgId, id, n?): Promise<SolutionDetail | null>
  type SolutionDetail = { id; title; status; conversationId; versions: { n; author; summary; createdAt }[]; version: { n; author; createdAt; draft: SolutionDraft }; tasks: Record<string, { status; note; updatedAt }> }
  // routes
  GET    /api/orgs/:orgId/solutions                  → [{ id, title, status, latestVersion, progress: { done, total }, updatedAt }]
  POST   /api/orgs/:orgId/solutions {title, draft}   → 201 { id, n } · 422 invalid_draft { errors }
  GET    /api/orgs/:orgId/solutions/:id?version=n    → SolutionDetail
  POST   /api/orgs/:orgId/solutions/:id/versions {draft} → 201 { n }
  PATCH  /api/orgs/:orgId/solutions/:id {title?, status?}
  PATCH  /api/orgs/:orgId/solutions/:id/tasks/:taskId {status, note?} · 404 unknown_task
  GET    /api/orgs/:orgId/solutions/:id/events       → SSE `event: solution` per change, `: ping` heartbeats
  ```

- [ ] **Step 1: Write the failing test**

`apps/api/test/solutions.integration.test.ts`:
```ts
import http from 'node:http';
import { sampleRegistry } from '@rdi/scene';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const scene = sampleRegistry['iot-telemetry']!;
const draft = (summary: string) => ({ summary, sceneProposed: scene, plan: [{ id: 't1', title: 'Do it', nodeRefs: [scene.nodes[0]!.id] }, { id: 't2', title: 'Test it', dependsOn: ['t1'] }] });
type Who = Awaited<ReturnType<typeof signupVerified>>;
const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};
const call = (who: Who, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: method === 'GET' ? { cookie: who.cookie } : authed(who), ...(payload ? { payload } : {}) });

describe('solutions API', () => {
  it('creates, versions, lists and reads solutions', async () => {
    const { owner, org } = await setup();
    const created = await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'Rate limits', draft: draft('v1') });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/solutions/${id}/versions`, { draft: draft('v2') })).json()).toEqual({ n: 2 });
    const detail = (await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).json();
    expect(detail).toMatchObject({ id, title: 'Rate limits', status: 'draft', version: { n: 2, author: 'web', draft: { summary: 'v2' } }, tasks: {} });
    expect(detail.versions.map((v: { n: number }) => v.n)).toEqual([1, 2]);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}?version=1`)).json().version.draft.summary).toBe('v1');
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/solutions`)).json()).toEqual([{ id, title: 'Rate limits', status: 'draft', latestVersion: 2, progress: { done: 0, total: 2 }, updatedAt: expect.any(String) }]);
  });

  it('rejects invalid drafts with readable errors', async () => {
    const { owner, org } = await setup();
    const res = await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: { summary: 'x', sceneProposed: scene, plan: [{ id: 't1', title: 'A', nodeRefs: ['ghost'] }] } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: 'invalid_draft', errors: ['plan.t1: nodeRefs "ghost" is not a piece of the current or proposed scene'] } });
  });

  it('tracks task progress and moves the solution status', async () => {
    const { owner, org } = await setup();
    const { id } = (await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: draft('v1') })).json();
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t1`, { status: 'in_progress' })).statusCode).toBe(204);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).json().status).toBe('in_progress');
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t1`, { status: 'done', note: 'merged' });
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t2`, { status: 'done' });
    const detail = (await call(owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).json();
    expect(detail.status).toBe('done');
    expect(detail.tasks.t1).toMatchObject({ status: 'done', note: 'merged' });
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t9`, { status: 'done' })).json()).toEqual({ error: { code: 'unknown_task' } });
  });

  it('keeps solutions inside the organization but shares them with members', async () => {
    const { owner, org } = await setup();
    const { id } = (await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: draft('v1') })).json();
    const colleague = await signupVerified(ctx);
    await ctx.pool.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'member')", [org.id, colleague.userId]);
    expect((await call(colleague, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).statusCode).toBe(200);
    const stranger = await setup();
    expect((await call(stranger.owner, 'GET', `/api/orgs/${stranger.org.id}/solutions/${id}`)).statusCode).toBe(404);
    expect((await call(stranger.owner, 'GET', `/api/orgs/${org.id}/solutions/${id}`)).statusCode).toBe(404);
  });

  it('streams changes live to open solution pages', async () => {
    const { owner, org } = await setup();
    const { id } = (await call(owner, 'POST', `/api/orgs/${org.id}/solutions`, { title: 'x', draft: draft('v1') })).json();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as { port: number }).port;
    const received: string[] = [];
    const request = http.get({ host: '127.0.0.1', port, path: `/api/orgs/${org.id}/solutions/${id}/events`, headers: { cookie: owner.cookie } });
    const firstEvent = new Promise<void>((resolve) => {
      request.on('response', (res) => res.on('data', (chunk: Buffer) => {
        received.push(chunk.toString());
        if (received.join('').includes('event: solution')) resolve();
      }));
    });
    await new Promise((r) => setTimeout(r, 150));
    await call(owner, 'PATCH', `/api/orgs/${org.id}/solutions/${id}/tasks/t1`, { status: 'done' });
    await firstEvent;
    request.destroy();
    expect(received.join('')).toContain('data: {"type":"task","taskId":"t1","status":"done"}');
  });
});
```

Run: `npm run test:integration -w @rdi/api -- solutions.integration`
Expected: FAIL — routes missing (404s).

- [ ] **Step 2: Implement**

`apps/api/src/solutions/events.ts`:
```ts
import type { TaskStatus } from '@rdi/scene';
import type { Redis } from 'ioredis';
import type { Author } from '../db/queries/solutions';

export type SolutionEvent = { type: 'version'; n: number; author: Author } | { type: 'task'; taskId: string; status: TaskStatus } | { type: 'meta' };

export const solutionChannel = (id: string) => `rdi:solution:${id}`;

export const publishSolutionEvent = async (redis: Redis, id: string, event: SolutionEvent): Promise<void> => {
  await redis.publish(solutionChannel(id), JSON.stringify(event));
};
```

`apps/api/src/solutions/service.ts`:
```ts
import { validateSolutionDraft, type SolutionDraft, type TaskStatus } from '@rdi/scene';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { addVersion, createSolution, findSolution, getVersion, listTaskStatuses, listVersions, setTaskStatus, updateSolution, type Author } from '../db/queries/solutions';
import { publishSolutionEvent } from './events';

type Deps = { pool: pg.Pool; redis: Redis };
export type SolutionDetail = {
  id: string; title: string; status: string; conversationId: string | null;
  versions: { n: number; author: Author; summary: string; createdAt: string }[];
  version: { n: number; author: Author; createdAt: string; draft: SolutionDraft };
  tasks: Record<string, { status: TaskStatus; note: string | null; updatedAt: string }>;
};

export class SolutionError extends Error {
  constructor(public readonly code: 'not_found' | 'invalid_draft' | 'unknown_task', public readonly errors: string[] = []) {
    super(code);
  }
}

const validDraft = (input: unknown): SolutionDraft => {
  const result = validateSolutionDraft(input);
  if (!result.ok) throw new SolutionError('invalid_draft', result.errors);
  return result.draft;
};

export const createFromDraft = async (
  deps: Deps,
  input: { orgId: string; userId: string | null; title: string; conversationId: string | null; author: Author; input: unknown },
): Promise<{ id: string; n: number }> => {
  const { solution, version } = await createSolution(deps.pool, { orgId: input.orgId, userId: input.userId, title: input.title, conversationId: input.conversationId, draft: validDraft(input.input), author: input.author });
  return { id: solution.id, n: version.n };
};

export const proposeVersion = async (
  deps: Deps,
  input: { orgId: string; solutionId: string; author: Author; input: Record<string, unknown>; merge?: boolean },
): Promise<{ n: number }> => {
  if (!(await findSolution(deps.pool, input.orgId, input.solutionId))) throw new SolutionError('not_found');
  const latest = input.merge ? await getVersion(deps.pool, input.solutionId) : null;
  const merged = latest ? { ...latest.draft, ...Object.fromEntries(Object.entries(input.input).filter(([, v]) => v !== undefined)) } : input.input;
  const version = await addVersion(deps.pool, input.solutionId, input.author, validDraft(merged));
  await publishSolutionEvent(deps.redis, input.solutionId, { type: 'version', n: version.n, author: input.author });
  return { n: version.n };
};

export const reportTask = async (
  deps: Deps,
  input: { orgId: string; solutionId: string; taskId: string; status: TaskStatus; note: string | null },
): Promise<void> => {
  const solution = await findSolution(deps.pool, input.orgId, input.solutionId);
  if (!solution) throw new SolutionError('not_found');
  const latest = await getVersion(deps.pool, solution.id);
  const plan = latest?.draft.plan ?? [];
  if (!plan.some((t) => t.id === input.taskId)) throw new SolutionError('unknown_task');
  await setTaskStatus(deps.pool, solution.id, input.taskId, input.status, input.note);
  const statuses = new Map((await listTaskStatuses(deps.pool, solution.id)).map((t) => [t.task_id, t.status]));
  const allDone = plan.every((t) => statuses.get(t.id) === 'done');
  const next = allDone ? 'done' : solution.status === 'draft' && input.status !== 'todo' ? 'in_progress' : null;
  if (next && next !== solution.status) await updateSolution(deps.pool, solution.id, { status: next });
  await publishSolutionEvent(deps.redis, solution.id, { type: 'task', taskId: input.taskId, status: input.status });
};

export const solutionDetail = async (deps: Deps, orgId: string, id: string, n?: number): Promise<SolutionDetail | null> => {
  const solution = await findSolution(deps.pool, orgId, id);
  if (!solution) return null;
  const version = await getVersion(deps.pool, id, n);
  if (!version) return null;
  return {
    id: solution.id, title: solution.title, status: solution.status, conversationId: solution.conversation_id,
    versions: (await listVersions(deps.pool, id)).map((v) => ({ n: v.n, author: v.author, summary: v.summary, createdAt: v.created_at.toISOString() })),
    version: { n: version.n, author: version.author, createdAt: version.created_at.toISOString(), draft: version.draft },
    tasks: Object.fromEntries((await listTaskStatuses(deps.pool, id)).map((t) => [t.task_id, { status: t.status, note: t.note, updatedAt: t.updated_at.toISOString() }])),
  };
};
```

`apps/api/src/routes/solutions.ts`:
```ts
import { SOLUTION_STATUSES, TASK_STATUSES } from '@rdi/scene';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { listSolutions, updateSolution } from '../db/queries/solutions';
import { fail, isUuid, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';
import { publishSolutionEvent, solutionChannel } from '../solutions/events';
import { createFromDraft, proposeVersion, reportTask, solutionDetail, SolutionError } from '../solutions/service';

const MAX_TITLE = 200;
const HEARTBEAT_MS = 15_000;
const createBody = z.object({ title: z.string().trim().min(1).max(MAX_TITLE), draft: z.record(z.string(), z.unknown()) });
const versionBody = z.object({ draft: z.record(z.string(), z.unknown()) });
const patchBody = z.object({ title: z.string().trim().min(1).max(MAX_TITLE).optional(), status: z.enum(SOLUTION_STATUSES).optional() });
const taskBody = z.object({ status: z.enum(TASK_STATUSES), note: z.string().max(2000).optional() });
const detailQuery = z.object({ version: z.coerce.number().int().positive().optional() });

export const failSolution = (reply: FastifyReply, error: unknown) => {
  if (!(error instanceof SolutionError)) throw error;
  if (error.code === 'invalid_draft') return fail(reply, 422, 'invalid_draft', { errors: error.errors });
  return fail(reply, 404, error.code);
};

export const solutionRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const idOf = (params: unknown) => (params as { id: string }).id;

  api.get('/orgs/:orgId/solutions', { preHandler: member }, async (req) =>
    (await listSolutions(deps.pool, req.member!.org.id)).map((s) => ({
      id: s.id, title: s.title, status: s.status, latestVersion: s.latest_n, progress: { done: s.tasks_done, total: s.tasks_total }, updatedAt: s.updated_at.toISOString(),
    })));

  api.post('/orgs/:orgId/solutions', { preHandler: member }, async (req, reply) => {
    const body = createBody.parse(req.body);
    try {
      return reply.code(201).send(await createFromDraft(deps, { orgId: req.member!.org.id, userId: req.auth!.user.id, title: body.title, conversationId: null, author: 'web', input: body.draft }));
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.get('/orgs/:orgId/solutions/:id', { preHandler: member }, async (req, reply) => {
    const id = idOf(req.params);
    const { version } = detailQuery.parse(req.query);
    const detail = isUuid(id) ? await solutionDetail(deps, req.member!.org.id, id, version) : null;
    return detail ?? fail(reply, 404, 'not_found');
  });

  api.post('/orgs/:orgId/solutions/:id/versions', { preHandler: member }, async (req, reply) => {
    const id = idOf(req.params);
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    try {
      return reply.code(201).send(await proposeVersion(deps, { orgId: req.member!.org.id, solutionId: id, author: 'web', input: versionBody.parse(req.body).draft }));
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.patch('/orgs/:orgId/solutions/:id', { preHandler: member }, async (req, reply) => {
    const id = idOf(req.params);
    const body = patchBody.parse(req.body);
    if (!isUuid(id) || !(await solutionDetail(deps, req.member!.org.id, id))) return fail(reply, 404, 'not_found');
    await updateSolution(deps.pool, id, body);
    await publishSolutionEvent(deps.redis, id, { type: 'meta' });
    return reply.code(204).send();
  });

  api.patch('/orgs/:orgId/solutions/:id/tasks/:taskId', { preHandler: member }, async (req, reply) => {
    const { id, taskId } = req.params as { id: string; taskId: string };
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    const body = taskBody.parse(req.body);
    try {
      await reportTask(deps, { orgId: req.member!.org.id, solutionId: id, taskId, status: body.status, note: body.note ?? null });
      return reply.code(204).send();
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.get('/orgs/:orgId/solutions/:id/events', { preHandler: member }, async (req, reply) => {
    const id = idOf(req.params);
    if (!isUuid(id) || !(await solutionDetail(deps, req.member!.org.id, id))) return fail(reply, 404, 'not_found');
    const subscriber = deps.redis.duplicate();
    await subscriber.subscribe(solutionChannel(id));
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.write(': connected\n\n');
    subscriber.on('message', (_channel, message) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: solution\ndata: ${message}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, HEARTBEAT_MS);
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      subscriber.disconnect();
    });
    return reply;
  });
};
```

In `apps/api/src/app.ts` import `solutionRoutes` and register it after `agentRoutes(api, deps);`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS. If `app.listen` in the SSE test conflicts with `app.close()` in `ctx.close`, keep it — Fastify closes a listening server too.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add solution routes with live events

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The agent proposes solutions

**Files:**
- Modify: `apps/api/src/agent/tools.ts`, `apps/api/src/agent/runAgent.ts`, `apps/api/src/agent/prompt.ts`, `apps/api/src/agent/fakeLlm.ts`, `apps/api/src/routes/agent.ts`
- Test: `apps/api/test/agent/tools.test.ts`, `apps/api/test/agent/runAgent.test.ts`, `apps/api/test/agent/fakeLlm.test.ts`, `apps/api/test/agentRoutes.integration.test.ts`

**Interfaces:**
- `ToolContext` gains `upsertSolution(input: { solutionId?: string; title: string; draft: Record<string, unknown> }): Promise<{ id: string; n: number; title: string }>` (throws `SolutionError`).
- `ToolOutcome` gains `solution?: { id; n; title }`; `AgentEvent` gains `{ type: 'solution'; id: string; n: number; title: string }`.
- Tool `upsert_solution` input: `{ solutionId?, title, summary, sceneCurrent?, sceneProposed?, plan?, risks? }` (scenes as Scene v2 objects).
- Fake LLM: a question that starts with "I want" (any case) runs `search_graph`, then `upsert_solution` (proposed scene from the hits, one task per piece), then answers in text.
- `SYSTEM_PROMPT` mentions `upsert_solution`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/agent/tools.test.ts`:
```ts
describe('upsert_solution', () => {
  it('validates the draft and stores it through the context', async () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const upsert = vi.fn().mockResolvedValue({ id: 'sol1', n: 1, title: 'Rate limits' });
    const outcome = await executeTool('upsert_solution', { title: 'Rate limits', summary: 'Throttle devices', sceneProposed: scene, plan: [{ id: 't1', title: 'Limiter', nodeRefs: [scene.nodes[0]!.id] }] }, { ...ctx, upsertSolution: upsert });
    expect(outcome).toMatchObject({ solution: { id: 'sol1', n: 1, title: 'Rate limits' } });
    expect(outcome.content).toBe('Solution "Rate limits" saved as version 1 (id sol1).');
    expect(upsert).toHaveBeenCalledWith({ title: 'Rate limits', solutionId: undefined, draft: expect.objectContaining({ summary: 'Throttle devices' }) });
  });

  it('returns the validation errors of an invalid draft without storing it', async () => {
    const upsert = vi.fn();
    const outcome = await executeTool('upsert_solution', { title: 'x', summary: 'x', plan: [{ id: 't1', title: 'A', dependsOn: ['nope'] }] }, { ...ctx, upsertSolution: upsert });
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).toContain('dependsOn "nope"');
    expect(upsert).not.toHaveBeenCalled();
  });
});
```
(add `vi` to the vitest import of that file, and `upsertSolution: async () => ({ id: 'x', n: 1, title: 'x' })` to the shared `ctx` in `beforeAll`.)

Append inside `describe('runAgent', …)` of `apps/api/test/agent/runAgent.test.ts`:
```ts
  it('emits solution events', async () => {
    const scene = validScene;
    const { llm } = scripted([toolMsg({ id: 's', name: 'upsert_solution', input: { title: 'Plan', summary: 's', sceneProposed: scene, plan: [] } }), textMsg('Saved.')]);
    const { events, emit } = collect();
    await runAgent({ llm, system: 's', history: [], user, ctx: { ...ctx, upsertSolution: async () => ({ id: 'sol', n: 1, title: 'Plan' }) }, emit });
    expect(events).toContainEqual({ type: 'solution', id: 'sol', n: 1, title: 'Plan' });
  });
```
(add `upsertSolution: async () => ({ id: 'x', n: 1, title: 'x' })` to the file's `ctx`.)

Append inside `describe('createFakeLlm', …)` of `apps/api/test/agent/fakeLlm.test.ts`:
```ts
  it('turns "I want" requests into a solution', async () => {
    const user: Param = { role: 'user', content: [{ type: 'text', text: 'Respond in English (en).' }, { type: 'text', text: 'I want order cancellation' }] };
    const first = await turn([user]);
    const hits = [{ id: 'ep:a:POST /api/orders', label: 'Endpoint', name: 'POST /api/orders', summary: 'x' }, { id: 'queue:o:orders', label: 'Queue', name: 'orders', summary: 'q' }];
    const second = await turn([user, { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse(first).id, content: JSON.stringify(hits) }] }]);
    const input = toolUse(second).input as { title: string; plan: { nodeRefs: string[] }[]; sceneProposed: { nodes: { id: string }[] } };
    expect(toolUse(second).name).toBe('upsert_solution');
    expect(input.title).toBe('I want order cancellation');
    expect(input.plan.map((t) => t.nodeRefs[0])).toEqual(input.sceneProposed.nodes.map((n) => n.id));
  });
```

Append to `apps/api/test/agentRoutes.integration.test.ts`:
```ts
describe('solutions from chat', () => {
  it('stores the solution the agent proposes and streams it', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    const stream = events((await ask(owner, org.id, conv.id, { text: 'I want order cancellation' })).body);
    const solution = stream.find((e) => e.event === 'solution')!.data;
    expect(solution).toMatchObject({ n: 1, title: 'I want order cancellation' });
    const detail = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/solutions/${solution.id}`, headers: { cookie: owner.cookie } })).json();
    expect(detail).toMatchObject({ conversationId: conv.id, version: { n: 1, author: 'web' } });
    expect(detail.version.draft.plan.length).toBeGreaterThan(0);
  });
});
```

Run: `npm test -w @rdi/api; npm run test:integration -w @rdi/api -- agentRoutes`
Expected: FAIL — unknown tool `upsert_solution`, no `solution` events.

- [ ] **Step 2: Implement**

`apps/api/src/agent/tools.ts`:
- import `solutionDraftInputSchema, validateSolutionDraft` from `@rdi/scene` and `SolutionError` from `../solutions/service`.
- `ToolContext` gains `upsertSolution(input: { solutionId?: string; title: string; draft: Record<string, unknown> }): Promise<{ id: string; n: number; title: string }>;`
- `ToolOutcome` gains `solution?: { id: string; n: number; title: string };`
- `TOOL_NAMES` appends `'upsert_solution'`.
- add the input schema and definition:
```ts
const upsertInput = solutionDraftInputSchema.extend({ solutionId: z.string().uuid().optional(), title: z.string().trim().min(1).max(200) });
```
```ts
  {
    name: 'upsert_solution',
    description: 'Save a proposed change as a versioned Solution: a short summary, the current and proposed scenes (Scene v2, same rules as emit_scene), an ordered task plan whose nodeRefs are node ids of those scenes, and risks. Pass solutionId to add a new version to an existing solution. Use it when the user wants to change or build something.',
    input_schema: jsonSchemaOf(upsertInput),
  },
```
- the runner:
```ts
const upsertSolution = async (input: z.infer<typeof upsertInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const { solutionId, title, ...draft } = input;
  const result = validateSolutionDraft(draft);
  if (!result.ok) return { content: `The solution is invalid:\n${result.errors.slice(0, MAX_ERRORS).join('\n')}`, isError: true, summary: 'upsert_solution (invalid)' };
  try {
    const saved = await ctx.upsertSolution({ solutionId, title, draft });
    return { content: `Solution "${saved.title}" saved as version ${saved.n} (id ${saved.id}).`, solution: saved, summary: `upsert_solution "${saved.title}" v${saved.n}` };
  } catch (error) {
    if (error instanceof SolutionError) return { content: `Could not save the solution: ${error.code} ${error.errors.join('; ')}`.trim(), isError: true, summary: 'upsert_solution (rejected)' };
    throw error;
  }
};
```
  and a `case 'upsert_solution'` in `runTool` that parses with `upsertInput` (the raw scene objects stay `unknown` inside `solutionDraftInputSchema`, so pass `parsed.data` straight through).

`apps/api/src/agent/runAgent.ts`: add `| { type: 'solution'; id: string; n: number; title: string }` to `AgentEvent`; after the `outcome.scene` block add:
```ts
      if (outcome.solution) await input.emit({ type: 'solution', ...outcome.solution });
```

`apps/api/src/agent/prompt.ts`: add after the `get_pr_diff` line:
```ts
  '- When the user wants to change, add or build something, design the change with them and save it with upsert_solution: a summary, the current and proposed scenes, an ordered task plan (each task names the pieces it touches in nodeRefs and lists acceptance criteria) and the risks. Use solutionId to revise a solution you already saved in this conversation. Mark pieces of the proposed scene with change added, modified or removed.',
```

`apps/api/src/agent/fakeLlm.ts`: `sceneFrom` gains a `change` option; add
```ts
const WANT = /^i want\b/i;
const questionText = (messages: Param[]) => {
  for (const m of [...messages].reverse()) if (m.role === 'user' && !blocks(m).some((b) => b.type === 'tool_result')) return textOf(m).at(-1) ?? '';
  return '';
};
```
and in the `search_graph` result branch, before emitting a scene:
```ts
      const question = questionText(messages);
      if (WANT.test(question)) {
        const proposed = { ...sceneFrom(hits, languageOf(messages)), nodes: sceneFrom(hits, languageOf(messages)).nodes.map((n, i) => ({ ...n, change: i === 0 ? 'modified' : undefined })) };
        const plan = proposed.nodes.map((n, i) => ({ id: `t${i + 1}`, title: `Update ${n.label}`, nodeRefs: [n.id], acceptance: ['Existing tests pass'], dependsOn: i === 0 ? [] : [`t${i}`] }));
        return toolUse('upsert_solution', { title: question.slice(0, 200), summary: `Proposed change: ${question}`, sceneProposed: proposed, plan, risks: [{ title: 'Behaviour change for existing clients', severity: 'medium' }] });
      }
```
(build `sceneFrom` once into a variable; drop the `change` key when undefined so the scene validates.) In the final-text branch nothing changes (the tool result's first line is echoed).

`apps/api/src/routes/agent.ts` — add to the `toolContext` of the messages route:
```ts
      upsertSolution: async ({ solutionId, title, draft }) => {
        if (solutionId) {
          const { n } = await proposeVersion(deps, { orgId, solutionId, author: 'web', input: draft });
          if (title) await updateSolution(deps.pool, solutionId, { title });
          return { id: solutionId, n, title };
        }
        const created = await createFromDraft(deps, { orgId, userId: req.auth!.user.id, title, conversationId: conversation.id, author: 'web', input: draft });
        return { ...created, title };
      },
```
(import `createFromDraft`, `proposeVersion` from `../solutions/service` and `updateSolution` from `../db/queries/solutions`.) The existing `emit` already forwards non-scene events with `send(type, data)`, so `solution` events reach the client.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): let the agent propose versioned solutions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Personal access tokens and MCP info

**Files:**
- Create: `apps/api/src/routes/tokens.ts`
- Modify: `apps/api/src/config.ts` (+ `publicApiUrl` from `PUBLIC_API_URL`, default `http://localhost:4040`), `apps/api/src/app.ts`, `apps/api/test/health.test.ts`
- Test: `apps/api/test/tokens.integration.test.ts`

**Interfaces:**
- `GET /api/orgs/:orgId/tokens` → `[{ id, name, prefix, lastUsedAt, createdAt }]`
- `POST /api/orgs/:orgId/tokens {name}` → 201 `{ id, name, prefix, token, createdAt }` · 409 `token_limit`
- `DELETE /api/orgs/:orgId/tokens/:id` → 204 · 404
- `GET /api/mcp-info` (auth) → `{ url: `${publicApiUrl}/mcp`, serverName: 'repository-designer' }`

- [ ] **Step 1: Write the failing test**

Add `publicApiUrl: 'http://localhost:4040',` to the exact `loadConfig({})` expectation in `apps/api/test/health.test.ts`.

`apps/api/test/tokens.integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_TOKENS_PER_USER } from '../src/db/queries/tokens';
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

describe('access tokens', () => {
  it('creates a token shown once, lists it without the secret and revokes it', async () => {
    const { owner, org } = await setup();
    const created = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/tokens`, headers: authed(owner), payload: { name: 'laptop' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().token).toMatch(/^rdi_/);
    const list = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/tokens`, headers: { cookie: owner.cookie } })).json();
    expect(list).toEqual([{ id: created.json().id, name: 'laptop', prefix: created.json().prefix, lastUsedAt: null, createdAt: expect.any(String) }]);
    expect(JSON.stringify(list)).not.toContain(created.json().token);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/orgs/${org.id}/tokens/${created.json().id}`, headers: authed(owner) })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/orgs/${org.id}/tokens/${created.json().id}`, headers: authed(owner) })).statusCode).toBe(404);
  });

  it('limits tokens per user and exposes the MCP url', async () => {
    const { owner, org } = await setup();
    for (let i = 0; i < MAX_TOKENS_PER_USER; i++) await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/tokens`, headers: authed(owner), payload: { name: `t${i}` } });
    expect((await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/tokens`, headers: authed(owner), payload: { name: 'one more' } })).json()).toEqual({ error: { code: 'token_limit' } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/mcp-info', headers: { cookie: owner.cookie } })).json()).toEqual({ url: 'http://localhost:4040/mcp', serverName: 'repository-designer' });
  });
});
```

Run: `npm test -w @rdi/api -- health; npm run test:integration -w @rdi/api -- tokens`
Expected: FAIL.

- [ ] **Step 2: Implement**

`apps/api/src/config.ts`: `Config` gains `publicApiUrl: string`; `DEFAULTS` gains `PUBLIC_API_URL: 'http://localhost:4040'`; returned object gains `publicApiUrl: read('PUBLIC_API_URL').replace(/\/$/, ''),`.

`apps/api/src/routes/tokens.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { countApiTokens, createApiToken, listApiTokens, MAX_TOKENS_PER_USER, revokeApiToken } from '../db/queries/tokens';
import { fail, isUuid, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';

export const MCP_SERVER_NAME = 'repository-designer';
const MAX_NAME = 80;

export const tokenRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];

  api.get('/orgs/:orgId/tokens', { preHandler: member }, async (req) =>
    (await listApiTokens(deps.pool, req.member!.org.id, req.auth!.user.id)).map((t) => ({
      id: t.id, name: t.name, prefix: t.prefix, lastUsedAt: t.last_used_at?.toISOString() ?? null, createdAt: t.created_at.toISOString(),
    })));

  api.post('/orgs/:orgId/tokens', { preHandler: member }, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(MAX_NAME) }).parse(req.body);
    const orgId = req.member!.org.id;
    if ((await countApiTokens(deps.pool, orgId, req.auth!.user.id)) >= MAX_TOKENS_PER_USER) return fail(reply, 409, 'token_limit');
    const created = await createApiToken(deps.pool, { orgId, userId: req.auth!.user.id, name });
    return reply.code(201).send({ id: created.id, name: created.name, prefix: created.prefix, token: created.token, createdAt: created.created_at.toISOString() });
  });

  api.delete('/orgs/:orgId/tokens/:id', { preHandler: member }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id) || (await revokeApiToken(deps.pool, req.member!.org.id, req.auth!.user.id, id)) === 0) return fail(reply, 404, 'not_found');
    return reply.code(204).send();
  });

  api.get('/mcp-info', { preHandler: requireAuth }, async () => ({ url: `${deps.config.publicApiUrl}/mcp`, serverName: MCP_SERVER_NAME }));
};
```

Register `tokenRoutes(api, deps);` in `app.ts` after `solutionRoutes`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add personal access tokens for the MCP server

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Remote MCP server

**Files:**
- Create: `apps/api/src/mcp/server.ts`, `apps/api/src/mcp/route.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/package.json` (+ `@modelcontextprotocol/sdk@1.31.0` exact)
- Test: `apps/api/test/mcp.integration.test.ts`

**Interfaces:**
- `POST /mcp` (outside the `/api` prefix) — stateless Streamable HTTP, JSON responses; `GET`/`DELETE /mcp` → 405. `Authorization: Bearer rdi_…` required (401 JSON-RPC error `-32001` otherwise).
- `buildMcpServer(ctx: McpContext): McpServer` with `McpContext = { orgId; userId; pool; redis; graph?: GraphStore }` and tools:
  - `list_solutions {status?}` → JSON list
  - `get_solution {id, version?}` → JSON `{ id, title, status, version, summary, plan: [{ ...task, status, note }], risks, scenes: { current, proposed }, context: { [nodeId]: { label, kind, summary, code?, graph?: { id, summary, neighbors: [{ type, direction, name }] } } } }`
  - `query_graph {action: 'search' | 'neighbors' | 'path', query?, id?, from?, to?}` → reuses `executeTool` (`search_graph` / `get_neighbors` / `find_path`)
  - `update_solution {id, summary, plan?, sceneProposed?, sceneCurrent?, risks?}` → new version (`claude-code`), unspecified fields inherit the latest
  - `report_task_progress {id, taskId, status, note?}`
  Errors are tool results with `isError: true` and a readable text.

- [ ] **Step 1: Dependency**

Run:
```bash
npm install -w @rdi/api @modelcontextprotocol/sdk@1.31.0 --save-exact
grep -n '"@modelcontextprotocol/sdk"' apps/api/package.json
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/mcp.integration.test.ts`:
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { sampleRegistry } from '@rdi/scene';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const scene = sampleRegistry['iot-telemetry']!;
const draft = { summary: 'v1', sceneProposed: scene, plan: [{ id: 't1', title: 'Do it', nodeRefs: [scene.nodes[0]!.id], acceptance: ['works'] }, { id: 't2', title: 'Test it' }] };
const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  const token = (await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/tokens`, headers: authed(owner), payload: { name: 'cc' } })).json().token as string;
  const solution = (await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/solutions`, headers: authed(owner), payload: { title: 'Rate limits', draft } })).json() as { id: string };
  return { owner, org, token, solution };
};
let rpcId = 0;
const rpc = (token: string | null, method: string, params: object = {}) =>
  ctx.app.inject({
    method: 'POST', url: '/mcp',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
const callTool = async (token: string, name: string, args: object) => (await rpc(token, 'tools/call', { name, arguments: args })).json().result as { content: { text: string }[]; isError?: boolean };

describe('MCP endpoint', () => {
  it('requires a valid token', async () => {
    expect((await rpc(null, 'tools/list')).statusCode).toBe(401);
    expect((await rpc('rdi_nope', 'tools/list')).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
  });

  it('lists the tools', async () => {
    const { token } = await setup();
    const tools = (await rpc(token, 'tools/list')).json().result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(['list_solutions', 'get_solution', 'query_graph', 'update_solution', 'report_task_progress']);
  });

  it('returns a solution with its plan, task status and piece context', async () => {
    const { token, solution } = await setup();
    expect(JSON.parse((await callTool(token, 'list_solutions', {})).content[0]!.text)).toEqual([expect.objectContaining({ id: solution.id, title: 'Rate limits', latestVersion: 1 })]);
    const detail = JSON.parse((await callTool(token, 'get_solution', { id: solution.id })).content[0]!.text);
    expect(detail).toMatchObject({ id: solution.id, version: 1, summary: 'v1', plan: [{ id: 't1', status: 'todo' }, { id: 't2', status: 'todo' }] });
    expect(detail.context[scene.nodes[0]!.id]).toMatchObject({ label: scene.nodes[0]!.label });
  });

  it('records versions and progress as Claude Code', async () => {
    const { owner, org, token, solution } = await setup();
    const update = await callTool(token, 'update_solution', { id: solution.id, summary: 'v2 from Claude Code' });
    expect(update.content[0]!.text).toBe('Saved version 2.');
    const progress = await callTool(token, 'report_task_progress', { id: solution.id, taskId: 't1', status: 'done', note: 'PR #12' });
    expect(progress.isError).toBeFalsy();
    const detail = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/solutions/${solution.id}`, headers: { cookie: owner.cookie } })).json();
    expect(detail).toMatchObject({ status: 'in_progress', version: { n: 2, author: 'claude-code', draft: { summary: 'v2 from Claude Code', plan: [{ id: 't1' }, { id: 't2' }] } }, tasks: { t1: { status: 'done', note: 'PR #12' } } });
  });

  it('rejects invalid updates, unknown tasks and other organizations', async () => {
    const { token, solution } = await setup();
    expect(await callTool(token, 'update_solution', { id: solution.id, summary: 'x', plan: [{ id: 't1', title: 'A', dependsOn: ['zz'] }] })).toMatchObject({ isError: true });
    expect(await callTool(token, 'report_task_progress', { id: solution.id, taskId: 'nope', status: 'done' })).toMatchObject({ isError: true });
    const other = await setup();
    expect(await callTool(other.token, 'get_solution', { id: solution.id })).toMatchObject({ isError: true, content: [{ text: 'Solution not found.' }] });
    expect(await callTool(other.token, 'report_task_progress', { id: solution.id, taskId: 't1', status: 'done' })).toMatchObject({ isError: true });
  });

  it('works with the official MCP client over HTTP', async () => {
    const { token, solution } = await setup();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as { port: number }).port;
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const result = await client.callTool({ name: 'get_solution', arguments: { id: solution.id } });
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).title).toBe('Rate limits');
    await client.close();
  });
});
```

Run: `npm run test:integration -w @rdi/api -- mcp`
Expected: FAIL — `/mcp` is 404.

- [ ] **Step 3: Implement**

`apps/api/src/mcp/server.ts`:
```ts
import type { GraphStore } from '@rdi/graph';
import { SOLUTION_STATUSES, TASK_STATUSES, type Scene } from '@rdi/scene';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { z } from 'zod';
import { executeTool, type ToolContext } from '../agent/tools';
import { listSolutions } from '../db/queries/solutions';
import { readSource } from '../db/queries/agent';
import { MCP_SERVER_NAME } from '../routes/tokens';
import { proposeVersion, reportTask, solutionDetail, SolutionError } from '../solutions/service';

export type McpContext = { orgId: string; userId: string; pool: pg.Pool; redis: Redis; graph?: GraphStore };
const SERVER_VERSION = '1.0.0';
const MAX_NEIGHBORS = 12;

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ ...text(message), isError: true });
const solutionFailure = (error: unknown) => {
  if (!(error instanceof SolutionError)) throw error;
  if (error.code === 'not_found') return failure('Solution not found.');
  if (error.code === 'unknown_task') return failure('That task is not part of the latest version of the plan.');
  return failure(`The solution is invalid:\n${error.errors.join('\n')}`);
};

export const buildMcpServer = (ctx: McpContext): McpServer => {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: SERVER_VERSION });
  const deps = { pool: ctx.pool, redis: ctx.redis };
  const toolContext: ToolContext = {
    loadGraph: () => (ctx.graph ? ctx.graph.readOrgGraph(ctx.orgId) : Promise.resolve({ nodes: [], edges: [] })),
    readSource: (repo, path) => readSource(ctx.pool, ctx.orgId, repo, path),
    prFiles: async () => null,
    upsertSolution: async () => {
      throw new SolutionError('not_found');
    },
  };

  server.registerTool('list_solutions', {
    description: 'List the Solutions of the organization (planned changes designed in Repository Designer).',
    inputSchema: { status: z.enum(SOLUTION_STATUSES).optional() },
  }, async ({ status }) => {
    const rows = (await listSolutions(ctx.pool, ctx.orgId)).filter((s) => !status || s.status === status);
    return text(rows.map((s) => ({ id: s.id, title: s.title, status: s.status, latestVersion: s.latest_n, progress: { done: s.tasks_done, total: s.tasks_total } })));
  });

  server.registerTool('get_solution', {
    description: 'Get a Solution: summary, ordered task plan with status, risks, current/proposed scenes and context for every piece the tasks touch (graph summary, neighbours and code locations). Call this before implementing.',
    inputSchema: { id: z.string().uuid(), version: z.number().int().positive().optional() },
  }, async ({ id, version }) => {
    const detail = await solutionDetail(deps, ctx.orgId, id, version);
    if (!detail) return failure('Solution not found.');
    const { draft } = detail.version;
    const pieces = new Map([...(draft.sceneCurrent?.nodes ?? []), ...(draft.sceneProposed?.nodes ?? [])].map((n) => [n.id, n]));
    const graph = ctx.graph ? await ctx.graph.readOrgGraph(ctx.orgId) : { nodes: [], edges: [] };
    const graphNodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const referenced = new Set(draft.plan.flatMap((t) => t.nodeRefs));
    const context = Object.fromEntries([...referenced].flatMap((ref) => {
      const piece = pieces.get(ref);
      if (!piece) return [];
      const g = piece.graphRef ? graphNodes.get(piece.graphRef) : undefined;
      const neighbors = g
        ? graph.edges.filter((e) => e.from === g.id || e.to === g.id).slice(0, MAX_NEIGHBORS).map((e) => ({ type: e.type, direction: e.from === g.id ? 'out' : 'in', name: graphNodes.get(e.from === g.id ? e.to : e.from)?.name ?? '' }))
        : [];
      return [[ref, { label: piece.label, kind: piece.kind, summary: piece.summary, ...(piece.code ? { code: piece.code } : {}), ...(g ? { graph: { id: g.id, summary: g.summary, neighbors } } : {}) }]];
    }));
    const sceneBrief = (scene: Scene | null) => (scene ? { title: scene.title, nodes: scene.nodes.map((n) => ({ id: n.id, label: n.label, role: n.role, kind: n.kind, change: n.change ?? null, parent: n.parent ?? null })) } : null);
    return text({
      id: detail.id, title: detail.title, status: detail.status, version: detail.version.n, summary: draft.summary,
      plan: draft.plan.map((t) => ({ ...t, status: detail.tasks[t.id]?.status ?? 'todo', note: detail.tasks[t.id]?.note ?? null })),
      risks: draft.risks, scenes: { current: sceneBrief(draft.sceneCurrent), proposed: sceneBrief(draft.sceneProposed) }, context,
    });
  });

  server.registerTool('query_graph', {
    description: 'Query the organization System Graph: action "search" (query), "neighbors" (id) or "path" (from, to).',
    inputSchema: { action: z.enum(['search', 'neighbors', 'path']), query: z.string().optional(), id: z.string().optional(), from: z.string().optional(), to: z.string().optional() },
  }, async ({ action, query, id, from, to }) => {
    const outcome =
      action === 'search' ? await executeTool('search_graph', { query }, toolContext)
      : action === 'neighbors' ? await executeTool('get_neighbors', { id }, toolContext)
      : await executeTool('find_path', { from, to }, toolContext);
    return outcome.isError ? failure(outcome.content) : text(outcome.content);
  });

  server.registerTool('update_solution', {
    description: 'Save a new version of a Solution as Claude Code (for example after discovering the plan must change). Fields you omit are kept from the latest version.',
    inputSchema: {
      id: z.string().uuid(), summary: z.string().min(1).max(4000),
      plan: z.array(z.record(z.string(), z.unknown())).optional(), risks: z.array(z.record(z.string(), z.unknown())).optional(),
      sceneProposed: z.record(z.string(), z.unknown()).optional(), sceneCurrent: z.record(z.string(), z.unknown()).optional(),
    },
  }, async ({ id, ...draft }) => {
    try {
      const { n } = await proposeVersion(deps, { orgId: ctx.orgId, solutionId: id, author: 'claude-code', input: draft, merge: true });
      return text(`Saved version ${n}.`);
    } catch (error) {
      return solutionFailure(error);
    }
  });

  server.registerTool('report_task_progress', {
    description: 'Report progress on a task of the latest plan: in_progress when you start, done when finished (with a short note such as the PR or commit), blocked with the reason.',
    inputSchema: { id: z.string().uuid(), taskId: z.string().min(1), status: z.enum(TASK_STATUSES), note: z.string().max(2000).optional() },
  }, async ({ id, taskId, status, note }) => {
    try {
      await reportTask(deps, { orgId: ctx.orgId, solutionId: id, taskId, status, note: note ?? null });
      return text(`Task ${taskId} is now ${status}.`);
    } catch (error) {
      return solutionFailure(error);
    }
  });

  return server;
};
```

`apps/api/src/mcp/route.ts`:
```ts
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { resolveApiToken } from '../db/queries/tokens';
import { nowOf, type AppDeps } from '../http/deps';
import { buildMcpServer } from './server';

const BEARER = /^Bearer\s+(\S+)$/i;
const UNAUTHORIZED = -32001;
const METHOD_NOT_ALLOWED = -32000;

const rpcError = (reply: FastifyReply, status: number, code: number, message: string) =>
  reply.code(status).send({ jsonrpc: '2.0', error: { code, message }, id: null });

export const mcpRoutes = (app: FastifyInstance, deps: AppDeps) => {
  app.post('/mcp', async (req, reply) => {
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    const identity = token ? await resolveApiToken(deps.pool, token, nowOf(deps)) : null;
    if (!identity) return rpcError(reply, 401, UNAUTHORIZED, 'A valid Repository Designer access token is required.');
    const server = buildMcpServer({ orgId: identity.orgId, userId: identity.userId, pool: deps.pool, redis: deps.redis, graph: deps.graph });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
    return reply;
  });
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({ method, url: '/mcp', handler: async (_req, reply) => rpcError(reply, 405, METHOD_NOT_ALLOWED, 'Method not allowed.') });
  }
};
```

In `apps/api/src/app.ts` register `mcpRoutes(app, deps)` on the root Fastify instance (outside the `/api` prefix plugin), next to `/health`. If `deps` is optional in `buildApp`, register it only when `deps` is present.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS. If the SDK's `ZodRawShapeCompat` rejects Zod 4 schemas from `zod`, import `* as z from 'zod/v4'` in `mcp/server.ts` (the SDK example does) and ledger it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add the remote MCP server for Claude Code

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Web — solutions client and catalog

**Files:**
- Create: `apps/web/src/shell/solutions/solutionsApi.ts`
- Modify: `apps/web/src/i18n/shellMessages.ts`
- Test: `apps/web/test/shell/solutionsApi.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type SolutionSummary = { id; title; status: SolutionStatus; latestVersion: number; progress: { done; total }; updatedAt }
  type SolutionDetail = { id; title; status; conversationId; versions: { n; author; summary; createdAt }[]; version: { n; author; createdAt; draft: SolutionDraft }; tasks: Record<string, { status: TaskStatus; note: string | null; updatedAt }> }
  solutionKey(orgId, id, n?) ; solutionScenes(detail): Scene[]     // proposed, current, changes (when both) with ids `${id}-v${n}-proposed|current|changes` and titles "Proposed · v3" etc.
  subscribeSolution(orgId, id, onEvent: () => void): () => void   // EventSource on /api/orgs/:orgId/solutions/:id/events
  ```
- Catalog keys (en/es/pt): `nav.solutions`, `nav.tokens`, `solutions.*`, `tokens.*`, `handoff.*`, `plan.*`, `taskStatus.*`, `solutionStatus.*`, `errors.invalid_draft`, `errors.unknown_task`, `errors.token_limit` (exact English text in Step 1).

- [ ] **Step 1: Catalog keys**

Add to `shellEn`:
```ts
  'nav.solutions': 'Solutions',
  'nav.tokens': 'Access tokens',
  'solutions.title': 'Solutions',
  'solutions.subtitle': 'Planned changes designed with the agent, ready to hand off to Claude Code.',
  'solutions.empty': 'No solutions yet. In the chat, describe a change you want ("I want …") and the agent will design one.',
  'solutions.progress': '{done} of {total} tasks',
  'solutions.version': 'v{n}',
  'solutions.open': 'Open',
  'solutionStatus.draft': 'draft',
  'solutionStatus.in_progress': 'in progress',
  'solutionStatus.done': 'done',
  'solutionStatus.archived': 'archived',
  'taskStatus.todo': 'to do',
  'taskStatus.in_progress': 'in progress',
  'taskStatus.done': 'done',
  'taskStatus.blocked': 'blocked',
  'plan.title': 'Plan',
  'plan.version': 'Version',
  'plan.by.web': 'by the web agent',
  'plan.by.claude-code': 'by Claude Code',
  'plan.risks': 'Risks',
  'plan.acceptance': 'Acceptance',
  'plan.dependsOn': 'After {tasks}',
  'plan.execute': 'Execute in Claude Code',
  'plan.updated': 'Updated live',
  'scene.proposed': 'Proposed · v{n}',
  'scene.current': 'Current · v{n}',
  'scene.changes': 'Changes · v{n}',
  'handoff.title': 'Execute in Claude Code',
  'handoff.step1': '1. Connect the Repository Designer MCP server (once per machine):',
  'handoff.step2': '2. In your repository, start Claude Code with this solution:',
  'handoff.createToken': 'Create an access token',
  'handoff.tokenOnce': 'This token is shown only once. It is already inside the command above.',
  'handoff.copy': 'Copy',
  'handoff.copied': 'Copied',
  'handoff.close': 'Close',
  'tokens.title': 'Access tokens',
  'tokens.subtitle': 'Personal tokens let Claude Code read and update this organization’s solutions through MCP.',
  'tokens.name': 'Token name',
  'tokens.create': 'Create token',
  'tokens.created': 'Copy your new token now — it will not be shown again:',
  'tokens.empty': 'No active tokens.',
  'tokens.lastUsed': 'last used {when}',
  'tokens.neverUsed': 'never used',
  'tokens.revoke': 'Revoke',
  'errors.invalid_draft': 'The solution is not valid.',
  'errors.unknown_task': 'That task is not part of the plan.',
  'errors.token_limit': 'You reached the maximum number of tokens. Revoke one first.',
```
Add to `shellEs`:
```ts
  'nav.solutions': 'Soluciones',
  'nav.tokens': 'Tokens de acceso',
  'solutions.title': 'Soluciones',
  'solutions.subtitle': 'Cambios planificados con el agente, listos para pasarle a Claude Code.',
  'solutions.empty': 'Todavía no hay soluciones. En el chat, describí el cambio que querés ("Quiero …" o "I want …") y el agente diseña una.',
  'solutions.progress': '{done} de {total} tareas',
  'solutions.version': 'v{n}',
  'solutions.open': 'Abrir',
  'solutionStatus.draft': 'borrador',
  'solutionStatus.in_progress': 'en curso',
  'solutionStatus.done': 'terminada',
  'solutionStatus.archived': 'archivada',
  'taskStatus.todo': 'pendiente',
  'taskStatus.in_progress': 'en curso',
  'taskStatus.done': 'hecha',
  'taskStatus.blocked': 'bloqueada',
  'plan.title': 'Plan',
  'plan.version': 'Versión',
  'plan.by.web': 'por el agente web',
  'plan.by.claude-code': 'por Claude Code',
  'plan.risks': 'Riesgos',
  'plan.acceptance': 'Aceptación',
  'plan.dependsOn': 'Después de {tasks}',
  'plan.execute': 'Ejecutar en Claude Code',
  'plan.updated': 'Se actualiza en vivo',
  'scene.proposed': 'Propuesta · v{n}',
  'scene.current': 'Actual · v{n}',
  'scene.changes': 'Cambios · v{n}',
  'handoff.title': 'Ejecutar en Claude Code',
  'handoff.step1': '1. Conectá el servidor MCP de Repository Designer (una vez por máquina):',
  'handoff.step2': '2. En tu repositorio, iniciá Claude Code con esta solución:',
  'handoff.createToken': 'Crear un token de acceso',
  'handoff.tokenOnce': 'Este token se muestra una sola vez. Ya está dentro del comando de arriba.',
  'handoff.copy': 'Copiar',
  'handoff.copied': 'Copiado',
  'handoff.close': 'Cerrar',
  'tokens.title': 'Tokens de acceso',
  'tokens.subtitle': 'Los tokens personales le permiten a Claude Code leer y actualizar las soluciones de esta organización vía MCP.',
  'tokens.name': 'Nombre del token',
  'tokens.create': 'Crear token',
  'tokens.created': 'Copiá tu nuevo token ahora — no se va a volver a mostrar:',
  'tokens.empty': 'No hay tokens activos.',
  'tokens.lastUsed': 'último uso {when}',
  'tokens.neverUsed': 'sin uso',
  'tokens.revoke': 'Revocar',
  'errors.invalid_draft': 'La solución no es válida.',
  'errors.unknown_task': 'Esa tarea no es parte del plan.',
  'errors.token_limit': 'Llegaste al máximo de tokens. Revocá uno primero.',
```
Add to `shellPt`:
```ts
  'nav.solutions': 'Soluções',
  'nav.tokens': 'Tokens de acesso',
  'solutions.title': 'Soluções',
  'solutions.subtitle': 'Mudanças planejadas com o agente, prontas para entregar ao Claude Code.',
  'solutions.empty': 'Ainda não há soluções. No chat, descreva a mudança que você quer ("Quero …" ou "I want …") e o agente desenha uma.',
  'solutions.progress': '{done} de {total} tarefas',
  'solutions.version': 'v{n}',
  'solutions.open': 'Abrir',
  'solutionStatus.draft': 'rascunho',
  'solutionStatus.in_progress': 'em andamento',
  'solutionStatus.done': 'concluída',
  'solutionStatus.archived': 'arquivada',
  'taskStatus.todo': 'a fazer',
  'taskStatus.in_progress': 'em andamento',
  'taskStatus.done': 'feita',
  'taskStatus.blocked': 'bloqueada',
  'plan.title': 'Plano',
  'plan.version': 'Versão',
  'plan.by.web': 'pelo agente web',
  'plan.by.claude-code': 'pelo Claude Code',
  'plan.risks': 'Riscos',
  'plan.acceptance': 'Aceitação',
  'plan.dependsOn': 'Depois de {tasks}',
  'plan.execute': 'Executar no Claude Code',
  'plan.updated': 'Atualiza ao vivo',
  'scene.proposed': 'Proposta · v{n}',
  'scene.current': 'Atual · v{n}',
  'scene.changes': 'Mudanças · v{n}',
  'handoff.title': 'Executar no Claude Code',
  'handoff.step1': '1. Conecte o servidor MCP do Repository Designer (uma vez por máquina):',
  'handoff.step2': '2. No seu repositório, inicie o Claude Code com esta solução:',
  'handoff.createToken': 'Criar um token de acesso',
  'handoff.tokenOnce': 'Este token é mostrado só uma vez. Ele já está dentro do comando acima.',
  'handoff.copy': 'Copiar',
  'handoff.copied': 'Copiado',
  'handoff.close': 'Fechar',
  'tokens.title': 'Tokens de acesso',
  'tokens.subtitle': 'Tokens pessoais permitem que o Claude Code leia e atualize as soluções desta organização via MCP.',
  'tokens.name': 'Nome do token',
  'tokens.create': 'Criar token',
  'tokens.created': 'Copie seu novo token agora — ele não será mostrado de novo:',
  'tokens.empty': 'Nenhum token ativo.',
  'tokens.lastUsed': 'último uso {when}',
  'tokens.neverUsed': 'nunca usado',
  'tokens.revoke': 'Revogar',
  'errors.invalid_draft': 'A solução não é válida.',
  'errors.unknown_task': 'Essa tarefa não faz parte do plano.',
  'errors.token_limit': 'Você atingiu o máximo de tokens. Revogue um primeiro.',
```
Skip any key that already exists.

- [ ] **Step 2: Write the failing test**

`apps/web/test/shell/solutionsApi.test.ts`:
```ts
import { sampleRegistry } from '@rdi/scene';
import { solutionScenes, subscribeSolution, type SolutionDetail } from '../../src/shell/solutions/solutionsApi';

const scene = sampleRegistry['iot-telemetry']!;
const detail = (current: boolean): SolutionDetail => ({
  id: 'sol', title: 'Rate limits', status: 'draft', conversationId: null, versions: [{ n: 3, author: 'web', summary: 's', createdAt: '2026-10-01T10:00:00Z' }],
  version: { n: 3, author: 'web', createdAt: '2026-10-01T10:00:00Z', draft: { summary: 's', sceneProposed: { ...scene, nodes: scene.nodes.slice(1) }, sceneCurrent: current ? scene : null, plan: [], risks: [] } },
  tasks: {},
});
const t = (key: string, params?: Record<string, string | number>) => `${key}:${params?.n ?? ''}`;

describe('solutionScenes', () => {
  it('offers proposed, current and changes scenes with unique ids and version titles', () => {
    const scenes = solutionScenes(detail(true), t as never);
    expect(scenes.map((s) => s.id)).toEqual(['sol-v3-proposed', 'sol-v3-current', 'sol-v3-changes']);
    expect(scenes.map((s) => s.title)).toEqual(['scene.proposed:3', 'scene.current:3', 'scene.changes:3']);
    expect(scenes[2]!.nodes.find((n) => n.id === scene.nodes[0]!.id)!.change).toBe('removed');
  });

  it('only offers the proposed scene when there is no current one', () => {
    expect(solutionScenes(detail(false), t as never).map((s) => s.id)).toEqual(['sol-v3-proposed']);
  });
});

describe('subscribeSolution', () => {
  it('listens to the solution event stream and closes it', () => {
    const instances: { url: string; listeners: Record<string, () => void>; closed: boolean }[] = [];
    class FakeEventSource {
      listeners: Record<string, () => void> = {};
      closed = false;
      constructor(public url: string) { instances.push(this); }
      addEventListener(type: string, fn: () => void) { this.listeners[type] = fn; }
      close() { this.closed = true; }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    const stop = subscribeSolution('o1', 'sol', onEvent);
    expect(instances[0]!.url).toBe('/api/orgs/o1/solutions/sol/events');
    instances[0]!.listeners.solution!();
    expect(onEvent).toHaveBeenCalled();
    stop();
    expect(instances[0]!.closed).toBe(true);
    vi.unstubAllGlobals();
  });
});
```

Run: `npm test -w @rdi/web -- solutionsApi`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/shell/solutions/solutionsApi.ts`:
```ts
import { diffScenes, type Scene, type SolutionDraft, type SolutionStatus, type TaskStatus } from '@rdi/scene';
import type { MessageKey } from '../../i18n/messages';

export type SolutionSummary = { id: string; title: string; status: SolutionStatus; latestVersion: number; progress: { done: number; total: number }; updatedAt: string };
export type SolutionDetail = {
  id: string; title: string; status: SolutionStatus; conversationId: string | null;
  versions: { n: number; author: 'web' | 'claude-code'; summary: string; createdAt: string }[];
  version: { n: number; author: 'web' | 'claude-code'; createdAt: string; draft: SolutionDraft };
  tasks: Record<string, { status: TaskStatus; note: string | null; updatedAt: string }>;
};
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export const solutionKey = (orgId: string, id: string, n?: number) => ['solution', orgId, id, n ?? 'latest'] as const;

export const solutionScenes = (detail: SolutionDetail, t: Translate): Scene[] => {
  const { n, draft } = detail.version;
  const base = `${detail.id}-v${n}`;
  const scenes: Scene[] = [];
  if (draft.sceneProposed) scenes.push({ ...draft.sceneProposed, id: `${base}-proposed`, title: t('scene.proposed', { n }) });
  if (draft.sceneCurrent) scenes.push({ ...draft.sceneCurrent, id: `${base}-current`, title: t('scene.current', { n }) });
  if (draft.sceneProposed && draft.sceneCurrent) scenes.push({ ...diffScenes(draft.sceneCurrent, draft.sceneProposed), id: `${base}-changes`, title: t('scene.changes', { n }) });
  return scenes;
};

export const subscribeSolution = (orgId: string, id: string, onEvent: () => void): (() => void) => {
  const source = new EventSource(`/api/orgs/${orgId}/solutions/${id}/events`, { withCredentials: true });
  source.addEventListener('solution', onEvent);
  return () => source.close();
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add the solutions client and translations

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Web — Solutions list and access tokens settings

**Files:**
- Create: `apps/web/src/shell/settings/SolutionsPage.tsx`, `apps/web/src/shell/settings/TokensPage.tsx`
- Modify: `apps/web/src/shell/settings/SettingsLayout.tsx` (ORG_ITEMS + `['solutions','nav.solutions']`, ACCOUNT_ITEMS + `['tokens','nav.tokens']`), `apps/web/src/shell/router.tsx`
- Test: `apps/web/test/shell/solutions.test.tsx`, `apps/web/test/shell/tokens.test.tsx`

**Interfaces:**
- Testids: `solution-<id>`, `solution-open-<id>`, `solutions-empty`, `token-name`, `token-create`, `token-created`, `token-<id>`, `token-revoke-<id>`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/shell/solutions.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { SolutionsPage } from '../../src/shell/settings/SolutionsPage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const render = () =>
  renderShell(<Routes><Route path=":orgId/settings" element={<SettingsLayout />}><Route path="*" element={<SolutionsPage />} /></Route></Routes>, { route: '/orgs/o1/settings/solutions', path: '/orgs/*', session: sessionFixture() });

describe('SolutionsPage', () => {
  beforeEach(() => api.mockReset());

  it('lists solutions with status, version and progress', async () => {
    api.mockResolvedValue([{ id: 's1', title: 'Rate limits', status: 'in_progress', latestVersion: 3, progress: { done: 1, total: 4 }, updatedAt: '2026-10-01T10:00:00Z' }] as never);
    render();
    const row = await screen.findByTestId('solution-s1');
    expect(row).toHaveTextContent('Rate limits');
    expect(row).toHaveTextContent('in progress');
    expect(row).toHaveTextContent('v3');
    expect(row).toHaveTextContent('1 of 4 tasks');
    expect(screen.getByTestId('solution-open-s1')).toHaveAttribute('href', '/orgs/o1/solutions/s1');
    expect(screen.getByTestId('nav-solutions')).toBeInTheDocument();
  });

  it('explains how to create the first solution', async () => {
    api.mockResolvedValue([] as never);
    render();
    expect(await screen.findByTestId('solutions-empty')).toHaveTextContent('I want');
  });
});
```

`apps/web/test/shell/tokens.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { TokensPage } from '../../src/shell/settings/TokensPage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

describe('TokensPage', () => {
  it('creates a token shown once and revokes tokens', async () => {
    api.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') return { id: 't2', name: 'laptop', prefix: 'rdi_abcdef', token: 'rdi_secret_value', createdAt: '2026-10-01T10:00:00Z' } as never;
      if (init?.method === 'DELETE') return undefined as never;
      return [{ id: 't1', name: 'ci', prefix: 'rdi_123456', lastUsedAt: null, createdAt: '2026-10-01T09:00:00Z' }] as never;
    });
    renderShell(<Routes><Route path=":orgId/settings" element={<SettingsLayout />}><Route path="*" element={<TokensPage />} /></Route></Routes>, { route: '/orgs/o1/settings/tokens', path: '/orgs/*', session: sessionFixture() });
    expect(await screen.findByTestId('token-t1')).toHaveTextContent('rdi_123456');
    expect(screen.getByTestId('token-t1')).toHaveTextContent('never used');
    fireEvent.change(screen.getByTestId('token-name'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByTestId('token-create'));
    expect(await screen.findByTestId('token-created')).toHaveTextContent('rdi_secret_value');
    expect(api).toHaveBeenCalledWith('/orgs/o1/tokens', { method: 'POST', body: { name: 'laptop' } });
    fireEvent.click(screen.getByTestId('token-revoke-t1'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1/tokens/t1', { method: 'DELETE' }));
  });
});
```

Run: `npm test -w @rdi/web -- shell/solutions shell/tokens`
Expected: FAIL — pages missing.

- [ ] **Step 2: Implement**

`apps/web/src/shell/settings/SolutionsPage.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { formatRelative } from '../format';
import type { SolutionSummary } from '../solutions/solutionsApi';
import { useSettingsContext } from './SettingsLayout';

export const SolutionsPage = () => {
  const { t, language } = useI18n();
  const { org } = useSettingsContext();
  const solutions = useQuery({ queryKey: ['solutions', org.id], queryFn: () => apiFetch<SolutionSummary[]>(`/orgs/${org.id}/solutions`) });
  return (
    <section>
      <h1>{t('solutions.title')}</h1>
      <p className="shell-sub">{t('solutions.subtitle')}</p>
      {solutions.data && solutions.data.length === 0 && <p className="alert ok" data-testid="solutions-empty">{t('solutions.empty')}</p>}
      {solutions.data && solutions.data.length > 0 && (
        <table className="table">
          <tbody>
            {solutions.data.map((s) => (
              <tr key={s.id} data-testid={`solution-${s.id}`}>
                <td>◆ {s.title}</td>
                <td><span className={`tag status-${s.status}`}>{t(`solutionStatus.${s.status}`)}</span></td>
                <td className="muted-a">{t('solutions.version', { n: s.latestVersion })}</td>
                <td className="muted-a">{t('solutions.progress', { done: s.progress.done, total: s.progress.total })}</td>
                <td className="muted-a">{formatRelative(s.updatedAt, language)}</td>
                <td style={{ textAlign: 'right' }}><Link className="btn-primary btn-small" data-testid={`solution-open-${s.id}`} to={`/orgs/${org.id}/solutions/${s.id}`}>{t('solutions.open')} →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
```

`apps/web/src/shell/settings/TokensPage.tsx`:
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { useSettingsContext } from './SettingsLayout';

type Token = { id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string };

export const TokensPage = () => {
  const { t, language } = useI18n();
  const { org } = useSettingsContext();
  const client = useQueryClient();
  const key = ['tokens', org.id];
  const tokens = useQuery({ queryKey: key, queryFn: () => apiFetch<Token[]>(`/orgs/${org.id}/tokens`) });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await apiFetch<Token & { token: string }>(`/orgs/${org.id}/tokens`, { method: 'POST', body: { name } });
      setCreated(result.token);
      setName('');
      await client.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const revoke = async (id: string) => {
    await apiFetch(`/orgs/${org.id}/tokens/${id}`, { method: 'DELETE' });
    await client.invalidateQueries({ queryKey: key });
  };

  return (
    <section>
      <h1>{t('tokens.title')}</h1>
      <p className="shell-sub">{t('tokens.subtitle')}</p>
      <form className="row" onSubmit={create} style={{ alignItems: 'flex-end', margin: '14px 0' }}>
        <Field label={t('tokens.name')} value={name} onChange={(e) => setName(e.target.value)} data-testid="token-name" required maxLength={80} />
        <PrimaryButton className="btn-small" type="submit" data-testid="token-create" disabled={!name.trim()}>{t('tokens.create')}</PrimaryButton>
      </form>
      {error && <p className="alert error" role="alert">{error}</p>}
      {created && <p className="alert ok" data-testid="token-created">{t('tokens.created')} <code>{created}</code></p>}
      {tokens.data && tokens.data.length === 0 && <p className="muted-a">{t('tokens.empty')}</p>}
      {tokens.data && tokens.data.length > 0 && (
        <table className="table">
          <tbody>
            {tokens.data.map((token) => (
              <tr key={token.id} data-testid={`token-${token.id}`}>
                <td>{token.name}</td>
                <td><code>{token.prefix}…</code></td>
                <td className="muted-a">{token.lastUsedAt ? t('tokens.lastUsed', { when: formatRelative(token.lastUsedAt, language) ?? '' }) : t('tokens.neverUsed')}</td>
                <td style={{ textAlign: 'right' }}><GhostButton className="btn-danger" data-testid={`token-revoke-${token.id}`} onClick={() => void revoke(token.id)}>{t('tokens.revoke')}</GhostButton></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
```

`SettingsLayout.tsx`: append `['solutions', 'nav.solutions']` to `ORG_ITEMS` and `['tokens', 'nav.tokens']` to `ACCOUNT_ITEMS`.
`router.tsx`: add `{ path: 'solutions', element: <SolutionsPage /> }` and `{ path: 'tokens', element: <TokensPage /> }` under the settings children (the `/orgs/:orgId/solutions/:solutionId` route comes in Task 10).

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS. If `Field` does not forward `data-testid` to the input, use its existing pattern (check `SecurityPage`) and ledger it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add solutions list and access tokens settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Workspace side panels and node selection

**Files:**
- Modify: `apps/web/src/workspace/Workspace.tsx`, `apps/web/src/workspace/panels/ExplorerPanel.tsx`
- Test: `apps/web/test/workspace/panels.test.tsx`

**Interfaces:**
- `type WorkspacePanel = { id: string; glyph: string; title: string; render: (ctx: ChatContext) => ReactNode }`; `WorkspaceProps.panels?: WorkspacePanel[]`; the existing `chat` prop becomes the panel `{ id: 'chat', glyph: '✦', title: t('chat.title') }` internally (testid stays `activity-chat`).
- `ChatContext` gains `selectNode(id: string): void`; `WorkspaceProps.initialPanel?: string` opens that panel first.
- Every panel stays mounted once rendered (hidden when inactive).

- [ ] **Step 1: Write the failing test**

`apps/web/test/workspace/panels.test.tsx`:
```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { Workspace, type ChatContext } from '../../src/workspace/Workspace';

describe('Workspace panels', () => {
  it('shows extra panels in the activity bar, opens the initial one and lets them select pieces', () => {
    let captured: ChatContext | null = null;
    render(
      <I18nProvider initialLanguage="en">
        <Workspace
          initialPanel="plan"
          panels={[{ id: 'plan', glyph: '☰', title: 'Plan', render: (ctx) => { captured = ctx; return <div data-testid="plan-slot">plan</div>; } }]}
          chat={() => <div data-testid="chat-slot">chat</div>}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('plan-slot')).toBeVisible();
    expect(screen.getByTestId('chat-slot')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('activity-chat'));
    expect(screen.getByTestId('chat-slot')).toBeVisible();
    expect(screen.getByTestId('plan-slot')).not.toBeVisible();
    const firstNode = captured!.scene.nodes[0]!;
    act(() => captured!.selectNode(firstNode.id));
    expect(screen.getByTestId('card')).toHaveTextContent(firstNode.label);
  });
});
```

Run: `npm test -w @rdi/web -- workspace/panels`
Expected: FAIL — `panels` / `selectNode` unsupported.

- [ ] **Step 2: Implement**

`Workspace.tsx`:
- export `type WorkspacePanel = { id: string; glyph: string; title: string; render: (ctx: ChatContext) => ReactNode }`; props gain `panels?: WorkspacePanel[]; initialPanel?: string`.
- `ChatContext` gains `selectNode(id: string): void`; set it to `(id) => dispatchRaw({ type: 'selectNode', nodeId: id })`.
- replace the `sidebar` state with `const [sidebar, setSidebar] = useState<string>(initialPanel ?? 'explorer');`
- build `const allPanels = [...(chat ? [{ id: 'chat', glyph: '✦', title: t('chat.title'), render: chat }] : []), ...(panels ?? [])];` (get `t` from `useI18n()`), pass `panels={allPanels.map((p) => ({ id: p.id, glyph: p.glyph, title: p.title, node: p.render(chatContext) }))}` and `sidebar` / `onSidebar` to `ExplorerPanel`; `ws-body` gets `chat-open` when `sidebar !== 'explorer'`.

`ExplorerPanel.tsx`: replace `chatSlot` with `panels?: { id: string; glyph: string; title: string; node: ReactNode }[]`, `sidebar?: string`, `onSidebar?: (id: string) => void`; render one activity button per panel (`data-testid={`activity-${panel.id}`}`) before the mode buttons, and one `<aside className="ws-explorer ws-chat" data-testid={`panel-host-${panel.id}`} hidden={sidebar !== panel.id}>` per panel; the explorer aside is `hidden={sidebar !== 'explorer'}`. Update `test/workspace/chatSidebar.test.tsx` only if a testid changed (it should not).

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): support extra workspace side panels and piece selection

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Web — Solution workspace with plan panel and Claude Code handoff

**Files:**
- Create: `apps/web/src/shell/solutions/PlanPanel.tsx`, `apps/web/src/shell/solutions/HandoffDialog.tsx`, `apps/web/src/shell/pages/SolutionPage.tsx`
- Modify: `apps/web/src/shell/router.tsx` (`/orgs/:orgId/solutions/:solutionId`), `apps/web/src/workspace/workspace.css` (plan + dialog styles)
- Test: `apps/web/test/shell/planPanel.test.tsx`, `apps/web/test/shell/handoff.test.tsx`, `apps/web/test/shell/solutionPage.test.tsx`

**Interfaces:**
- `PlanPanel({ detail, ctx, onVersion, onExecute })` — testids `plan-version` (select), `plan-task-<id>` (button), `plan-task-status-<id>`, `plan-risks`, `plan-execute`, `plan-author`.
- `HandoffDialog({ orgId, solutionId, onClose })` — fetches `/mcp-info`, creates a token on demand; testids `handoff-dialog`, `handoff-create-token`, `handoff-mcp-command`, `handoff-run-command`, `handoff-copy-mcp`, `handoff-copy-run`.
  - MCP command: `claude mcp add --transport http repository-designer <url> --header "Authorization: Bearer <token or $RDI_TOKEN>"`
  - Run command: `claude "Use the repository-designer MCP server: call get_solution with id <id>, then implement the plan task by task in this repository. Call report_task_progress with in_progress when you start a task and done (with a short note) when it is finished; call update_solution if the plan must change."`
- `SolutionPage` — loads `GET /orgs/:orgId/solutions/:id?version=n`, subscribes with `subscribeSolution` (invalidates the query), renders `Workspace` with `extraScenes={solutionScenes(detail, t)}`, `panels=[plan]`, `initialPanel="plan"`, the chat panel, `loadCode`, theme/language like `ExplorePage`; `homeHref` = `/orgs/:orgId/settings/solutions`.
- Clicking a task calls `ctx.openScene(<proposed scene>)` if needed and `ctx.selectNode(task.nodeRefs[0])`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/shell/planPanel.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { PlanPanel } from '../../src/shell/solutions/PlanPanel';
import type { SolutionDetail } from '../../src/shell/solutions/solutionsApi';

const scene = sampleRegistry['iot-telemetry']!;
const detail: SolutionDetail = {
  id: 'sol', title: 'Rate limits', status: 'in_progress', conversationId: null,
  versions: [{ n: 1, author: 'web', summary: 'first', createdAt: '2026-10-01T09:00:00Z' }, { n: 2, author: 'claude-code', summary: 'second', createdAt: '2026-10-01T10:00:00Z' }],
  version: { n: 2, author: 'claude-code', createdAt: '2026-10-01T10:00:00Z', draft: {
    summary: 'Throttle devices', sceneCurrent: null, sceneProposed: scene,
    plan: [{ id: 't1', title: 'Add limiter', nodeRefs: [scene.nodes[1]!.id], acceptance: ['429 after limit'], dependsOn: [] }, { id: 't2', title: 'Tests', nodeRefs: [], acceptance: [], dependsOn: ['t1'] }],
    risks: [{ title: 'Bursts throttled', severity: 'medium' }],
  } },
  tasks: { t1: { status: 'done', note: 'PR #12', updatedAt: '2026-10-01T10:05:00Z' } },
};

describe('PlanPanel', () => {
  it('shows the plan, its progress and risks, and highlights the pieces of a task', () => {
    const ctx = { openScene: vi.fn(), selectNode: vi.fn(), selected: null, scene: { ...scene, id: 'sol-v2-proposed' } };
    const onVersion = vi.fn();
    const onExecute = vi.fn();
    render(<I18nProvider initialLanguage="en"><PlanPanel detail={detail} ctx={ctx} onVersion={onVersion} onExecute={onExecute} /></I18nProvider>);
    expect(screen.getByTestId('plan-author')).toHaveTextContent('by Claude Code');
    expect(screen.getByTestId('plan-task-status-t1')).toHaveTextContent('done');
    expect(screen.getByTestId('plan-task-t1')).toHaveTextContent('PR #12');
    expect(screen.getByTestId('plan-task-status-t2')).toHaveTextContent('to do');
    expect(screen.getByTestId('plan-task-t2')).toHaveTextContent('After t1');
    expect(screen.getByTestId('plan-risks')).toHaveTextContent('Bursts throttled');
    fireEvent.click(screen.getByTestId('plan-task-t1'));
    expect(ctx.selectNode).toHaveBeenCalledWith(scene.nodes[1]!.id);
    fireEvent.change(screen.getByTestId('plan-version'), { target: { value: '1' } });
    expect(onVersion).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId('plan-execute'));
    expect(onExecute).toHaveBeenCalled();
  });
});
```

`apps/web/test/shell/handoff.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../src/shell/api';
import { HandoffDialog } from '../../src/shell/solutions/HandoffDialog';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

describe('HandoffDialog', () => {
  it('builds the Claude Code commands and embeds a freshly created token', async () => {
    api.mockImplementation(async (path, init) => {
      if (String(path) === '/mcp-info') return { url: 'http://localhost:4040/mcp', serverName: 'repository-designer' } as never;
      if (init?.method === 'POST') return { id: 'tk', name: 'Claude Code', prefix: 'rdi_abc', token: 'rdi_fresh', createdAt: '2026-10-01T10:00:00Z' } as never;
      return [] as never;
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell(<HandoffDialog orgId="o1" solutionId="sol" onClose={() => {}} />, { session: sessionFixture() });
    expect(await screen.findByTestId('handoff-mcp-command')).toHaveTextContent('claude mcp add --transport http repository-designer http://localhost:4040/mcp --header "Authorization: Bearer $RDI_TOKEN"');
    expect(screen.getByTestId('handoff-run-command')).toHaveTextContent('call get_solution with id sol');
    fireEvent.click(screen.getByTestId('handoff-create-token'));
    await waitFor(() => expect(screen.getByTestId('handoff-mcp-command')).toHaveTextContent('Bearer rdi_fresh'));
    expect(api).toHaveBeenCalledWith('/orgs/o1/tokens', { method: 'POST', body: { name: 'Claude Code' } });
    fireEvent.click(screen.getByTestId('handoff-copy-run'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('report_task_progress')));
  });
});
```

`apps/web/test/shell/solutionPage.test.tsx`:
```tsx
import { act, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { apiFetch } from '../../src/shell/api';
import { SolutionPage } from '../../src/shell/pages/SolutionPage';
import { subscribeSolution } from '../../src/shell/solutions/solutionsApi';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/shell/solutions/solutionsApi', async (original) => ({ ...(await original<typeof import('../../src/shell/solutions/solutionsApi')>()), subscribeSolution: vi.fn() }));
vi.mock('../../src/workspace/Workspace', () => ({
  Workspace: ({ extraScenes, panels, initialPanel }: { extraScenes: { id: string }[]; panels: { id: string }[]; initialPanel: string }) => (
    <div data-testid="workspace">{extraScenes.map((s) => s.id).join(',')}|{panels.map((p) => p.id).join(',')}|{initialPanel}</div>
  ),
}));
const api = vi.mocked(apiFetch);
const subscribe = vi.mocked(subscribeSolution);
const scene = sampleRegistry['iot-telemetry']!;
const detail = (n: number) => ({ id: 'sol', title: 'x', status: 'draft', conversationId: null, versions: [{ n, author: 'web', summary: 's', createdAt: '2026-10-01T10:00:00Z' }], version: { n, author: 'web', createdAt: '2026-10-01T10:00:00Z', draft: { summary: 's', sceneProposed: scene, sceneCurrent: null, plan: [], risks: [] } }, tasks: {} });

describe('SolutionPage', () => {
  it('opens the proposed scene with the plan panel and refreshes on live events', async () => {
    let version = 1;
    let notify: () => void = () => {};
    api.mockImplementation(async (path) => (String(path).startsWith('/orgs/o1/solutions/sol') ? detail(version) : sessionFixture()) as never);
    subscribe.mockImplementation((_o, _s, onEvent) => { notify = onEvent; return () => {}; });
    renderShell(<SolutionPage />, { route: '/orgs/o1/solutions/sol', path: '/orgs/:orgId/solutions/:solutionId', session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('sol-v1-proposed|plan|plan'));
    version = 2;
    await act(async () => notify());
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('sol-v2-proposed'));
  });
});
```

Run: `npm test -w @rdi/web -- planPanel handoff solutionPage`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement**

`apps/web/src/shell/solutions/PlanPanel.tsx`:
```tsx
import { useI18n } from '../../i18n/I18nProvider';
import type { ChatContext } from '../../workspace/Workspace';
import type { SolutionDetail } from './solutionsApi';

const STATUS_GLYPH = { todo: '○', in_progress: '◐', done: '✓', blocked: '✕' } as const;

export const PlanPanel = ({ detail, ctx, onVersion, onExecute }: { detail: SolutionDetail; ctx: ChatContext; onVersion: (n: number) => void; onExecute: () => void }) => {
  const { t } = useI18n();
  const { draft } = detail.version;
  const focusTask = (nodeRefs: string[]) => {
    const target = nodeRefs[0];
    if (!target) return;
    if (!ctx.scene.nodes.some((n) => n.id === target) && draft.sceneProposed) ctx.openScene({ ...draft.sceneProposed, id: `${detail.id}-v${detail.version.n}-proposed` });
    ctx.selectNode(target);
  };
  return (
    <div className="plan" data-testid="plan-panel">
      <div className="plan-head">
        <b>◆ {detail.title}</b>
        <span className={`tag status-${detail.status}`}>{t(`solutionStatus.${detail.status}`)}</span>
      </div>
      <label className="plan-version">
        {t('plan.version')}
        <select data-testid="plan-version" value={detail.version.n} onChange={(e) => onVersion(Number(e.target.value))}>
          {detail.versions.map((v) => <option key={v.n} value={v.n}>v{v.n} · {v.summary.slice(0, 40)}</option>)}
        </select>
      </label>
      <p className="muted" data-testid="plan-author">{t(`plan.by.${detail.version.author}`)} · {t('plan.updated')}</p>
      <p>{draft.summary}</p>
      <div className="sec-title">{t('plan.title')}</div>
      <ol className="plan-tasks">
        {draft.plan.map((task) => {
          const state = detail.tasks[task.id];
          const status = state?.status ?? 'todo';
          return (
            <li key={task.id}>
              <button type="button" className={`plan-task is-${status}`} data-testid={`plan-task-${task.id}`} onClick={() => focusTask(task.nodeRefs)}>
                <span data-testid={`plan-task-status-${task.id}`} className="plan-status">{STATUS_GLYPH[status]} {t(`taskStatus.${status}`)}</span>
                <b>{task.title}</b>
                {task.dependsOn.length > 0 && <span className="muted">{t('plan.dependsOn', { tasks: task.dependsOn.join(', ') })}</span>}
                {task.acceptance.length > 0 && <span className="muted">{t('plan.acceptance')}: {task.acceptance.join(' · ')}</span>}
                {state?.note && <span className="plan-note">{state.note}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {draft.risks.length > 0 && (
        <div data-testid="plan-risks">
          <div className="sec-title">{t('plan.risks')}</div>
          {draft.risks.map((risk, i) => (
            <div key={i} className="risk-item"><span className={`risk-dot sev-${risk.severity}`} /> {risk.title}{risk.mitigation ? ` — ${risk.mitigation}` : ''}</div>
          ))}
        </div>
      )}
      <button type="button" className="btn-primary btn-small plan-execute" data-testid="plan-execute" onClick={onExecute}>▶ {t('plan.execute')}</button>
    </div>
  );
};
```

`apps/web/src/shell/solutions/HandoffDialog.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { errorText } from '../errors';

type McpInfo = { url: string; serverName: string };
const TOKEN_PLACEHOLDER = '$RDI_TOKEN';
const TOKEN_NAME = 'Claude Code';

export const mcpCommand = (info: McpInfo, token: string) => `claude mcp add --transport http ${info.serverName} ${info.url} --header "Authorization: Bearer ${token}"`;
export const runCommand = (serverName: string, solutionId: string) =>
  `claude "Use the ${serverName} MCP server: call get_solution with id ${solutionId}, then implement the plan task by task in this repository. Call report_task_progress with in_progress when you start a task and done (with a short note) when it is finished; call update_solution if the plan must change."`;

export const HandoffDialog = ({ orgId, solutionId, onClose }: { orgId: string; solutionId: string; onClose: () => void }) => {
  const { t } = useI18n();
  const info = useQuery({ queryKey: ['mcp-info'], queryFn: () => apiFetch<McpInfo>('/mcp-info') });
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createToken = async () => {
    setError(null);
    try {
      setToken((await apiFetch<{ token: string }>(`/orgs/${orgId}/tokens`, { method: 'POST', body: { name: TOKEN_NAME } })).token);
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
  };
  if (!info.data) return null;
  const mcp = mcpCommand(info.data, token ?? TOKEN_PLACEHOLDER);
  const run = runCommand(info.data.serverName, solutionId);
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={t('handoff.title')} data-testid="handoff-dialog">
      <div className="dialog glass">
        <h2>{t('handoff.title')}</h2>
        <p>{t('handoff.step1')}</p>
        <pre data-testid="handoff-mcp-command">{mcp}</pre>
        <div className="row">
          <button type="button" className="btn" data-testid="handoff-copy-mcp" onClick={() => void copy('mcp', mcp)}>{copied === 'mcp' ? t('handoff.copied') : t('handoff.copy')}</button>
          {!token && <button type="button" className="btn" data-testid="handoff-create-token" onClick={() => void createToken()}>{t('handoff.createToken')}</button>}
        </div>
        {token && <p className="muted">{t('handoff.tokenOnce')}</p>}
        {error && <p className="alert error" role="alert">{error}</p>}
        <p>{t('handoff.step2')}</p>
        <pre data-testid="handoff-run-command">{run}</pre>
        <div className="row">
          <button type="button" className="btn" data-testid="handoff-copy-run" onClick={() => void copy('run', run)}>{copied === 'run' ? t('handoff.copied') : t('handoff.copy')}</button>
          <span className="shell-spacer" />
          <button type="button" className="btn" data-testid="handoff-close" onClick={onClose}>{t('handoff.close')}</button>
        </div>
      </div>
    </div>
  );
};
```

`apps/web/src/shell/pages/SolutionPage.tsx`:
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { CodeRef } from '../../workspace/panels/CodeDrawer';
import { Workspace } from '../../workspace/Workspace';
import { apiFetch } from '../api';
import { ChatPanel } from '../chat/ChatPanel';
import { Splash } from '../components/Splash';
import { effectiveExplanationLanguage, effectiveLevel, effectiveTheme } from '../preferences';
import { useSession, useUpdateMe } from '../session';
import { HandoffDialog } from '../solutions/HandoffDialog';
import { PlanPanel } from '../solutions/PlanPanel';
import { solutionKey, solutionScenes, subscribeSolution, type SolutionDetail } from '../solutions/solutionsApi';

const codeLoader = (orgId: string) => async (code: CodeRef) => {
  const query = new URLSearchParams({ repo: code.repo, path: code.path, start: String(code.startLine), end: String(code.endLine) });
  return (await apiFetch<{ snippet: string }>(`/orgs/${orgId}/code?${query.toString()}`)).snippet;
};

export const SolutionPage = () => {
  const { orgId = '', solutionId = '' } = useParams();
  const { data: session } = useSession();
  const updateMe = useUpdateMe();
  const { t, language, setLanguage } = useI18n();
  const client = useQueryClient();
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [handoff, setHandoff] = useState(false);
  const detail = useQuery({
    queryKey: solutionKey(orgId, solutionId, version),
    queryFn: () => apiFetch<SolutionDetail>(`/orgs/${orgId}/solutions/${solutionId}${version ? `?version=${version}` : ''}`),
    enabled: Boolean(orgId && solutionId),
  });
  useEffect(() => subscribeSolution(orgId, solutionId, () => void client.invalidateQueries({ queryKey: ['solution', orgId, solutionId] })), [orgId, solutionId, client]);
  const loadCode = useMemo(() => codeLoader(orgId), [orgId]);
  const scenes = useMemo(() => (detail.data ? solutionScenes(detail.data, t) : []), [detail.data, t]);

  if (!session) return null;
  const org = session.orgs.find((o) => o.id === orgId);
  if (!org) return <Navigate to="/" replace />;
  if (detail.isLoading || !detail.data) return <Splash />;
  const data = detail.data;
  return (
    <>
      <Workspace
        key={`${solutionId}-v${data.version.n}`}
        extraScenes={scenes}
        initialPanel="plan"
        panels={[{ id: 'plan', glyph: '☰', title: t('plan.title'), render: (ctx) => <PlanPanel detail={data} ctx={ctx} onVersion={setVersion} onExecute={() => setHandoff(true)} /> }]}
        chat={(ctx) => <ChatPanel orgId={org.id} ctx={ctx} language={effectiveExplanationLanguage(session.user, org, language)} />}
        loadCode={loadCode}
        theme={effectiveTheme(session.user, org)}
        onTheme={(theme) => updateMe.mutate({ theme })}
        onLanguage={(uiLanguage) => {
          setLanguage(uiLanguage);
          updateMe.mutate({ uiLanguage });
        }}
        initialLevel={effectiveLevel(session.user)}
        homeHref={`/orgs/${org.id}/settings/solutions`}
      />
      {handoff && <HandoffDialog orgId={org.id} solutionId={data.id} onClose={() => setHandoff(false)} />}
    </>
  );
};
```
(`key` remounts the workspace when a new version arrives so the canvas loads the new proposed scene.)

`router.tsx`: add `{ path: '/orgs/:orgId/solutions/:solutionId', element: <SolutionPage /> }` next to the explore route.

`workspace.css` append:
```css
.plan { display: flex; flex-direction: column; gap: 8px; padding: 10px; overflow: auto; height: 100%; }
.plan-head { display: flex; justify-content: space-between; gap: 6px; align-items: center; }
.plan-version { display: flex; gap: 6px; align-items: center; font-size: 12px; }
.plan-tasks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.plan-task { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); background: transparent; color: var(--text); cursor: pointer; font: inherit; }
.plan-task.is-done { border-color: color-mix(in srgb, var(--ok, #3ccf91) 60%, var(--line)); }
.plan-task.is-blocked { border-color: color-mix(in srgb, var(--bad, #ff6b81) 60%, var(--line)); }
.plan-status { font-size: 11px; color: var(--muted); }
.plan-note { font-size: 12px; color: var(--accent); }
.plan-execute { margin-top: 8px; }
.dialog-backdrop { position: fixed; inset: 0; background: rgba(4, 8, 20, 0.6); display: grid; place-items: center; z-index: 100; }
.dialog { width: min(720px, 92vw); padding: 20px; border-radius: 14px; display: flex; flex-direction: column; gap: 8px; }
.dialog pre { white-space: pre-wrap; word-break: break-all; padding: 10px; border-radius: 8px; background: rgba(0, 0, 0, 0.35); font-size: 12px; }
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add the solution workspace with plan panel and Claude Code handoff

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Web — solution chips in the chat

**Files:**
- Modify: `apps/web/src/shell/chat/chatApi.ts` (event type `solution`), `apps/web/src/shell/chat/ChatPanel.tsx`, `apps/web/src/i18n/shellMessages.ts` (`chat.solution` = `Solution: {title} · v{n}` / `Solución: {title} · v{n}` / `Solução: {title} · v{n}`)
- Test: `apps/web/test/shell/chatPanel.test.tsx`

**Interfaces:** `ChatEvent` gains `{ type: 'solution'; id: string; n: number; title: string }`; ChatPanel shows `chat-solution-<id>` with a link `chat-solution-open-<id>` to `/orgs/:orgId/solutions/:id`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('ChatPanel', …)`:
```tsx
  it('links solutions proposed by the agent', async () => {
    mockApi();
    stream.mockImplementation(async (_o, _c, _b, onEvent: (e: ChatEvent) => void) => {
      onEvent({ type: 'solution', id: 'sol1', n: 1, title: 'Order cancellation' });
      onEvent({ type: 'text', delta: 'Saved a plan.' });
    });
    render();
    fireEvent.change(await screen.findByTestId('chat-input'), { target: { value: 'I want order cancellation' } });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(await screen.findByTestId('chat-solution-sol1')).toHaveTextContent('Solution: Order cancellation · v1');
    expect(screen.getByTestId('chat-solution-open-sol1')).toHaveAttribute('href', '/orgs/o1/solutions/sol1');
  });
```

Run: `npm test -w @rdi/web -- chatPanel`
Expected: FAIL.

- [ ] **Step 2: Implement**

- `chatApi.ts`: add the `solution` variant to `ChatEvent` and `'solution'` to `EVENT_TYPES`.
- `ChatPanel.tsx`: state `const [solutions, setSolutions] = useState<{ id: string; n: number; title: string; turn: number }[]>([]);` (reset in `startNew` and when a conversation loads); in `onEvent` handle `event.type === 'solution'` by appending `{ ...event, turn }`; under each assistant item render
```tsx
{item.role === 'assistant' && solutions.filter((s) => s.turn === item.turn).map((s) => (
  <div key={`${s.id}-${s.n}`} className="chat-scene" data-testid={`chat-solution-${s.id}`}>
    <span>☰ {t('chat.solution', { title: s.title, n: s.n })}</span>
    <Link className="btn" data-testid={`chat-solution-open-${s.id}`} to={`/orgs/${orgId}/solutions/${s.id}`}>{t('chat.open')}</Link>
  </div>
))}
```
  (import `Link` from `react-router-dom`; the tests render inside `MemoryRouter` via `renderShell`.)

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): link agent-proposed solutions from the chat

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: End-to-end handoff journey

**Files:**
- Create: `apps/web/e2e/solutions.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the E2E journey**

`apps/web/e2e/solutions.spec.ts`:
```ts
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://localhost:4040';

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
  return { orgId, csrfToken };
};

const mcp = async (request: APIRequestContext, token: string, name: string, args: object) => {
  const res = await request.post(`${API}/mcp`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } },
  });
  return ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
};

test('design a solution in the chat and let Claude Code report progress live', async ({ page }) => {
  test.setTimeout(240_000);
  const { orgId, csrfToken } = await indexDemo(page);
  await page.goto(`/orgs/${orgId}/explore`);
  await page.getByTestId('activity-chat').click();
  await page.getByTestId('chat-input').fill('I want order cancellation');
  await page.getByTestId('chat-send').click();
  const open = page.locator('[data-testid^="chat-solution-open-"]').first();
  await expect(open).toBeVisible();
  await open.click();

  await expect(page.getByTestId('plan-panel')).toBeVisible();
  await expect(page.locator('[data-testid^="plan-task-status-"]').first()).toContainText('to do');
  const solutionId = page.url().split('/solutions/')[1]!;
  await page.locator('[data-testid^="plan-task-"]:not([data-testid^="plan-task-status-"])').first().click();
  await expect(page.getByTestId('card')).not.toHaveText('');

  await page.getByTestId('plan-execute').click();
  await page.getByTestId('handoff-create-token').click();
  const command = await page.getByTestId('handoff-mcp-command').innerText();
  const token = /Bearer (rdi_\S+)"/.exec(command)![1]!;
  await page.getByTestId('handoff-close').click();

  const solution = JSON.parse((await mcp(page.request, token, 'get_solution', { id: solutionId })).content[0]!.text) as { plan: { id: string }[] };
  await mcp(page.request, token, 'report_task_progress', { id: solutionId, taskId: solution.plan[0]!.id, status: 'done', note: 'PR #1' });
  await expect(page.getByTestId(`plan-task-status-${solution.plan[0]!.id}`)).toContainText('done');
  await expect(page.getByTestId(`plan-task-${solution.plan[0]!.id}`)).toContainText('PR #1');

  await mcp(page.request, token, 'update_solution', { id: solutionId, summary: 'Refined by Claude Code' });
  await expect(page.getByTestId('plan-author')).toContainText('by Claude Code');
  await expect(page.getByTestId('plan-version')).toHaveValue('2');

  await page.goto(`/orgs/${orgId}/settings/solutions`);
  await expect(page.getByTestId(`solution-${solutionId}`)).toContainText('v2');
  expect(csrfToken).toBeTruthy();
});
```
Note: after `update_solution` the page refetches the **latest** version only while no explicit version is selected (`version` state undefined) — this is the default, so v2 appears.

- [ ] **Step 2: Run everything**

Stop dev servers, then:
```bash
npm test && npm run typecheck
npm run test:integration -w @rdi/api && npm run test:integration -w @rdi/graph && npm run test:integration -w @rdi/worker
npm run e2e -w @rdi/web
```
Expected: all PASS; E2E `23 passed`.

- [ ] **Step 3: README**

Append to `README.md`:
```markdown
### Solutions and Claude Code

Describe a change in the chat ("I want …") and the agent saves a versioned **Solution** (current vs proposed scene, task
plan, risks) under Settings → Solutions. Open it to see the plan next to the canvas and press **Execute in Claude Code**:
the dialog creates a personal access token and gives you the two commands to connect the remote MCP server
(`POST /mcp`, Streamable HTTP, `Authorization: Bearer rdi_…`) and start Claude Code on the solution. Claude Code reads it
with `get_solution`, queries the graph with `query_graph`, saves new versions with `update_solution` and reports
`report_task_progress`; the Solution page updates live. Set `PUBLIC_API_URL` when the API is not on `http://localhost:4040`.
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(web): add the end-to-end Claude Code handoff journey

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Solutions versioned (current/proposed, plan tasks with nodeRefs + acceptance + status, risks, author) | 1, 2, 3 |
| "I want Y" → Solution through the agent (`upsert_solution`) | 4, 11 |
| Canvas: current/proposed toggle, version-to-version diff, task highlights its nodes, animation on proposed state | 1 (diff), 9, 10 |
| Remote MCP server with personal access tokens: list_solutions, get_solution (+ graph context), query_graph, update_solution, report_task_progress | 2, 5, 6 |
| "Execute in Claude Code" one-liners (MCP install + prompt with solution id) | 10 |
| Live updates from Claude Code to the web (SSE) | 3, 10, 12 |
| Usage/limits | existing agent budget; tokens limited per user (5) |
