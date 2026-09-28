# Repository Designer IDE — Phase 1 Design Spec (vertical slice)

## Context

`/Users/hugomarcelodelnegro/Desktop/Projects/repository-designer-ide` is empty (no git). The goal is a SaaS product that connects to GitHub (other providers later), indexes an org's repositories and, through a **chat + animated canvas**, lets a user understand systems and changes **without reading code**: components involved, how they connect, storage, bottlenecks, algorithmic detail — explained with animated, example-driven walkthroughs, navigating across repos.

It is also a **visual workspace for designing solutions with Claude**: the user iterates on an idea/implementation plan through prompts, sees current vs proposed architecture on the canvas, and hands the plan off to Claude Code for execution (bidirectionally).

**Entry points (all primary):** (1) an existing PR/diff, (2) a change I want to make, (3) understanding an existing flow.

**Phase 1 success criterion:** connect a GitHub org, pick 2 repos, and — for any of the three entry points — get within ~30s a navigable diagram + step-by-step animation with narration, example payloads, algorithmic zoom and load simulation, without opening code; turn a "I want to do Y" into a versioned Solution and execute it via Claude Code.

**Out of scope for phase 1 (later sub-projects):** billing, hard tenant isolation / SaaS hardening, non-GitHub providers, cloud execution agent (sandboxed PR-opening agent), full parsing for languages other than TS/JS + Python.

## Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Product | SaaS; phase 1 = thin vertical slice, `org_id` everywhere from day 1 |
| Understanding engine | Indexed System Graph + agent that queries graph and drills into code on demand |
| Graph store | **Neo4j 5** (graph + native vector index); **Postgres** for relational app data |
| Rendering | Agent emits a structured **Scene** (JSON, Zod-validated); deterministic renderer animates it |
| Animation modes | request flow · example data transforming · algorithmic zoom · load/bottleneck simulation · diff impact |
| Execution | Handoff to **Claude Code** via the product's remote **MCP server** (bidirectional) |
| LLM | Claude: Sonnet 5 default, Opus 5.5 for deep analysis / Solution planning, Haiku 4.5 for file summaries |

## 1. Architecture

Turbo monorepo (same pattern as the user's other projects):

```
apps/web        React + Vite · chat · canvas (React Flow + ELK + Framer Motion) · animation engine
apps/api        Node/TS · GitHub App auth · REST + SSE agent streaming · remote MCP server
apps/worker     Indexing pipeline (BullMQ)
packages/scene  Scene schema (Zod) + validation + load-simulation pure functions
packages/graph  System Graph model, parameterized Cypher query templates, org_id-scoped access layer
infra           docker-compose: Postgres, Neo4j 5, Redis (non-default ports, following the user's convention)
```

Flow: install GitHub App → select repos → worker indexes into Neo4j → user chats → agent uses tools over graph/code → streams narration + Scenes → canvas animates → Solutions versioned in Postgres → Claude Code reads/updates them through MCP.

## 2. Scene format & animation

```ts
Scene {
  id, title, kind: 'flow' | 'algorithm' | 'load' | 'diff-impact'
  nodes: [{ id, type: 'client'|'service'|'endpoint'|'queue'|'db'|'table'|'cache'|'external'|'function'|'data',
            label, repo?, graphRef?, meta: { tech?, notes?, risk?: 'bottleneck'|'spof'|'hot',
            change?: 'added'|'modified'|'removed' } }]
  edges: [{ id, from, to, kind: 'sync'|'async'|'read'|'write'|'calls', label? }]
  groups: [{ id, label, nodeIds }]
  steps: [{ narration, focus: string[], travel?: { edgeId, payload? },
            payload?: { format: 'json'|'sql'|'text', before?, after? },
            highlight?: string[], annotate?: [{ nodeId, text }] }]
  zoom?: Record<nodeId, sceneId>
  load?: { rps, nodes: Record<id, { capacity, latencyMs }>, queues?: Record<id, { consumers, maxDepth? }> }
}
```

- **Flow:** token travels along `travel` edge, `focus` nodes light up, chat narration synced; controls ▶ ⏸ ⏭ ⏮, speed, scrub.
- **Example data:** side panel shows `payload.before → after` with animated diff.
- **Algorithm:** double-click a node → `zoom` sub-scene (`function`/`data` nodes; steps = iterations, branches, retries, locks; visible data structures mutating).
- **Load:** RPS slider drives a deterministic client-side queueing simulation (pure TS in `packages/scene`); saturated nodes turn red, queues grow. Agent-provided numbers are labeled as estimates.
- **Diff impact:** nodes marked added/modified/removed; blast radius via opacity.
- Invalid scene → validation error returned to agent (2 retries) → degrade to text-only answer.
- Nodes with `graphRef` are clickable → "ask about this" injects context into chat.

## 3. Indexing pipeline & System Graph

Triggers: App install / repo added → `index_repo`; `push` webhook on default branch → `reindex_incremental(changedFiles)`; PRs analyzed on demand only.

Worker stages (BullMQ, idempotent, resumable, progress reported per stage):
1. **Clone** — shallow clone with installation token (refresh), ephemeral volume, store `commit_sha`.
2. **Parse** — tree-sitter: files, symbols, imports, call sites. Full support TS/JS + Python; others file-level + LLM summary.
3. **Detect** — isolated plugins, each with its own fixture tests: HTTP routes (Express, Fastify, Next, FastAPI) → `Endpoint`; SQS/BullMQ/Kafka/Redis producers/consumers → `Queue` + `PUBLISHES/CONSUMES`; Sequelize/Prisma/TypeORM/SQLAlchemy/migrations → `Table` + `READS/WRITES`; outbound HTTP clients & SDKs → `External`; cron/schedulers → `Trigger`; env/config → `ConfigKey`.
4. **Summarize** — hierarchical file → module → service (Haiku for files, Sonnet above), flags likely bottlenecks (I/O in loops, N+1, locks, sync chains); cached by content hash.
5. **Embed & link** — embeddings into Neo4j vector index; cross-repo linker matches outbound calls to endpoints (method + normalized path), shared queue names, shared tables; edges carry `confidence`.

Neo4j schema: nodes `Repo, Service, Module, File, Symbol, Endpoint, Queue, Table, External, Trigger, ConfigKey` (all with `org_id, repo_id, commit_sha, summary, embedding, file, line`); edges `CONTAINS, IMPORTS, CALLS, HANDLES, PUBLISHES, CONSUMES, READS, WRITES, CALLS_HTTP, USES_CONFIG`. Composite indexes on `(org_id, repo_id)`. Agent never writes free Cypher — only templates in `packages/graph` that inject `org_id`.

After indexing, an automatic system map (services + storage) is shown. Phase 1 limits: ~500k LOC per repo, 10 repos per org; partial indexing flags gaps.

## 4. Agent, chat, Solutions & Claude Code handoff

Agent (in `apps/api`, SSE streaming). Tools: `query_graph` (neighbors, paths, consumers, blast radius), `search_semantic`, `read_code` (file:line, token-capped), `get_pr_diff` (maps diff to graph nodes), `emit_scene`, `upsert_solution`.

Entry points share one loop with different framing: flow question → `flow` scene (+ `zoom`); PR → `diff-impact` scene + explanation; "I want Y" → **Solution**.

UI: split view — chat left, canvas right; scenes and Solution versions as canvas tabs.

**Solutions (Postgres, versioned):** `solution { id, org_id, title, status }`, `solution_version { n, scene_current, scene_proposed, plan: tasks[], risks[], author: 'web'|'claude-code', created_at }`, task `{ id, title, nodeRefs[], acceptance, status }`. Canvas: current/proposed toggle, version-to-version diff, highlight task's nodes, all animation modes on the proposed state.

**Remote MCP server** (personal access token): `list_solutions`, `get_solution` (plan + graph context of involved nodes), `query_graph`, `update_solution` (new version, `author: claude-code`), `report_task_progress`. "Execute in Claude Code" button copies a one-liner that installs the MCP (first time) and launches the prompt with the Solution id. Updates from Claude Code stream live to the web canvas (SSE); task progress shows node-by-node.

Postgres tables (app data): `users, orgs, memberships, github_installations, repos, index_jobs, conversations, messages, scenes, solutions, solution_versions, api_tokens, usage`.

Limits: per-org rate limit + token budget visible in UI; repo not indexed yet → agent warns and uses `read_code` only.

## Verification (phase 1, end to end)

- `docker compose up` (Postgres, Neo4j, Redis) + `turbo dev`; all services healthy.
- Unit: scene schema, each detector against fixture repos, cross-repo linker, load simulation.
- Integration: index two fixture repos (a TS web app calling a TS/Python API with a queue + DB) into real Neo4j/Postgres; assert expected nodes/edges incl. `CALLS_HTTP` cross-repo edge.
- Agent evals: fixed question set over fixture repos, assert required nodes appear in emitted scenes; scenes always validate.
- E2E (Playwright): connect fixture repo via a test GitHub App → ask "how does X work" → scene renders → play animation through all steps → zoom into a node → move RPS slider and see saturation.
- MCP: from Claude Code, `get_solution` returns plan; `update_solution` creates v2 and the web canvas updates live.
