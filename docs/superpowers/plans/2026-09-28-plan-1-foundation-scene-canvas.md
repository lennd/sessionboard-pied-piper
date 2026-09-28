# Plan 1 — Foundation, Scene Format & Animated Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running monorepo (infra + API health) with the Scene format, its validator, a deterministic load simulator, and a web canvas that plays hand-written scenes in all four animation modes (flow, example payloads, algorithmic zoom, load/bottlenecks) plus diff impact.

**Architecture:** npm-workspaces + Turbo monorepo. `packages/scene` owns the Zod schema, referential validation, the load simulator and sample scenes (pure TS, no runtime deps besides zod). `apps/web` (Vite + React) owns a pure playback engine (`src/engine`), an ELK layout step, a pure scene→React-Flow mapper, and presentational components. `apps/api` (Fastify) only exposes `/health` over Postgres, Neo4j and Redis in this plan. Agent, indexing, GitHub, Solutions and MCP come in plans 2–5.

**Tech Stack:** Node 24, npm 11 workspaces, Turbo 2, TypeScript ~5.9, Zod 4, Vite 8, React 19, @xyflow/react 12, elkjs 0.12, diff 9, Vitest 5 + Testing Library + jsdom, Playwright, Fastify 5, pg, neo4j-driver 6, ioredis, Docker Compose (Postgres 17, Neo4j 5 community, Redis 7).

**Spec:** `docs/superpowers/specs/2026-09-28-repository-designer-ide-design.md` (sections 1 and 2; section 3/4 are later plans).

**Plan series (each is its own plan document, written after the previous one ships):**
1. **This plan** — foundation, scene format, canvas.
2. GitHub App + indexing pipeline + System Graph (Neo4j).
3. Agent + chat (SSE) emitting scenes over the graph.
4. Solutions (versioned current/proposed + plan).
5. Remote MCP server + Claude Code handoff.

## Global Constraints

- Local ports (all verified free on 2026-09-28): web **5177**, api **4040**, Postgres **5548**, Neo4j bolt **7690** / http **7477**, Redis **6391**. Vite and the API use `strictPort`/fixed ports.
- Package scope `@rdi/*` (`@rdi/scene`, `@rdi/web`, `@rdi/api`). Internal packages export TypeScript source (`"exports": {".": "./src/index.ts"}`) — no build step for packages.
- TypeScript pinned to `~5.9.3` (TS 7 native is latest on npm; not adopted). `strict: true`, `noUncheckedIndexedAccess: true`.
- Code, comments, commit messages and UI copy in **English**.
- Commits: Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Scene schema values are verbatim from the spec: node types `client|service|endpoint|queue|db|table|cache|external|function|data`; edge kinds `sync|async|read|write|calls`; scene kinds `flow|algorithm|load|diff-impact`; risk `bottleneck|spof|hot`; change `added|modified|removed`; payload format `json|sql|text`.
- The agent never draws: the renderer is deterministic given `(scene, stepIndex, progress, rps)`.
- Load numbers are always labeled as estimates in the UI ("Estimates — not measured metrics").
- Spec deviation (deliberate, YAGNI): animations use SVG `getPointAtLength` + CSS transitions instead of Framer Motion.

## Review Focus

1. **Scenes with zero steps** (`load`, `diff-impact`) — player controls render disabled, no crash, no "1 / 0" counter. Pinned in Task 5 (reducer) and Task 8 (PlayerControls test).
2. **Zoom target missing from the registry** (agent emits `zoom` to an unknown scene id) — double-click does nothing, no crash. Pinned in Task 5 (navigation test).
3. **Switching scenes during playback** — the player resets to step 1 and pauses; stale step indices never index into the new scene. Pinned in Task 5 (`frameAt` clamps) and Task 11 (E2E).
4. **RPS at extremes (0 and very high)** — no `NaN`/`Infinity` rendered; latency stays finite. Pinned in Task 3 (simulator tests) and Task 10 (LoadPanel test).
5. **Cyclic edges in a scene** (retry loops, callbacks) — simulator ignores back edges deterministically and reports them. Pinned in Task 3.

---

## File Structure

```
package.json, turbo.json, tsconfig.base.json, .gitignore, .nvmrc, .env.example, README.md
infra/docker-compose.yml
packages/scene/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts            public exports
  src/schema.ts           Zod schema + types
  src/validate.ts         schema + referential checks → LLM-friendly errors
  src/simulate.ts         deterministic load simulation
  src/samples/index.ts    registry of sample scenes + defineScene()
  src/samples/speaker-sync-flow.ts
  src/samples/speaker-reconcile-algorithm.ts
  src/samples/speaker-sync-load.ts
  src/samples/pr-impact.ts
  test/*.test.ts
apps/api/
  package.json, tsconfig.json, vitest.config.ts
  src/config.ts           env → config with local defaults
  src/checks.ts           infra checks (pg, neo4j, redis)
  src/app.ts              buildApp({ checks }) → Fastify
  src/server.ts           entrypoint
  test/health.test.ts, test/health.integration.test.ts
apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html, playwright.config.ts
  src/main.tsx, src/App.tsx, src/styles.css, src/test-setup.ts
  src/engine/player.ts     playback reducer
  src/engine/frame.ts      frameAt(scene, stepIndex)
  src/engine/navigation.ts zoom breadcrumb stack
  src/engine/usePlaybackClock.ts  rAF → tick
  src/canvas/layout.ts     ELK layout
  src/canvas/toFlow.ts     scene+layout+frame+load → React Flow nodes/edges
  src/canvas/SceneNode.tsx, SceneEdge.tsx, Canvas.tsx
  src/panels/PlayerControls.tsx, NarrationPanel.tsx, PayloadPanel.tsx, LoadPanel.tsx, SceneTabs.tsx
  test/*.test.ts(x), e2e/canvas.spec.ts
```

---

### Task 1: Monorepo scaffold + infrastructure

**Files:**
- Create: `package.json`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `.env.example`, `infra/docker-compose.yml`, `README.md`

**Interfaces:**
- Produces: root scripts `dev`, `test`, `typecheck`, `infra:up`, `infra:down`; env vars `DATABASE_URL`, `NEO4J_URL`, `NEO4J_USER`, `NEO4J_PASSWORD`, `REDIS_URL`, `API_PORT`.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "repository-designer-ide",
  "private": true,
  "packageManager": "npm@11.13.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "infra:up": "docker compose -f infra/docker-compose.yml up -d --wait",
    "infra:down": "docker compose -f infra/docker-compose.yml down"
  }
}
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "outputs": [] },
    "typecheck": { "outputs": [] }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.turbo/
.env
coverage/
playwright-report/
test-results/
```

`.nvmrc`: `24`

`.env.example`:
```
API_PORT=4040
DATABASE_URL=postgres://rdi:rdi@localhost:5548/rdi
NEO4J_URL=bolt://localhost:7690
NEO4J_USER=neo4j
NEO4J_PASSWORD=rdi-dev-password
REDIS_URL=redis://localhost:6391
```

- [ ] **Step 2: `infra/docker-compose.yml`**

```yaml
name: rdi
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: rdi
      POSTGRES_PASSWORD: rdi
      POSTGRES_DB: rdi
    ports: ["5548:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rdi -d rdi"]
      interval: 3s
      retries: 20
  neo4j:
    image: neo4j:5-community
    environment:
      NEO4J_AUTH: neo4j/rdi-dev-password
    ports: ["7477:7474", "7690:7687"]
    volumes: [neo4jdata:/data]
    healthcheck:
      test: ["CMD-SHELL", "cypher-shell -u neo4j -p rdi-dev-password 'RETURN 1' || exit 1"]
      interval: 5s
      retries: 30
  redis:
    image: redis:7-alpine
    ports: ["6391:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      retries: 20
volumes:
  pgdata:
  neo4jdata:
```

- [ ] **Step 3: Install root tooling and start infra**

Run:
```bash
npm install -D turbo typescript@~5.9.3
cp .env.example .env
npm run infra:up
docker compose -f infra/docker-compose.yml ps
```
Expected: three services `healthy`.

- [ ] **Step 4: `README.md`**

```markdown
# Repository Designer IDE

Chat + animated canvas to understand systems and changes without reading code.
Spec: `docs/superpowers/specs/2026-09-28-repository-designer-ide-design.md`.

## Local development

| Service  | Port |
|----------|------|
| web      | 5177 |
| api      | 4040 |
| Postgres | 5548 |
| Neo4j    | 7690 (bolt) / 7477 (browser) |
| Redis    | 6391 |

    cp .env.example .env
    npm install
    npm run infra:up
    npm run dev
    npm test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo and local infrastructure

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Scene schema + referential validation (`packages/scene`)

**Files:**
- Create: `packages/scene/package.json`, `packages/scene/tsconfig.json`, `packages/scene/vitest.config.ts`, `packages/scene/src/schema.ts`, `packages/scene/src/validate.ts`, `packages/scene/src/index.ts`
- Test: `packages/scene/test/validate.test.ts`

**Interfaces:**
- Produces:
  - `sceneSchema` (Zod), `type Scene = z.infer<typeof sceneSchema>`, `type SceneInput = z.input<typeof sceneSchema>`, `type SceneNode = Scene['nodes'][number]`, `type SceneEdge = Scene['edges'][number]`, `type SceneStep = Scene['steps'][number]`
  - constants `NODE_TYPES`, `EDGE_KINDS`, `SCENE_KINDS`, `RISKS`, `CHANGES`, `PAYLOAD_FORMATS`
  - `validateScene(input: unknown): ValidationResult` where `type ValidationResult = { ok: true; scene: Scene } | { ok: false; errors: string[] }`. Error strings are `"<dotted.path>: <message>"` — later fed back verbatim to the agent.

- [ ] **Step 1: Package setup**

`packages/scene/package.json`:
```json
{
  "name": "@rdi/scene",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`packages/scene/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/scene/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node' } });
```

Run: `npm install -w @rdi/scene zod && npm install -w @rdi/scene -D vitest`

- [ ] **Step 2: Write the failing tests**

`packages/scene/test/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validateScene } from '../src/index';

const base = () => ({
  id: 's1',
  title: 'Minimal flow',
  kind: 'flow',
  nodes: [
    { id: 'client', type: 'client', label: 'Browser' },
    { id: 'api', type: 'service', label: 'API' },
  ],
  edges: [{ id: 'e1', from: 'client', to: 'api', kind: 'sync' }],
  steps: [{ narration: 'The browser calls the API', focus: ['api'], travel: { edgeId: 'e1' } }],
});

const errorsOf = (input: unknown) => {
  const result = validateScene(input);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
};

describe('validateScene', () => {
  it('accepts a minimal valid scene and applies defaults', () => {
    const result = validateScene(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.groups).toEqual([]);
    expect(result.scene.nodes[0]?.meta).toEqual({});
    expect(result.scene.steps[0]?.highlight).toEqual([]);
  });

  it('reports schema errors with dotted paths', () => {
    const scene = base();
    (scene.nodes[0] as { type: string }).type = 'spaceship';
    expect(errorsOf(scene)).toEqual([expect.stringMatching(/^nodes\.0\.type: /)]);
  });

  it('rejects labels longer than 120 characters', () => {
    const scene = base();
    scene.nodes[0]!.label = 'x'.repeat(121);
    expect(errorsOf(scene)[0]).toMatch(/^nodes\.0\.label: /);
  });

  it('rejects duplicate node and edge ids', () => {
    const scene = base();
    scene.nodes.push({ id: 'api', type: 'db', label: 'Dup' });
    scene.edges.push({ id: 'e1', from: 'api', to: 'client', kind: 'sync' });
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['nodes.2.id: duplicate node id "api"', 'edges.1.id: duplicate edge id "e1"']),
    );
  });

  it('rejects edges, steps, groups and zoom pointing at unknown ids', () => {
    const scene = {
      ...base(),
      edges: [{ id: 'e1', from: 'client', to: 'ghost', kind: 'sync' }],
      groups: [{ id: 'g', label: 'G', nodeIds: ['nobody'] }],
      steps: [
        { narration: 'x', focus: ['ghost'], highlight: ['ghost2'], travel: { edgeId: 'nope' }, annotate: [{ nodeId: 'ghost3', text: 't' }] },
      ],
      zoom: { ghost4: 'other-scene' },
    };
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'edges.0.to: unknown node "ghost"',
        'groups.0.nodeIds.0: unknown node "nobody"',
        'steps.0.focus.0: unknown node "ghost"',
        'steps.0.highlight.0: unknown node "ghost2"',
        'steps.0.travel.edgeId: unknown edge "nope"',
        'steps.0.annotate.0.nodeId: unknown node "ghost3"',
        'zoom.ghost4: unknown node "ghost4"',
      ]),
    );
  });

  it('rejects a node that belongs to two groups', () => {
    const scene = {
      ...base(),
      groups: [
        { id: 'g1', label: 'A', nodeIds: ['api'] },
        { id: 'g2', label: 'B', nodeIds: ['api'] },
      ],
    };
    expect(errorsOf(scene)).toContain('groups.1.nodeIds.0: node "api" already belongs to group "g1"');
  });

  it('rejects a scene that zooms into itself', () => {
    expect(errorsOf({ ...base(), zoom: { api: 's1' } })).toContain('zoom.api: a scene cannot zoom into itself');
  });

  it('requires steps for flow and algorithm scenes', () => {
    expect(errorsOf({ ...base(), steps: [] })).toContain('steps: a "flow" scene needs at least one step');
  });

  it('requires load config for load scenes and valid load references', () => {
    expect(errorsOf({ ...base(), kind: 'load', steps: [] })).toContain('load: a "load" scene needs a load config');
    const scene = {
      ...base(),
      kind: 'load',
      steps: [],
      load: { rps: 10, nodes: { ghost: { capacity: 5, latencyMs: 1 } }, queues: { api: { consumers: 2 } } },
    };
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['load.nodes.ghost: unknown node "ghost"', 'load.queues.api: node "api" is not a queue']),
    );
  });

  it('accepts a zero-step diff-impact scene', () => {
    const scene = { ...base(), kind: 'diff-impact', steps: [] };
    expect(validateScene(scene).ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @rdi/scene`
Expected: FAIL — `Failed to resolve import "../src/index"`.

- [ ] **Step 4: Implement the schema**

`packages/scene/src/schema.ts`:
```ts
import { z } from 'zod';

export const NODE_TYPES = ['client', 'service', 'endpoint', 'queue', 'db', 'table', 'cache', 'external', 'function', 'data'] as const;
export const EDGE_KINDS = ['sync', 'async', 'read', 'write', 'calls'] as const;
export const SCENE_KINDS = ['flow', 'algorithm', 'load', 'diff-impact'] as const;
export const RISKS = ['bottleneck', 'spof', 'hot'] as const;
export const CHANGES = ['added', 'modified', 'removed'] as const;
export const PAYLOAD_FORMATS = ['json', 'sql', 'text'] as const;

const MAX_LABEL = 120;
const MAX_TEXT = 2000;
const MAX_PAYLOAD = 20_000;
const MAX_NODES = 80;
const MAX_STEPS = 60;

const idSchema = z.string().min(1).max(MAX_LABEL);

const nodeSchema = z.object({
  id: idSchema,
  type: z.enum(NODE_TYPES),
  label: z.string().min(1).max(MAX_LABEL),
  repo: z.string().max(MAX_LABEL).optional(),
  graphRef: z.string().max(MAX_TEXT).optional(),
  meta: z
    .object({
      tech: z.string().max(MAX_LABEL).optional(),
      notes: z.string().max(MAX_TEXT).optional(),
      risk: z.enum(RISKS).optional(),
      change: z.enum(CHANGES).optional(),
    })
    .default({}),
});

const edgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  kind: z.enum(EDGE_KINDS),
  label: z.string().max(MAX_LABEL).optional(),
});

const groupSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(MAX_LABEL),
  nodeIds: z.array(idSchema).min(1),
});

const payloadSchema = z
  .object({
    format: z.enum(PAYLOAD_FORMATS),
    before: z.string().max(MAX_PAYLOAD).optional(),
    after: z.string().max(MAX_PAYLOAD).optional(),
  })
  .refine((p) => p.before !== undefined || p.after !== undefined, { message: 'payload needs before or after' });

const stepSchema = z.object({
  narration: z.string().min(1).max(MAX_TEXT),
  focus: z.array(idSchema).default([]),
  travel: z.object({ edgeId: idSchema, payload: z.string().max(MAX_LABEL).optional() }).optional(),
  payload: payloadSchema.optional(),
  highlight: z.array(idSchema).default([]),
  annotate: z.array(z.object({ nodeId: idSchema, text: z.string().min(1).max(MAX_TEXT) })).default([]),
});

const loadSchema = z.object({
  rps: z.number().positive(),
  nodes: z.record(z.string(), z.object({ capacity: z.number().positive(), latencyMs: z.number().nonnegative() })),
  queues: z
    .record(z.string(), z.object({ consumers: z.number().int().positive(), maxDepth: z.number().int().positive().optional() }))
    .optional(),
});

export const sceneSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(MAX_LABEL),
  kind: z.enum(SCENE_KINDS),
  nodes: z.array(nodeSchema).min(1).max(MAX_NODES),
  edges: z.array(edgeSchema).default([]),
  groups: z.array(groupSchema).default([]),
  steps: z.array(stepSchema).max(MAX_STEPS).default([]),
  zoom: z.record(z.string(), idSchema).optional(),
  load: loadSchema.optional(),
});

export type Scene = z.infer<typeof sceneSchema>;
export type SceneInput = z.input<typeof sceneSchema>;
export type SceneNode = Scene['nodes'][number];
export type SceneEdge = Scene['edges'][number];
export type SceneStep = Scene['steps'][number];
export type SceneLoad = NonNullable<Scene['load']>;
```

- [ ] **Step 5: Implement referential validation**

`packages/scene/src/validate.ts`:
```ts
import { sceneSchema, type Scene } from './schema';

export type ValidationResult = { ok: true; scene: Scene } | { ok: false; errors: string[] };

const KINDS_REQUIRING_STEPS = new Set<Scene['kind']>(['flow', 'algorithm']);

const checkIdList = (ids: string[], known: Set<string>, path: string, errors: string[]) =>
  ids.forEach((id, i) => {
    if (!known.has(id)) errors.push(`${path}.${i}: unknown node "${id}"`);
  });

const collectDuplicates = (items: { id: string }[], label: string, path: string, errors: string[]) => {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) errors.push(`${path}.${i}.id: duplicate ${label} id "${item.id}"`);
    seen.add(item.id);
  });
  return seen;
};

const checkReferences = (scene: Scene): string[] => {
  const errors: string[] = [];
  const nodeIds = collectDuplicates(scene.nodes, 'node', 'nodes', errors);
  const edgeIds = collectDuplicates(scene.edges, 'edge', 'edges', errors);
  const nodeTypes = new Map(scene.nodes.map((n) => [n.id, n.type]));

  scene.edges.forEach((edge, i) => {
    if (!nodeIds.has(edge.from)) errors.push(`edges.${i}.from: unknown node "${edge.from}"`);
    if (!nodeIds.has(edge.to)) errors.push(`edges.${i}.to: unknown node "${edge.to}"`);
  });

  const owner = new Map<string, string>();
  scene.groups.forEach((group, g) =>
    group.nodeIds.forEach((id, i) => {
      if (!nodeIds.has(id)) {
        errors.push(`groups.${g}.nodeIds.${i}: unknown node "${id}"`);
        return;
      }
      const previous = owner.get(id);
      if (previous) {
        errors.push(`groups.${g}.nodeIds.${i}: node "${id}" already belongs to group "${previous}"`);
        return;
      }
      owner.set(id, group.id);
    }),
  );

  scene.steps.forEach((step, s) => {
    checkIdList(step.focus, nodeIds, `steps.${s}.focus`, errors);
    checkIdList(step.highlight, nodeIds, `steps.${s}.highlight`, errors);
    step.annotate.forEach((a, i) => {
      if (!nodeIds.has(a.nodeId)) errors.push(`steps.${s}.annotate.${i}.nodeId: unknown node "${a.nodeId}"`);
    });
    if (step.travel && !edgeIds.has(step.travel.edgeId)) {
      errors.push(`steps.${s}.travel.edgeId: unknown edge "${step.travel.edgeId}"`);
    }
  });

  Object.entries(scene.zoom ?? {}).forEach(([nodeId, sceneId]) => {
    if (!nodeIds.has(nodeId)) errors.push(`zoom.${nodeId}: unknown node "${nodeId}"`);
    if (sceneId === scene.id) errors.push(`zoom.${nodeId}: a scene cannot zoom into itself`);
  });

  if (KINDS_REQUIRING_STEPS.has(scene.kind) && scene.steps.length === 0) {
    errors.push(`steps: a "${scene.kind}" scene needs at least one step`);
  }

  if (scene.kind === 'load' && !scene.load) errors.push('load: a "load" scene needs a load config');
  if (scene.load) {
    Object.keys(scene.load.nodes).forEach((id) => {
      if (!nodeIds.has(id)) errors.push(`load.nodes.${id}: unknown node "${id}"`);
    });
    Object.keys(scene.load.queues ?? {}).forEach((id) => {
      if (!nodeIds.has(id)) errors.push(`load.queues.${id}: unknown node "${id}"`);
      else if (nodeTypes.get(id) !== 'queue') errors.push(`load.queues.${id}: node "${id}" is not a queue`);
    });
  }

  return errors;
};

export const validateScene = (input: unknown): ValidationResult => {
  const parsed = sceneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }
  const errors = checkReferences(parsed.data);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scene: parsed.data };
};
```

`packages/scene/src/index.ts`:
```ts
export * from './schema';
export * from './validate';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @rdi/scene && npm run typecheck -w @rdi/scene`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scene): add scene schema and referential validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Deterministic load simulator

**Files:**
- Create: `packages/scene/src/simulate.ts`
- Modify: `packages/scene/src/index.ts`
- Test: `packages/scene/test/simulate.test.ts`

**Interfaces:**
- Consumes: `Scene` from Task 2.
- Produces:
  ```ts
  type NodeLoad = { arrivalRps: number; throughputRps: number; capacityRps: number; utilization: number;
                    queueDepth: number; latencyMs: number; saturated: boolean; hot: boolean };
  type LoadResult = { nodes: Record<string, NodeLoad>; endToEndLatencyMs: number;
                      bottlenecks: string[]; ignoredEdges: string[] };
  simulateLoad(scene: Scene, rps: number, elapsedSeconds?: number /* default 10 */): LoadResult
  ```

**Model (document it in the file's JSDoc):**
- Back edges found by DFS (roots in node declaration order) are ignored → `ignoredEdges`. The rest is a DAG.
- Entry nodes (no incoming DAG edges) receive `rps`. Other nodes receive the sum of their parents' `throughputRps` (fan-out duplicates, fan-in sums).
- Capacity: `load.nodes[id].capacity` (× `load.queues[id].consumers` for queues); unconfigured nodes have infinite capacity and 0 latency.
- Not saturated (`arrival < capacity`): `u = arrival/capacity`, `latency = L/(1-u)`, `queueDepth = u²/(1-u)`, `throughput = arrival`.
- Saturated: `throughput = capacity`, `queueDepth = min((arrival-capacity)*elapsed, maxDepth ?? ∞)`, `latency = L + queueDepth/capacity*1000`.
- `hot` = `0.8 ≤ u < 1`. `bottlenecks` = saturated ids sorted by utilization desc. `endToEndLatencyMs` = longest-path latency sum over the DAG.

- [ ] **Step 1: Write the failing tests**

`packages/scene/test/simulate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { simulateLoad, validateScene, type Scene } from '../src/index';

const scene = (): Scene => {
  const result = validateScene({
    id: 'load',
    title: 'Load',
    kind: 'load',
    nodes: [
      { id: 'client', type: 'client', label: 'Client' },
      { id: 'api', type: 'service', label: 'API' },
      { id: 'queue', type: 'queue', label: 'Jobs' },
      { id: 'worker', type: 'service', label: 'Worker' },
      { id: 'db', type: 'db', label: 'Postgres' },
    ],
    edges: [
      { id: 'c-a', from: 'client', to: 'api', kind: 'sync' },
      { id: 'a-q', from: 'api', to: 'queue', kind: 'async' },
      { id: 'q-w', from: 'queue', to: 'worker', kind: 'async' },
      { id: 'a-d', from: 'api', to: 'db', kind: 'read' },
    ],
    load: {
      rps: 40,
      nodes: {
        api: { capacity: 100, latencyMs: 20 },
        queue: { capacity: 30, latencyMs: 5 },
        worker: { capacity: 50, latencyMs: 100 },
        db: { capacity: 200, latencyMs: 5 },
      },
      queues: { queue: { consumers: 2, maxDepth: 1000 } },
    },
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.scene;
};

describe('simulateLoad', () => {
  it('computes M/M/1-style latency below capacity', () => {
    const r = simulateLoad(scene(), 40);
    expect(r.nodes.api!.utilization).toBeCloseTo(0.4);
    expect(r.nodes.api!.latencyMs).toBeCloseTo(33.333, 2);
    expect(r.nodes.api!.queueDepth).toBeCloseTo(0.2667, 3);
    expect(r.nodes.queue!.capacityRps).toBe(60);
    expect(r.nodes.queue!.latencyMs).toBeCloseTo(15, 5);
    expect(r.nodes.worker!.latencyMs).toBeCloseTo(500, 5);
    expect(r.nodes.worker!.hot).toBe(true);
    expect(r.nodes.db!.arrivalRps).toBe(40);
    expect(r.bottlenecks).toEqual([]);
    expect(r.endToEndLatencyMs).toBeCloseTo(548.333, 2);
  });

  it('saturates nodes, throttles downstream and ranks bottlenecks', () => {
    const r = simulateLoad(scene(), 80, 10);
    expect(r.nodes.queue!.saturated).toBe(true);
    expect(r.nodes.queue!.throughputRps).toBe(60);
    expect(r.nodes.queue!.queueDepth).toBe(200);
    expect(r.nodes.queue!.latencyMs).toBeCloseTo(3338.333, 2);
    expect(r.nodes.worker!.arrivalRps).toBe(60);
    expect(r.nodes.worker!.queueDepth).toBe(100);
    expect(r.nodes.worker!.latencyMs).toBeCloseTo(2100, 5);
    expect(r.bottlenecks).toEqual(['queue', 'worker']);
  });

  it('caps queue depth at maxDepth', () => {
    const r = simulateLoad(scene(), 200, 100);
    expect(r.nodes.api!.queueDepth).toBe(10_000);
    expect(r.nodes.queue!.queueDepth).toBe(1000);
    expect(r.nodes.queue!.latencyMs).toBeCloseTo(16_671.667, 2);
  });

  it('returns finite values at rps 0', () => {
    const r = simulateLoad(scene(), 0);
    expect(r.nodes.api!.latencyMs).toBe(20);
    expect(r.nodes.api!.utilization).toBe(0);
    Object.values(r.nodes).forEach((n) => {
      expect(Number.isFinite(n.latencyMs)).toBe(true);
      expect(Number.isFinite(n.queueDepth)).toBe(true);
    });
    expect(Number.isFinite(r.endToEndLatencyMs)).toBe(true);
  });

  it('sums fan-in arrivals', () => {
    const s = scene();
    s.nodes.push({ id: 'cron', type: 'client', label: 'Cron', meta: {} });
    s.edges.push({ id: 'cr-a', from: 'cron', to: 'api', kind: 'sync' });
    expect(simulateLoad(s, 10).nodes.api!.arrivalRps).toBe(20);
  });

  it('ignores back edges deterministically', () => {
    const s = scene();
    s.edges.push({ id: 'w-a', from: 'worker', to: 'api', kind: 'calls' });
    const r = simulateLoad(s, 40);
    expect(r.ignoredEdges).toEqual(['w-a']);
    expect(r.nodes.api!.arrivalRps).toBe(40);
  });

  it('rejects invalid rps', () => {
    expect(() => simulateLoad(scene(), -1)).toThrow(RangeError);
    expect(() => simulateLoad(scene(), Number.NaN)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/scene -- simulate`
Expected: FAIL — `simulateLoad` is not exported.

- [ ] **Step 3: Implement**

`packages/scene/src/simulate.ts`:
```ts
import type { Scene } from './schema';

export type NodeLoad = {
  arrivalRps: number;
  throughputRps: number;
  capacityRps: number;
  utilization: number;
  queueDepth: number;
  latencyMs: number;
  saturated: boolean;
  hot: boolean;
};

export type LoadResult = {
  nodes: Record<string, NodeLoad>;
  endToEndLatencyMs: number;
  bottlenecks: string[];
  ignoredEdges: string[];
};

const HOT_THRESHOLD = 0.8;
const DEFAULT_ELAPSED_SECONDS = 10;

const findBackEdges = (scene: Scene): Set<string> => {
  const outgoing = new Map<string, Scene['edges']>();
  scene.edges.forEach((e) => outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]));
  const state = new Map<string, 'visiting' | 'done'>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 'visiting');
    (outgoing.get(id) ?? []).forEach((edge) => {
      const next = state.get(edge.to);
      if (next === 'visiting') back.add(edge.id);
      else if (next === undefined) visit(edge.to);
    });
    state.set(id, 'done');
  };
  scene.nodes.forEach((n) => {
    if (!state.has(n.id)) visit(n.id);
  });
  return back;
};

const topologicalOrder = (scene: Scene, edges: Scene['edges']): string[] => {
  const indegree = new Map(scene.nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1));
  const ready = scene.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    edges
      .filter((e) => e.from === id)
      .forEach((e) => {
        const remaining = (indegree.get(e.to) ?? 0) - 1;
        indegree.set(e.to, remaining);
        if (remaining === 0) ready.push(e.to);
      });
  }
  return order;
};

/**
 * Deterministic steady-state estimate of how `rps` flows through a scene.
 * Back edges (cycles) are ignored; entry nodes receive `rps`; fan-out duplicates and fan-in sums
 * throughput. Below capacity uses M/M/1 approximations; above capacity the backlog grows for
 * `elapsedSeconds`, capped by the queue's `maxDepth`. Results are estimates, not measurements.
 */
export const simulateLoad = (scene: Scene, rps: number, elapsedSeconds = DEFAULT_ELAPSED_SECONDS): LoadResult => {
  if (!Number.isFinite(rps) || rps < 0) throw new RangeError(`rps must be a finite number >= 0, got ${rps}`);

  const backEdges = findBackEdges(scene);
  const edges = scene.edges.filter((e) => !backEdges.has(e.id));
  const order = topologicalOrder(scene, edges);
  const incoming = (id: string) => edges.filter((e) => e.to === id);
  const nodes: Record<string, NodeLoad> = {};
  const pathLatency = new Map<string, number>();

  order.forEach((id) => {
    const parents = incoming(id);
    const arrival = parents.length === 0 ? rps : parents.reduce((sum, e) => sum + (nodes[e.from]?.throughputRps ?? 0), 0);
    const config = scene.load?.nodes[id];
    const queue = scene.load?.queues?.[id];
    const capacity = config ? config.capacity * (queue?.consumers ?? 1) : Number.POSITIVE_INFINITY;
    const baseLatency = config?.latencyMs ?? 0;
    const utilization = Number.isFinite(capacity) ? arrival / capacity : 0;
    const saturated = arrival >= capacity;

    const queueDepth = saturated
      ? Math.min((arrival - capacity) * elapsedSeconds, queue?.maxDepth ?? Number.POSITIVE_INFINITY)
      : (utilization * utilization) / (1 - utilization);
    const latencyMs = saturated ? baseLatency + (queueDepth / capacity) * 1000 : baseLatency / (1 - utilization);

    nodes[id] = {
      arrivalRps: arrival,
      throughputRps: saturated ? capacity : arrival,
      capacityRps: capacity,
      utilization,
      queueDepth,
      latencyMs,
      saturated,
      hot: !saturated && utilization >= HOT_THRESHOLD,
    };
    const upstream = Math.max(0, ...parents.map((e) => pathLatency.get(e.from) ?? 0));
    pathLatency.set(id, upstream + latencyMs);
  });

  const bottlenecks = order
    .filter((id) => nodes[id]?.saturated)
    .sort((a, b) => (nodes[b]?.utilization ?? 0) - (nodes[a]?.utilization ?? 0));

  return {
    nodes,
    endToEndLatencyMs: Math.max(0, ...pathLatency.values()),
    bottlenecks,
    ignoredEdges: scene.edges.filter((e) => backEdges.has(e.id)).map((e) => e.id),
  };
};
```

Append to `packages/scene/src/index.ts`:
```ts
export * from './simulate';
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @rdi/scene && npm run typecheck -w @rdi/scene`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scene): add deterministic load simulator

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sample scenes registry

Hand-written scenes that exercise every mode. They are the canvas's content until the agent exists (plan 3) and remain as fixtures.

**Files:**
- Create: `packages/scene/src/samples/define.ts`, `packages/scene/src/samples/index.ts`, `speaker-sync-flow.ts`, `speaker-reconcile-algorithm.ts`, `speaker-sync-load.ts`, `pr-impact.ts`
- Modify: `packages/scene/src/index.ts`
- Test: `packages/scene/test/samples.test.ts`

**Interfaces:**
- Consumes: `validateScene`, `SceneInput`, `Scene`.
- Produces: `defineScene(input: SceneInput): Scene` (throws with joined errors if invalid); `sampleScenes: Scene[]`; `sampleSceneRegistry: Record<string, Scene>`. Scene ids: `speaker-sync-flow`, `speaker-reconcile-algorithm`, `speaker-sync-load`, `pr-impact`. Node ids the E2E test relies on: `worker` (zoomable in flow), `queue` + `worker` (load), `speaker-mapper` (added in pr-impact), `web` (unchanged in pr-impact).

- [ ] **Step 1: Write the failing test**

`packages/scene/test/samples.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { defineScene, sampleSceneRegistry, sampleScenes, simulateLoad, validateScene } from '../src/index';

describe('sample scenes', () => {
  it('are all valid and uniquely identified', () => {
    sampleScenes.forEach((scene) => expect(validateScene(scene)).toMatchObject({ ok: true }));
    expect(Object.keys(sampleSceneRegistry).sort()).toEqual(
      ['pr-impact', 'speaker-reconcile-algorithm', 'speaker-sync-flow', 'speaker-sync-load'],
    );
  });

  it('cover every scene kind', () => {
    expect(new Set(sampleScenes.map((s) => s.kind))).toEqual(new Set(['flow', 'algorithm', 'load', 'diff-impact']));
  });

  it('resolve every zoom target inside the registry', () => {
    sampleScenes.forEach((scene) =>
      Object.values(scene.zoom ?? {}).forEach((target) => expect(sampleSceneRegistry[target]).toBeDefined()),
    );
  });

  it('flow scene has at least one payload step', () => {
    expect(sampleSceneRegistry['speaker-sync-flow']!.steps.some((s) => s.payload)).toBe(true);
  });

  it('load scene saturates the queue at 4x its default rps', () => {
    const load = sampleSceneRegistry['speaker-sync-load']!;
    expect(simulateLoad(load, load.load!.rps).bottlenecks).toEqual([]);
    expect(simulateLoad(load, load.load!.rps * 4).bottlenecks).toContain('queue');
  });

  it('defineScene throws readable errors', () => {
    expect(() => defineScene({ id: 'x', title: 'x', kind: 'flow', nodes: [{ id: 'a', type: 'client', label: 'A' }] })).toThrow(
      /steps: a "flow" scene needs at least one step/,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/scene -- samples`
Expected: FAIL — `defineScene` not exported.

- [ ] **Step 3: Implement the samples**

`packages/scene/src/samples/define.ts`:
```ts
import type { Scene, SceneInput } from '../schema';
import { validateScene } from '../validate';

export const defineScene = (input: SceneInput): Scene => {
  const result = validateScene(input);
  if (!result.ok) throw new Error(`Invalid scene "${input.id}":\n${result.errors.join('\n')}`);
  return result.scene;
};
```

`packages/scene/src/samples/speaker-sync-flow.ts`:
```ts
import { defineScene } from './define';

export const speakerSyncFlow = defineScene({
  id: 'speaker-sync-flow',
  title: 'Speaker sync from Cvent',
  kind: 'flow',
  nodes: [
    { id: 'organizer', type: 'client', label: 'Organizer (browser)' },
    { id: 'web', type: 'service', label: 'Web app', repo: 'web-ui', meta: { tech: 'React' } },
    { id: 'sync-endpoint', type: 'endpoint', label: 'POST /integrations/:id/sync', repo: 'web-api', meta: { tech: 'Express' } },
    { id: 'jobs-queue', type: 'queue', label: 'jobs queue', repo: 'web-api', meta: { tech: 'SQS' } },
    { id: 'worker', type: 'service', label: 'Sync worker', repo: 'web-api', meta: { tech: 'Node worker', notes: 'Double-click to see the reconciliation algorithm' } },
    { id: 'lock', type: 'cache', label: 'Redis lock', meta: { tech: 'Redlock', risk: 'spof' } },
    { id: 'cvent', type: 'external', label: 'Cvent REST API', meta: { risk: 'bottleneck', notes: 'Rate limited, paginated, eventually consistent' } },
    { id: 'speakers', type: 'table', label: 'speakers', meta: { tech: 'Postgres' } },
  ],
  edges: [
    { id: 'o-w', from: 'organizer', to: 'web', kind: 'sync', label: 'click "Sync now"' },
    { id: 'w-e', from: 'web', to: 'sync-endpoint', kind: 'sync', label: 'HTTP' },
    { id: 'e-q', from: 'sync-endpoint', to: 'jobs-queue', kind: 'async', label: 'enqueue' },
    { id: 'q-k', from: 'jobs-queue', to: 'worker', kind: 'async', label: 'consume' },
    { id: 'k-l', from: 'worker', to: 'lock', kind: 'write', label: 'acquire' },
    { id: 'k-c', from: 'worker', to: 'cvent', kind: 'calls', label: 'GET /speakers?page=n' },
    { id: 'k-s', from: 'worker', to: 'speakers', kind: 'write', label: 'upsert / delete' },
  ],
  groups: [
    { id: 'g-web', label: 'web-ui', nodeIds: ['web'] },
    { id: 'g-api', label: 'web-api', nodeIds: ['sync-endpoint', 'jobs-queue', 'worker'] },
  ],
  steps: [
    { narration: 'The organizer clicks "Sync now" in the web app.', focus: ['organizer', 'web'], travel: { edgeId: 'o-w', payload: 'click' } },
    {
      narration: 'The web app calls the sync endpoint for integration 42.',
      focus: ['sync-endpoint'],
      travel: { edgeId: 'w-e', payload: 'POST' },
      payload: { format: 'json', after: '{\n  "integrationId": 42,\n  "eventId": 5954\n}' },
    },
    {
      narration: 'The endpoint does not sync inline: it enqueues a job and answers 202 immediately.',
      focus: ['jobs-queue'],
      travel: { edgeId: 'e-q', payload: 'job' },
      payload: { format: 'json', before: '{\n  "integrationId": 42,\n  "eventId": 5954\n}', after: '{\n  "type": "cvent.speakers.sync",\n  "integrationId": 42,\n  "eventId": 5954,\n  "attempt": 1\n}' },
    },
    { narration: 'A worker picks the job and takes a Redis lock so two syncs never run for the same event.', focus: ['worker', 'lock'], travel: { edgeId: 'k-l', payload: 'lock' }, annotate: [{ nodeId: 'lock', text: 'Lock held ~2-4s' }] },
    {
      narration: 'The worker pages through Cvent speakers. This is the slowest hop: rate limits and pagination.',
      focus: ['cvent'],
      highlight: ['worker'],
      travel: { edgeId: 'k-c', payload: 'page 1..n' },
      payload: { format: 'json', after: '{\n  "data": [\n    { "id": "cv-17", "firstName": "Ada", "lastName": "Lovelace" }\n  ],\n  "paging": { "next": "page=2" }\n}' },
    },
    {
      narration: 'Each Cvent speaker is mapped and upserted; mappings missing from Cvent are deleted.',
      focus: ['speakers'],
      travel: { edgeId: 'k-s', payload: 'rows' },
      payload: { format: 'sql', before: '-- Cvent speaker cv-17', after: "INSERT INTO speakers (external_id, first_name, last_name)\nVALUES ('cv-17', 'Ada', 'Lovelace')\nON CONFLICT (external_id) DO UPDATE SET first_name = EXCLUDED.first_name;" },
    },
  ],
  zoom: { worker: 'speaker-reconcile-algorithm' },
});
```

`packages/scene/src/samples/speaker-reconcile-algorithm.ts`:
```ts
import { defineScene } from './define';

export const speakerReconcileAlgorithm = defineScene({
  id: 'speaker-reconcile-algorithm',
  title: 'Reconciliation algorithm (inside the sync worker)',
  kind: 'algorithm',
  nodes: [
    { id: 'fetch', type: 'function', label: 'fetchAllPages()' },
    { id: 'remote', type: 'data', label: 'remote: Map<externalId, speaker>' },
    { id: 'local', type: 'data', label: 'local: Map<externalId, mapping>' },
    { id: 'diff', type: 'function', label: 'diff(remote, local)' },
    { id: 'upserts', type: 'data', label: 'toUpsert[]' },
    { id: 'deletes', type: 'data', label: 'toDelete[]', meta: { risk: 'hot', notes: 'Deletes trust a possibly incomplete remote list' } },
    { id: 'apply', type: 'function', label: 'applyInTransaction()' },
  ],
  edges: [
    { id: 'f-r', from: 'fetch', to: 'remote', kind: 'write' },
    { id: 'r-d', from: 'remote', to: 'diff', kind: 'read' },
    { id: 'l-d', from: 'local', to: 'diff', kind: 'read' },
    { id: 'd-u', from: 'diff', to: 'upserts', kind: 'write' },
    { id: 'd-x', from: 'diff', to: 'deletes', kind: 'write' },
    { id: 'u-a', from: 'upserts', to: 'apply', kind: 'read' },
    { id: 'x-a', from: 'deletes', to: 'apply', kind: 'read' },
  ],
  steps: [
    { narration: 'Loop: fetch page after page until "next" is empty, filling a map keyed by external id.', focus: ['fetch', 'remote'], travel: { edgeId: 'f-r', payload: 'page' }, payload: { format: 'json', before: '{}', after: '{\n  "cv-17": "Ada Lovelace",\n  "cv-18": "Alan Turing"\n}' } },
    { narration: 'Load existing mappings for this event into a second map.', focus: ['local'], payload: { format: 'json', after: '{\n  "cv-17": "speaker 901",\n  "cv-99": "speaker 950"\n}' } },
    { narration: 'Diff both maps in O(n): keys only in remote → upsert; keys only in local → delete.', focus: ['diff'], highlight: ['remote', 'local'], travel: { edgeId: 'r-d' } },
    { narration: 'cv-17 exists in both → update. cv-18 is new → insert.', focus: ['upserts'], travel: { edgeId: 'd-u', payload: '2 rows' }, payload: { format: 'json', after: '[\n  { "externalId": "cv-17", "op": "update" },\n  { "externalId": "cv-18", "op": "insert" }\n]' } },
    { narration: 'cv-99 is missing remotely → delete. If Cvent returned a partial list, this deletes real speakers.', focus: ['deletes'], travel: { edgeId: 'd-x', payload: '1 row' }, annotate: [{ nodeId: 'deletes', text: 'Risk: eventual consistency' }] },
    { narration: 'Everything is applied in one transaction so a failure leaves no half-synced state.', focus: ['apply'], highlight: ['upserts', 'deletes'], travel: { edgeId: 'u-a' } },
  ],
});
```

`packages/scene/src/samples/speaker-sync-load.ts`:
```ts
import { defineScene } from './define';

export const speakerSyncLoad = defineScene({
  id: 'speaker-sync-load',
  title: 'Speaker sync under load',
  kind: 'load',
  nodes: [
    { id: 'organizers', type: 'client', label: 'Organizers' },
    { id: 'sync-endpoint', type: 'endpoint', label: 'POST /integrations/:id/sync' },
    { id: 'queue', type: 'queue', label: 'jobs queue', meta: { tech: 'SQS' } },
    { id: 'worker', type: 'service', label: 'Sync worker' },
    { id: 'cvent', type: 'external', label: 'Cvent REST API', meta: { risk: 'bottleneck' } },
    { id: 'speakers', type: 'table', label: 'speakers' },
  ],
  edges: [
    { id: 'o-e', from: 'organizers', to: 'sync-endpoint', kind: 'sync' },
    { id: 'e-q', from: 'sync-endpoint', to: 'queue', kind: 'async' },
    { id: 'q-w', from: 'queue', to: 'worker', kind: 'async' },
    { id: 'w-c', from: 'worker', to: 'cvent', kind: 'calls' },
    { id: 'w-s', from: 'worker', to: 'speakers', kind: 'write' },
  ],
  load: {
    rps: 5,
    nodes: {
      'sync-endpoint': { capacity: 200, latencyMs: 15 },
      queue: { capacity: 4, latencyMs: 20 },
      worker: { capacity: 40, latencyMs: 250 },
      cvent: { capacity: 25, latencyMs: 400 },
      speakers: { capacity: 300, latencyMs: 8 },
    },
    queues: { queue: { consumers: 3, maxDepth: 5000 } },
  },
});
```
(At rps 5: queue capacity 12 → u≈0.42, cvent u=0.2. At rps 20: queue saturated → test passes.)

`packages/scene/src/samples/pr-impact.ts`:
```ts
import { defineScene } from './define';

export const prImpact = defineScene({
  id: 'pr-impact',
  title: 'PR #1234 — map Cvent speaker photos',
  kind: 'diff-impact',
  nodes: [
    { id: 'web', type: 'service', label: 'Web app', repo: 'web-ui' },
    { id: 'worker', type: 'service', label: 'Sync worker', repo: 'web-api', meta: { change: 'modified' } },
    { id: 'speaker-mapper', type: 'function', label: 'mapCventSpeaker()', repo: 'web-api', meta: { change: 'added' } },
    { id: 's3', type: 'external', label: 'S3 content bucket', meta: { change: 'added', risk: 'hot', notes: 'New write path per speaker' } },
    { id: 'speakers', type: 'table', label: 'speakers', meta: { change: 'modified', notes: 'New column photo_url' } },
    { id: 'legacy-photo', type: 'function', label: 'copyPhotoLegacy()', repo: 'web-api', meta: { change: 'removed' } },
  ],
  edges: [
    { id: 'w-sp', from: 'web', to: 'speakers', kind: 'read' },
    { id: 'k-m', from: 'worker', to: 'speaker-mapper', kind: 'calls' },
    { id: 'm-s3', from: 'speaker-mapper', to: 's3', kind: 'write' },
    { id: 'm-sp', from: 'speaker-mapper', to: 'speakers', kind: 'write' },
    { id: 'k-l', from: 'worker', to: 'legacy-photo', kind: 'calls' },
  ],
});
```

`packages/scene/src/samples/index.ts`:
```ts
import type { Scene } from '../schema';
import { prImpact } from './pr-impact';
import { speakerReconcileAlgorithm } from './speaker-reconcile-algorithm';
import { speakerSyncFlow } from './speaker-sync-flow';
import { speakerSyncLoad } from './speaker-sync-load';

export { defineScene } from './define';

export const sampleScenes: Scene[] = [speakerSyncFlow, speakerReconcileAlgorithm, speakerSyncLoad, prImpact];

export const sampleSceneRegistry: Record<string, Scene> = Object.fromEntries(sampleScenes.map((s) => [s.id, s]));
```

Append to `packages/scene/src/index.ts`:
```ts
export * from './samples';
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @rdi/scene && npm run typecheck -w @rdi/scene`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scene): add sample scenes for every animation mode

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Web app scaffold + pure playback engine

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/test-setup.ts`, `src/engine/player.ts`, `src/engine/frame.ts`, `src/engine/navigation.ts`
- Test: `apps/web/test/player.test.ts`, `apps/web/test/frame.test.ts`, `apps/web/test/navigation.test.ts`

**Interfaces:**
- Consumes: `Scene`, `sampleSceneRegistry`.
- Produces:
  ```ts
  // player.ts
  const STEP_DURATION_MS = 2500; const MIN_SPEED = 0.25; const MAX_SPEED = 4;
  type PlayerState = { stepIndex: number; progress: number; playing: boolean; speed: number };
  type PlayerAction = { type: 'play' } | { type: 'pause' } | { type: 'next' } | { type: 'prev' }
    | { type: 'seek'; stepIndex: number } | { type: 'setSpeed'; speed: number }
    | { type: 'tick'; deltaMs: number } | { type: 'reset' };
  initialPlayerState: PlayerState
  reducePlayer(state: PlayerState, action: PlayerAction, stepCount: number): PlayerState
  // frame.ts
  type Frame = { step: SceneStep | null; stepIndex: number; focused: Set<string>; highlighted: Set<string>;
                 activeEdgeId: string | null; tokenLabel: string | null; visitedEdgeIds: Set<string>;
                 annotations: Record<string, string> };
  frameAt(scene: Scene, stepIndex: number): Frame
  // navigation.ts
  type NavState = { stack: string[] };
  rootNav(sceneId: string): NavState
  enterZoom(nav: NavState, scene: Scene, nodeId: string, registry: Record<string, Scene>): NavState
  goToDepth(nav: NavState, depth: number): NavState
  currentSceneId(nav: NavState): string
  ```

- [ ] **Step 1: Scaffold the web app**

`apps/web/package.json`:
```json
{
  "name": "@rdi/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "e2e": "playwright test"
  },
  "dependencies": { "@rdi/scene": "*" }
}
```

Run (the `@rdi/scene` workspace dependency is declared in `package.json` above so npm links it locally instead of hitting the registry):
```bash
npm install
npm install -w @rdi/web react react-dom @xyflow/react elkjs diff
npm install -w @rdi/web -D vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom @playwright/test
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx", "types": ["vitest/globals", "@testing-library/jest-dom"] },
  "include": ["src", "test", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5177, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
```

`apps/web/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Repository Designer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx` (temporary, replaced in Task 9):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <p>Repository Designer</p>
  </StrictMode>,
);
```

- [ ] **Step 2: Write the failing engine tests**

`apps/web/test/player.test.ts`:
```ts
import { initialPlayerState, reducePlayer, STEP_DURATION_MS, type PlayerState } from '../src/engine/player';

const at = (patch: Partial<PlayerState>): PlayerState => ({ ...initialPlayerState, ...patch });

describe('reducePlayer', () => {
  it('starts paused at step 0', () => {
    expect(initialPlayerState).toEqual({ stepIndex: 0, progress: 0, playing: false, speed: 1 });
  });

  it('advances progress on tick and moves to the next step', () => {
    const half = reducePlayer(at({ playing: true }), { type: 'tick', deltaMs: STEP_DURATION_MS / 2 }, 3);
    expect(half).toMatchObject({ stepIndex: 0, progress: 0.5 });
    const next = reducePlayer(half, { type: 'tick', deltaMs: STEP_DURATION_MS }, 3);
    expect(next).toMatchObject({ stepIndex: 1, progress: 0, playing: true });
  });

  it('honours speed', () => {
    const s = reducePlayer(at({ playing: true, speed: 2 }), { type: 'tick', deltaMs: STEP_DURATION_MS / 4 }, 3);
    expect(s.progress).toBeCloseTo(0.5);
  });

  it('stops at the end of the last step', () => {
    const s = reducePlayer(at({ playing: true, stepIndex: 2, progress: 0.9 }), { type: 'tick', deltaMs: STEP_DURATION_MS }, 3);
    expect(s).toMatchObject({ stepIndex: 2, progress: 1, playing: false });
  });

  it('restarts from the beginning when play is pressed at the end', () => {
    expect(reducePlayer(at({ stepIndex: 2, progress: 1 }), { type: 'play' }, 3)).toMatchObject({ stepIndex: 0, progress: 0, playing: true });
  });

  it('ignores tick while paused', () => {
    const s = at({ progress: 0.3 });
    expect(reducePlayer(s, { type: 'tick', deltaMs: 1000 }, 3)).toBe(s);
  });

  it('clamps next, prev and seek', () => {
    expect(reducePlayer(at({ stepIndex: 2 }), { type: 'next' }, 3).stepIndex).toBe(2);
    expect(reducePlayer(at({ stepIndex: 0 }), { type: 'prev' }, 3).stepIndex).toBe(0);
    expect(reducePlayer(at({}), { type: 'seek', stepIndex: 99 }, 3)).toMatchObject({ stepIndex: 2, progress: 0 });
    expect(reducePlayer(at({}), { type: 'seek', stepIndex: -4 }, 3).stepIndex).toBe(0);
  });

  it('clamps speed', () => {
    expect(reducePlayer(at({}), { type: 'setSpeed', speed: 10 }, 3).speed).toBe(4);
    expect(reducePlayer(at({}), { type: 'setSpeed', speed: 0 }, 3).speed).toBe(0.25);
  });

  it('does nothing useful with zero steps', () => {
    expect(reducePlayer(initialPlayerState, { type: 'play' }, 0)).toEqual(initialPlayerState);
    expect(reducePlayer(initialPlayerState, { type: 'next' }, 0)).toEqual(initialPlayerState);
    expect(reducePlayer(initialPlayerState, { type: 'seek', stepIndex: 3 }, 0)).toEqual(initialPlayerState);
  });

  it('resets', () => {
    expect(reducePlayer(at({ stepIndex: 2, playing: true, speed: 2 }), { type: 'reset' }, 3)).toEqual({ ...initialPlayerState, speed: 2 });
  });
});
```

`apps/web/test/frame.test.ts`:
```ts
import { sampleSceneRegistry } from '@rdi/scene';
import { frameAt } from '../src/engine/frame';

const flow = sampleSceneRegistry['speaker-sync-flow']!;

describe('frameAt', () => {
  it('exposes focus, travel, visited edges and annotations', () => {
    const f = frameAt(flow, 3);
    expect(f.stepIndex).toBe(3);
    expect([...f.focused]).toEqual(['worker', 'lock']);
    expect(f.activeEdgeId).toBe('k-l');
    expect(f.tokenLabel).toBe('lock');
    expect([...f.visitedEdgeIds]).toEqual(['o-w', 'w-e', 'e-q']);
    expect(f.annotations).toEqual({ lock: 'Lock held ~2-4s' });
  });

  it('clamps out-of-range indices (scene switched mid-playback)', () => {
    expect(frameAt(flow, 999).stepIndex).toBe(flow.steps.length - 1);
  });

  it('returns an empty frame for scenes without steps', () => {
    const f = frameAt(sampleSceneRegistry['pr-impact']!, 2);
    expect(f).toMatchObject({ step: null, stepIndex: 0, activeEdgeId: null, tokenLabel: null, annotations: {} });
    expect(f.focused.size).toBe(0);
  });
});
```

`apps/web/test/navigation.test.ts`:
```ts
import { sampleSceneRegistry } from '@rdi/scene';
import { currentSceneId, enterZoom, goToDepth, rootNav } from '../src/engine/navigation';

const flow = sampleSceneRegistry['speaker-sync-flow']!;

describe('navigation', () => {
  it('zooms into a node with a registered sub-scene', () => {
    const nav = enterZoom(rootNav(flow.id), flow, 'worker', sampleSceneRegistry);
    expect(nav.stack).toEqual(['speaker-sync-flow', 'speaker-reconcile-algorithm']);
    expect(currentSceneId(nav)).toBe('speaker-reconcile-algorithm');
  });

  it('ignores nodes without zoom', () => {
    const nav = rootNav(flow.id);
    expect(enterZoom(nav, flow, 'web', sampleSceneRegistry)).toBe(nav);
  });

  it('ignores zoom targets missing from the registry', () => {
    const nav = rootNav(flow.id);
    const broken = { ...flow, zoom: { worker: 'does-not-exist' } };
    expect(enterZoom(nav, broken, 'worker', sampleSceneRegistry)).toBe(nav);
  });

  it('goes back to a breadcrumb depth', () => {
    const nav = enterZoom(rootNav(flow.id), flow, 'worker', sampleSceneRegistry);
    expect(goToDepth(nav, 0).stack).toEqual(['speaker-sync-flow']);
    expect(goToDepth(nav, 5)).toBe(nav);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @rdi/web`
Expected: FAIL — modules `../src/engine/*` not found.

- [ ] **Step 4: Implement the engine**

`apps/web/src/engine/player.ts`:
```ts
export const STEP_DURATION_MS = 2500;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

export type PlayerState = { stepIndex: number; progress: number; playing: boolean; speed: number };

export type PlayerAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; stepIndex: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'tick'; deltaMs: number }
  | { type: 'reset' };

export const initialPlayerState: PlayerState = { stepIndex: 0, progress: 0, playing: false, speed: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const tick = (state: PlayerState, deltaMs: number, stepCount: number): PlayerState => {
  if (!state.playing) return state;
  const progress = state.progress + (deltaMs * state.speed) / STEP_DURATION_MS;
  if (progress < 1) return { ...state, progress };
  const isLast = state.stepIndex >= stepCount - 1;
  return isLast ? { ...state, progress: 1, playing: false } : { ...state, stepIndex: state.stepIndex + 1, progress: 0 };
};

export const reducePlayer = (state: PlayerState, action: PlayerAction, stepCount: number): PlayerState => {
  if (action.type === 'reset') return { ...initialPlayerState, speed: state.speed };
  if (action.type === 'setSpeed') return { ...state, speed: clamp(action.speed, MIN_SPEED, MAX_SPEED) };
  if (stepCount === 0) return state;

  const last = stepCount - 1;
  switch (action.type) {
    case 'play': {
      const atEnd = state.stepIndex >= last && state.progress >= 1;
      return atEnd ? { ...state, stepIndex: 0, progress: 0, playing: true } : { ...state, playing: true };
    }
    case 'pause':
      return { ...state, playing: false };
    case 'next':
      return { ...state, stepIndex: Math.min(state.stepIndex + 1, last), progress: 0 };
    case 'prev':
      return { ...state, stepIndex: Math.max(state.stepIndex - 1, 0), progress: 0 };
    case 'seek':
      return { ...state, stepIndex: clamp(action.stepIndex, 0, last), progress: 0 };
    case 'tick':
      return tick(state, action.deltaMs, stepCount);
  }
};
```

`apps/web/src/engine/frame.ts`:
```ts
import type { Scene, SceneStep } from '@rdi/scene';

export type Frame = {
  step: SceneStep | null;
  stepIndex: number;
  focused: Set<string>;
  highlighted: Set<string>;
  activeEdgeId: string | null;
  tokenLabel: string | null;
  visitedEdgeIds: Set<string>;
  annotations: Record<string, string>;
};

const emptyFrame = (): Frame => ({
  step: null,
  stepIndex: 0,
  focused: new Set(),
  highlighted: new Set(),
  activeEdgeId: null,
  tokenLabel: null,
  visitedEdgeIds: new Set(),
  annotations: {},
});

export const frameAt = (scene: Scene, stepIndex: number): Frame => {
  if (scene.steps.length === 0) return emptyFrame();
  const index = Math.min(Math.max(stepIndex, 0), scene.steps.length - 1);
  const step = scene.steps[index] as SceneStep;
  const visited = scene.steps
    .slice(0, index)
    .flatMap((s) => (s.travel ? [s.travel.edgeId] : []));
  return {
    step,
    stepIndex: index,
    focused: new Set(step.focus),
    highlighted: new Set(step.highlight),
    activeEdgeId: step.travel?.edgeId ?? null,
    tokenLabel: step.travel?.payload ?? null,
    visitedEdgeIds: new Set(visited),
    annotations: Object.fromEntries(step.annotate.map((a) => [a.nodeId, a.text])),
  };
};
```

`apps/web/src/engine/navigation.ts`:
```ts
import type { Scene } from '@rdi/scene';

export type NavState = { stack: string[] };

export const rootNav = (sceneId: string): NavState => ({ stack: [sceneId] });

export const currentSceneId = (nav: NavState): string => nav.stack[nav.stack.length - 1] as string;

export const enterZoom = (nav: NavState, scene: Scene, nodeId: string, registry: Record<string, Scene>): NavState => {
  const target = scene.zoom?.[nodeId];
  if (!target || !registry[target]) return nav;
  return { stack: [...nav.stack, target] };
};

export const goToDepth = (nav: NavState, depth: number): NavState =>
  depth >= 0 && depth < nav.stack.length - 1 ? { stack: nav.stack.slice(0, depth + 1) } : nav;
```

- [ ] **Step 5: Run tests**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold web app with pure playback engine

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ELK layout + scene→React Flow mapper

**Files:**
- Create: `apps/web/src/canvas/layout.ts`, `apps/web/src/canvas/toFlow.ts`
- Test: `apps/web/test/layout.test.ts`, `apps/web/test/toFlow.test.ts`

**Interfaces:**
- Consumes: `Scene`, `LoadResult`, `NodeLoad` (Task 3), `Frame` (Task 5).
- Produces:
  ```ts
  // layout.ts
  const NODE_WIDTH = 200; const NODE_HEIGHT = 72;
  type Box = { x: number; y: number; width: number; height: number };
  type SceneLayout = { nodes: Record<string, Box & { parentId?: string }>; groups: Record<string, Box> };
  layoutScene(scene: Scene): Promise<SceneLayout>   // child coordinates relative to their group
  // toFlow.ts
  type NodeVisualState = 'normal' | 'focused' | 'highlighted' | 'dim';
  type SceneNodeData = { node: SceneNode; state: NodeVisualState; annotation?: string; load?: NodeLoad; zoomable: boolean };
  type SceneEdgeData = { kind: SceneEdge['kind']; label?: string; active: boolean; visited: boolean; tokenLabel: string | null; progress: number };
  toFlow(input: { scene: Scene; layout: SceneLayout; frame: Frame; progress: number; load?: LoadResult }):
    { nodes: Node[]; edges: Edge[] }   // Node/Edge from @xyflow/react; group nodes first; node types 'scene' | 'group', edge type 'scene'
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/layout.test.ts`:
```ts
// @vitest-environment node
import { sampleSceneRegistry } from '@rdi/scene';
import { layoutScene, NODE_HEIGHT, NODE_WIDTH } from '../src/canvas/layout';

const flow = sampleSceneRegistry['speaker-sync-flow']!;

const absolute = (layout: Awaited<ReturnType<typeof layoutScene>>, id: string) => {
  const box = layout.nodes[id]!;
  const parent = box.parentId ? layout.groups[box.parentId]! : { x: 0, y: 0 };
  return { x: box.x + parent.x, y: box.y + parent.y };
};

describe('layoutScene', () => {
  it('positions every node with fixed size', async () => {
    const layout = await layoutScene(flow);
    flow.nodes.forEach((n) => {
      expect(layout.nodes[n.id]).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT });
    });
  });

  it('nests grouped nodes under their group', async () => {
    const layout = await layoutScene(flow);
    expect(layout.nodes.worker!.parentId).toBe('g-api');
    expect(layout.nodes.organizer!.parentId).toBeUndefined();
    expect(layout.groups['g-api']!.width).toBeGreaterThan(NODE_WIDTH);
  });

  it('lays out left to right along edges', async () => {
    const layout = await layoutScene(flow);
    expect(absolute(layout, 'organizer').x).toBeLessThan(absolute(layout, 'web').x);
    expect(absolute(layout, 'web').x).toBeLessThan(absolute(layout, 'sync-endpoint').x);
  });

  it('keeps root-level nodes from overlapping', async () => {
    const layout = await layoutScene(sampleSceneRegistry['pr-impact']!);
    const boxes = Object.values(layout.nodes);
    boxes.forEach((a, i) =>
      boxes.slice(i + 1).forEach((b) => {
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }),
    );
  });
});
```

`apps/web/test/toFlow.test.ts`:
```ts
import { sampleSceneRegistry, simulateLoad } from '@rdi/scene';
import { frameAt } from '../src/engine/frame';
import { layoutScene } from '../src/canvas/layout';
import { toFlow, type SceneEdgeData, type SceneNodeData } from '../src/canvas/toFlow';

const nodeData = (nodes: ReturnType<typeof toFlow>['nodes'], id: string) =>
  nodes.find((n) => n.id === id)!.data as SceneNodeData;

describe('toFlow', () => {
  it('puts group nodes before their children with relative positions', async () => {
    const scene = sampleSceneRegistry['speaker-sync-flow']!;
    const layout = await layoutScene(scene);
    const { nodes } = toFlow({ scene, layout, frame: frameAt(scene, 0), progress: 0 });
    const groupIndex = nodes.findIndex((n) => n.id === 'g-api');
    const workerIndex = nodes.findIndex((n) => n.id === 'worker');
    expect(groupIndex).toBeLessThan(workerIndex);
    expect(nodes[workerIndex]).toMatchObject({ parentId: 'g-api', extent: 'parent', type: 'scene' });
    expect(nodes[groupIndex]!.type).toBe('group');
  });

  it('marks focused, highlighted and dimmed nodes, zoomability and annotations', async () => {
    const scene = sampleSceneRegistry['speaker-sync-flow']!;
    const layout = await layoutScene(scene);
    const { nodes, edges } = toFlow({ scene, layout, frame: frameAt(scene, 4), progress: 0.5 });
    expect(nodeData(nodes, 'cvent').state).toBe('focused');
    expect(nodeData(nodes, 'worker').state).toBe('highlighted');
    expect(nodeData(nodes, 'speakers').state).toBe('dim');
    expect(nodeData(nodes, 'worker').zoomable).toBe(true);
    const active = edges.find((e) => e.id === 'k-c')!.data as SceneEdgeData;
    expect(active).toMatchObject({ active: true, progress: 0.5, tokenLabel: 'page 1..n' });
    expect((edges.find((e) => e.id === 'o-w')!.data as SceneEdgeData).visited).toBe(true);
  });

  it('dims unchanged nodes in diff-impact scenes', async () => {
    const scene = sampleSceneRegistry['pr-impact']!;
    const layout = await layoutScene(scene);
    const { nodes } = toFlow({ scene, layout, frame: frameAt(scene, 0), progress: 0 });
    expect(nodeData(nodes, 'web').state).toBe('dim');
    expect(nodeData(nodes, 'speaker-mapper').state).toBe('normal');
  });

  it('attaches load results to nodes', async () => {
    const scene = sampleSceneRegistry['speaker-sync-load']!;
    const layout = await layoutScene(scene);
    const load = simulateLoad(scene, 20);
    const { nodes } = toFlow({ scene, layout, frame: frameAt(scene, 0), progress: 0, load });
    expect(nodeData(nodes, 'queue').load?.saturated).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- layout toFlow`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement layout**

`apps/web/src/canvas/layout.ts`:
```ts
import type { Scene } from '@rdi/scene';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 72;

export type Box = { x: number; y: number; width: number; height: number };
export type SceneLayout = { nodes: Record<string, Box & { parentId?: string }>; groups: Record<string, Box> };

const elk = new ELK();

const ROOT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
};
const GROUP_OPTIONS = { 'elk.padding': '[top=40,left=20,bottom=20,right=20]' };

const leaf = (id: string): ElkNode => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT });

const boxOf = (n: ElkNode): Box => ({ x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? NODE_WIDTH, height: n.height ?? NODE_HEIGHT });

export const layoutScene = async (scene: Scene): Promise<SceneLayout> => {
  const grouped = new Set(scene.groups.flatMap((g) => g.nodeIds));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: ROOT_OPTIONS,
    children: [
      ...scene.groups.map((g) => ({ id: g.id, layoutOptions: GROUP_OPTIONS, children: g.nodeIds.map(leaf) })),
      ...scene.nodes.filter((n) => !grouped.has(n.id)).map((n) => leaf(n.id)),
    ],
    edges: scene.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };

  const result = await elk.layout(graph);
  const layout: SceneLayout = { nodes: {}, groups: {} };
  const groupIds = new Set(scene.groups.map((g) => g.id));
  (result.children ?? []).forEach((child) => {
    if (!groupIds.has(child.id)) {
      layout.nodes[child.id] = boxOf(child);
      return;
    }
    layout.groups[child.id] = boxOf(child);
    (child.children ?? []).forEach((inner) => {
      layout.nodes[inner.id] = { ...boxOf(inner), parentId: child.id };
    });
  });
  return layout;
};
```

- [ ] **Step 4: Implement the mapper**

`apps/web/src/canvas/toFlow.ts`:
```ts
import type { LoadResult, NodeLoad, Scene, SceneEdge, SceneNode } from '@rdi/scene';
import type { Edge, Node } from '@xyflow/react';
import type { Frame } from '../engine/frame';
import type { SceneLayout } from './layout';

export type NodeVisualState = 'normal' | 'focused' | 'highlighted' | 'dim';

export type SceneNodeData = { node: SceneNode; state: NodeVisualState; annotation?: string; load?: NodeLoad; zoomable: boolean };

export type SceneEdgeData = {
  kind: SceneEdge['kind'];
  label?: string;
  active: boolean;
  visited: boolean;
  tokenLabel: string | null;
  progress: number;
};

type ToFlowInput = { scene: Scene; layout: SceneLayout; frame: Frame; progress: number; load?: LoadResult };

const visualState = (scene: Scene, node: SceneNode, frame: Frame): NodeVisualState => {
  if (frame.focused.has(node.id)) return 'focused';
  if (frame.highlighted.has(node.id)) return 'highlighted';
  if (frame.focused.size > 0) return 'dim';
  if (scene.kind === 'diff-impact' && !node.meta.change) return 'dim';
  return 'normal';
};

export const toFlow = ({ scene, layout, frame, progress, load }: ToFlowInput): { nodes: Node[]; edges: Edge[] } => {
  const groups: Node[] = scene.groups.map((g) => {
    const box = layout.groups[g.id] ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      id: g.id,
      type: 'group',
      position: { x: box.x, y: box.y },
      data: { label: g.label },
      style: { width: box.width, height: box.height },
      className: 'scene-group',
      selectable: false,
    };
  });

  const nodes: Node[] = scene.nodes.map((node) => {
    const box = layout.nodes[node.id] ?? { x: 0, y: 0, width: 0, height: 0 };
    const data: SceneNodeData = {
      node,
      state: visualState(scene, node, frame),
      annotation: frame.annotations[node.id],
      load: load?.nodes[node.id],
      zoomable: Boolean(scene.zoom?.[node.id]),
    };
    return {
      id: node.id,
      type: 'scene',
      position: { x: box.x, y: box.y },
      data,
      ...(box.parentId ? { parentId: box.parentId, extent: 'parent' as const } : {}),
    };
  });

  const edges: Edge[] = scene.edges.map((edge) => {
    const active = frame.activeEdgeId === edge.id;
    const data: SceneEdgeData = {
      kind: edge.kind,
      label: edge.label,
      active,
      visited: frame.visitedEdgeIds.has(edge.id),
      tokenLabel: active ? frame.tokenLabel : null,
      progress: active ? progress : 0,
    };
    return { id: edge.id, source: edge.from, target: edge.to, type: 'scene', data };
  });

  return { nodes: [...groups, ...nodes], edges };
};
```

- [ ] **Step 5: Run tests**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add ELK layout and scene-to-flow mapper

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Canvas components (node, edge with travelling token, canvas)

**Files:**
- Create: `apps/web/src/canvas/SceneNode.tsx`, `apps/web/src/canvas/SceneEdge.tsx`, `apps/web/src/canvas/Canvas.tsx`, `apps/web/src/canvas/useSceneLayout.ts`
- Test: `apps/web/test/SceneNode.test.tsx`

**Interfaces:**
- Consumes: `toFlow`, `SceneNodeData`, `SceneEdgeData`, `layoutScene`, `Frame`, `LoadResult`.
- Produces:
  - `<Canvas scene frame progress load? onZoom(nodeId: string) />`
  - `useSceneLayout(scene: Scene): SceneLayout | null`
  - DOM contract (E2E relies on it): node root `data-testid="node-<id>"` with classes `scene-node scene-node--<state>` plus `scene-node--change-<change>` / `scene-node--saturated` / `scene-node--hot`; token `data-testid="edge-token"`; annotation `data-testid="annotation-<id>"`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/SceneNode.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { SceneNode } from '../src/canvas/SceneNode';
import type { SceneNodeData } from '../src/canvas/toFlow';

const renderNode = (data: SceneNodeData) =>
  render(
    <ReactFlowProvider>
      <SceneNode {...({ id: data.node.id, data } as unknown as NodeProps)} />
    </ReactFlowProvider>,
  );

const node = { id: 'queue', type: 'queue' as const, label: 'jobs queue', meta: { tech: 'SQS' } };

describe('SceneNode', () => {
  it('renders label, tech and state classes', () => {
    renderNode({ node, state: 'focused', zoomable: false });
    const el = screen.getByTestId('node-queue');
    expect(el).toHaveClass('scene-node', 'scene-node--focused', 'scene-node--type-queue');
    expect(el).toHaveTextContent('jobs queue');
    expect(el).toHaveTextContent('SQS');
  });

  it('shows change, risk, annotation and zoom hints', () => {
    renderNode({
      node: { ...node, meta: { change: 'added', risk: 'bottleneck' } },
      state: 'normal',
      annotation: 'Lock held',
      zoomable: true,
    });
    expect(screen.getByTestId('node-queue')).toHaveClass('scene-node--change-added');
    expect(screen.getByText('bottleneck')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-queue')).toHaveTextContent('Lock held');
    expect(screen.getByText(/double-click for detail/i)).toBeInTheDocument();
  });

  it('renders load metrics and saturation', () => {
    renderNode({
      node,
      state: 'normal',
      zoomable: false,
      load: { arrivalRps: 20, throughputRps: 12, capacityRps: 12, utilization: 1.67, queueDepth: 80, latencyMs: 6686.7, saturated: true, hot: false },
    });
    const el = screen.getByTestId('node-queue');
    expect(el).toHaveClass('scene-node--saturated');
    expect(el).toHaveTextContent('167%');
    expect(el).toHaveTextContent('queue 80');
    expect(el).toHaveTextContent('6.7 s');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- SceneNode`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the node**

`apps/web/src/canvas/SceneNode.tsx`:
```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { SceneNode as SceneNodeModel } from '@rdi/scene';
import type { SceneNodeData } from './toFlow';

const TYPE_GLYPHS: Record<SceneNodeModel['type'], string> = {
  client: '🖥',
  service: '⚙',
  endpoint: '⇄',
  queue: '☰',
  db: '🛢',
  table: '▦',
  cache: '⚡',
  external: '☁',
  function: 'ƒ',
  data: '{}',
};

const MS_PER_SECOND = 1000;

export const formatLatency = (ms: number): string =>
  ms >= MS_PER_SECOND ? `${(ms / MS_PER_SECOND).toFixed(1)} s` : `${Math.round(ms)} ms`;

export const SceneNode = ({ data }: NodeProps) => {
  const { node, state, annotation, load, zoomable } = data as SceneNodeData;
  const classes = [
    'scene-node',
    `scene-node--${state}`,
    `scene-node--type-${node.type}`,
    node.meta.change && `scene-node--change-${node.meta.change}`,
    load?.saturated && 'scene-node--saturated',
    load?.hot && 'scene-node--hot',
  ].filter(Boolean);

  return (
    <div className={classes.join(' ')} data-testid={`node-${node.id}`} title={node.meta.notes}>
      <Handle type="target" position={Position.Left} />
      <div className="scene-node__header">
        <span className="scene-node__glyph">{TYPE_GLYPHS[node.type]}</span>
        <span className="scene-node__label">{node.label}</span>
      </div>
      <div className="scene-node__meta">
        {node.meta.tech && <span>{node.meta.tech}</span>}
        {node.repo && <span className="scene-node__repo">{node.repo}</span>}
        {node.meta.risk && <span className={`badge badge--${node.meta.risk}`}>{node.meta.risk}</span>}
        {node.meta.change && <span className={`badge badge--${node.meta.change}`}>{node.meta.change}</span>}
      </div>
      {load && (
        <div className="scene-node__load">
          <div className="load-bar">
            <div className="load-bar__fill" style={{ width: `${Math.min(load.utilization, 1) * 100}%` }} />
          </div>
          <span>{Math.round(load.utilization * 100)}%</span>
          <span>queue {Math.round(load.queueDepth)}</span>
          <span>{formatLatency(load.latencyMs)}</span>
        </div>
      )}
      {zoomable && <div className="scene-node__zoom">⤢ double-click for detail</div>}
      {annotation && (
        <div className="scene-node__annotation" data-testid={`annotation-${node.id}`}>
          {annotation}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
};
```

- [ ] **Step 4: Implement the edge with a travelling token**

`apps/web/src/canvas/SceneEdge.tsx`:
```tsx
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { SceneEdgeData } from './toFlow';

const ASYNC_KINDS = new Set(['async']);

const pointOnPath = (path: SVGPathElement | null, progress: number) => {
  if (!path || typeof path.getTotalLength !== 'function') return null;
  const length = path.getTotalLength();
  const point = path.getPointAtLength(length * progress);
  return { x: point.x, y: point.y };
};

export const SceneEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) => {
  const edge = data as SceneEdgeData;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const measureRef = useRef<SVGPathElement>(null);
  const [token, setToken] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    setToken(edge.active ? pointOnPath(measureRef.current, edge.progress) : null);
  }, [edge.active, edge.progress, path]);

  const className = [
    'scene-edge',
    `scene-edge--${edge.kind}`,
    edge.active && 'scene-edge--active',
    edge.visited && 'scene-edge--visited',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <BaseEdge id={id} path={path} className={className} style={ASYNC_KINDS.has(edge.kind) ? { strokeDasharray: '6 4' } : undefined} />
      <path ref={measureRef} d={path} fill="none" stroke="none" />
      {token && (
        <g data-testid="edge-token" transform={`translate(${token.x}, ${token.y})`}>
          <circle r={7} className="edge-token" />
          {edge.tokenLabel && (
            <text y={-12} textAnchor="middle" className="edge-token__label">
              {edge.tokenLabel}
            </text>
          )}
        </g>
      )}
      {edge.label && (
        <EdgeLabelRenderer>
          <div className="scene-edge__label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {edge.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
```

- [ ] **Step 5: Layout hook and canvas**

`apps/web/src/canvas/useSceneLayout.ts`:
```ts
import type { Scene } from '@rdi/scene';
import { useEffect, useState } from 'react';
import { layoutScene, type SceneLayout } from './layout';

export const useSceneLayout = (scene: Scene): SceneLayout | null => {
  const [layout, setLayout] = useState<{ sceneId: string; value: SceneLayout } | null>(null);

  useEffect(() => {
    let cancelled = false;
    layoutScene(scene).then((value) => {
      if (!cancelled) setLayout({ sceneId: scene.id, value });
    });
    return () => {
      cancelled = true;
    };
  }, [scene]);

  return layout?.sceneId === scene.id ? layout.value : null;
};
```

`apps/web/src/canvas/Canvas.tsx`:
```tsx
import type { LoadResult, Scene } from '@rdi/scene';
import { Background, Controls, ReactFlow, ReactFlowProvider, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import type { Frame } from '../engine/frame';
import { SceneEdge } from './SceneEdge';
import { SceneNode } from './SceneNode';
import { toFlow } from './toFlow';
import { useSceneLayout } from './useSceneLayout';

const nodeTypes = { scene: SceneNode };
const edgeTypes = { scene: SceneEdge };

type CanvasProps = { scene: Scene; frame: Frame; progress: number; load?: LoadResult; onZoom: (nodeId: string) => void };

export const Canvas = ({ scene, frame, progress, load, onZoom }: CanvasProps) => {
  const layout = useSceneLayout(scene);
  const flow = useMemo(
    () => (layout ? toFlow({ scene, layout, frame, progress, load }) : null),
    [scene, layout, frame, progress, load],
  );
  const handleDoubleClick: NodeMouseHandler = (_event, node) => onZoom(node.id);

  if (!flow) return <div className="canvas canvas--loading">Laying out…</div>;

  return (
    <div className="canvas" data-testid="canvas">
      <ReactFlowProvider>
        <ReactFlow
          key={scene.id}
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeDoubleClick={handleDoubleClick}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
};
```

- [ ] **Step 6: Run tests**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): add canvas node, animated edge and canvas components

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Player controls, narration and payload panels

**Files:**
- Create: `apps/web/src/panels/PlayerControls.tsx`, `apps/web/src/panels/NarrationPanel.tsx`, `apps/web/src/panels/PayloadPanel.tsx`
- Test: `apps/web/test/PlayerControls.test.tsx`, `apps/web/test/NarrationPanel.test.tsx`, `apps/web/test/PayloadPanel.test.tsx`

**Interfaces:**
- Consumes: `PlayerState`, `PlayerAction`, `Scene`, `SceneStep`.
- Produces:
  - `<PlayerControls state stepCount dispatch />` — testids `player-prev`, `player-toggle`, `player-next`, `player-counter`, `player-scrub`, `player-speed`.
  - `<NarrationPanel scene stepIndex onSeek(index) />` — each step `data-testid="narration-step-<i>"`, current has `aria-current="step"`.
  - `<PayloadPanel payload?: SceneStep['payload'] />` — testid `payload-panel`; lines with classes `diff-line--added|removed|same`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/PlayerControls.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { initialPlayerState } from '../src/engine/player';
import { PlayerControls } from '../src/panels/PlayerControls';

describe('PlayerControls', () => {
  it('shows a 1-based counter and dispatches actions', () => {
    const dispatch = vi.fn();
    render(<PlayerControls state={{ ...initialPlayerState, stepIndex: 1 }} stepCount={6} dispatch={dispatch} />);
    expect(screen.getByTestId('player-counter')).toHaveTextContent('2 / 6');
    fireEvent.click(screen.getByTestId('player-toggle'));
    fireEvent.click(screen.getByTestId('player-next'));
    fireEvent.click(screen.getByTestId('player-prev'));
    fireEvent.change(screen.getByTestId('player-scrub'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('player-speed'), { target: { value: '2' } });
    expect(dispatch.mock.calls.map(([a]) => a)).toEqual([
      { type: 'play' },
      { type: 'next' },
      { type: 'prev' },
      { type: 'seek', stepIndex: 4 },
      { type: 'setSpeed', speed: 2 },
    ]);
  });

  it('shows pause while playing', () => {
    render(<PlayerControls state={{ ...initialPlayerState, playing: true }} stepCount={3} dispatch={vi.fn()} />);
    expect(screen.getByTestId('player-toggle')).toHaveAccessibleName('Pause');
  });

  it('is disabled for scenes without steps', () => {
    render(<PlayerControls state={initialPlayerState} stepCount={0} dispatch={vi.fn()} />);
    expect(screen.getByTestId('player-toggle')).toBeDisabled();
    expect(screen.getByTestId('player-next')).toBeDisabled();
    expect(screen.getByTestId('player-scrub')).toBeDisabled();
    expect(screen.getByTestId('player-counter')).toHaveTextContent('No steps');
  });
});
```

`apps/web/test/NarrationPanel.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { sampleSceneRegistry } from '@rdi/scene';
import { NarrationPanel } from '../src/panels/NarrationPanel';

const flow = sampleSceneRegistry['speaker-sync-flow']!;

describe('NarrationPanel', () => {
  it('lists steps, marks the current one and seeks on click', () => {
    const onSeek = vi.fn();
    render(<NarrationPanel scene={flow} stepIndex={2} onSeek={onSeek} />);
    expect(screen.getByRole('heading', { name: flow.title })).toBeInTheDocument();
    expect(screen.getByTestId('narration-step-2')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('narration-step-1')).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByTestId('narration-step-4'));
    expect(onSeek).toHaveBeenCalledWith(4);
  });

  it('explains scenes without steps', () => {
    render(<NarrationPanel scene={sampleSceneRegistry['pr-impact']!} stepIndex={0} onSeek={vi.fn()} />);
    expect(screen.getByText(/no walkthrough/i)).toBeInTheDocument();
  });
});
```

`apps/web/test/PayloadPanel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { PayloadPanel } from '../src/panels/PayloadPanel';

describe('PayloadPanel', () => {
  it('renders nothing without payload', () => {
    const { container } = render(<PayloadPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('diffs before and after line by line', () => {
    render(<PayloadPanel payload={{ format: 'json', before: '{\n  "a": 1\n}', after: '{\n  "a": 2\n}' }} />);
    const panel = screen.getByTestId('payload-panel');
    expect(panel).toHaveTextContent('json');
    expect(panel.querySelector('.diff-line--removed')).toHaveTextContent('"a": 1');
    expect(panel.querySelector('.diff-line--added')).toHaveTextContent('"a": 2');
    expect(panel.querySelectorAll('.diff-line--same')).toHaveLength(2);
  });

  it('shows after-only payloads as added lines', () => {
    render(<PayloadPanel payload={{ format: 'sql', after: 'SELECT 1;' }} />);
    expect(screen.getByTestId('payload-panel').querySelector('.diff-line--added')).toHaveTextContent('SELECT 1;');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- PlayerControls NarrationPanel PayloadPanel`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/panels/PlayerControls.tsx`:
```tsx
import type { Dispatch } from 'react';
import type { PlayerAction, PlayerState } from '../engine/player';

const SPEEDS = [0.5, 1, 2];

type PlayerControlsProps = { state: PlayerState; stepCount: number; dispatch: Dispatch<PlayerAction> };

export const PlayerControls = ({ state, stepCount, dispatch }: PlayerControlsProps) => {
  const disabled = stepCount === 0;
  const toggleLabel = state.playing ? 'Pause' : 'Play';
  return (
    <div className="player">
      <button type="button" data-testid="player-prev" aria-label="Previous step" disabled={disabled} onClick={() => dispatch({ type: 'prev' })}>
        ⏮
      </button>
      <button
        type="button"
        data-testid="player-toggle"
        aria-label={toggleLabel}
        disabled={disabled}
        onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}
      >
        {state.playing ? '⏸' : '▶'}
      </button>
      <button type="button" data-testid="player-next" aria-label="Next step" disabled={disabled} onClick={() => dispatch({ type: 'next' })}>
        ⏭
      </button>
      <input
        type="range"
        data-testid="player-scrub"
        aria-label="Step"
        min={0}
        max={Math.max(stepCount - 1, 0)}
        value={state.stepIndex}
        disabled={disabled}
        onChange={(e) => dispatch({ type: 'seek', stepIndex: Number(e.target.value) })}
      />
      <span data-testid="player-counter" className="player__counter">
        {disabled ? 'No steps' : `${state.stepIndex + 1} / ${stepCount}`}
      </span>
      <select
        data-testid="player-speed"
        aria-label="Speed"
        value={state.speed}
        onChange={(e) => dispatch({ type: 'setSpeed', speed: Number(e.target.value) })}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
};
```

`apps/web/src/panels/NarrationPanel.tsx`:
```tsx
import type { Scene } from '@rdi/scene';

type NarrationPanelProps = { scene: Scene; stepIndex: number; onSeek: (index: number) => void };

export const NarrationPanel = ({ scene, stepIndex, onSeek }: NarrationPanelProps) => (
  <section className="narration">
    <h2>{scene.title}</h2>
    {scene.steps.length === 0 ? (
      <p className="narration__empty">This scene has no walkthrough — explore the canvas directly.</p>
    ) : (
      <ol>
        {scene.steps.map((step, i) => (
          <li key={i}>
            <button
              type="button"
              data-testid={`narration-step-${i}`}
              aria-current={i === stepIndex ? 'step' : undefined}
              className={i === stepIndex ? 'narration__step narration__step--current' : 'narration__step'}
              onClick={() => onSeek(i)}
            >
              {step.narration}
            </button>
          </li>
        ))}
      </ol>
    )}
  </section>
);
```

`apps/web/src/panels/PayloadPanel.tsx`:
```tsx
import type { SceneStep } from '@rdi/scene';
import { diffLines } from 'diff';

type PayloadPanelProps = { payload?: SceneStep['payload'] };

type Line = { text: string; kind: 'added' | 'removed' | 'same' };

const toLines = (before: string, after: string): Line[] =>
  diffLines(before, after).flatMap((part) => {
    const kind: Line['kind'] = part.added ? 'added' : part.removed ? 'removed' : 'same';
    return part.value.replace(/\n$/, '').split('\n').map((text) => ({ text, kind }));
  });

export const PayloadPanel = ({ payload }: PayloadPanelProps) => {
  if (!payload) return null;
  const lines = toLines(payload.before ?? '', payload.after ?? '');
  return (
    <aside className="payload" data-testid="payload-panel">
      <header className="payload__header">
        Example data <span className="payload__format">{payload.format}</span>
      </header>
      <pre className="payload__body">
        {lines.map((line, i) => (
          <div key={i} className={`diff-line diff-line--${line.kind}`}>
            {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
            {line.text}
          </div>
        ))}
      </pre>
    </aside>
  );
};
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add player controls, narration and payload panels

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: App shell — tabs, breadcrumb, playback clock, styles

**Files:**
- Create: `apps/web/src/App.tsx`, `apps/web/src/panels/SceneTabs.tsx`, `apps/web/src/engine/usePlaybackClock.ts`, `apps/web/src/styles.css`
- Modify: `apps/web/src/main.tsx`
- Test: `apps/web/test/SceneTabs.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `<SceneTabs scenes activeId onSelect(id) />` — tab testids `tab-<sceneId>`, `aria-selected`.
  - `<Breadcrumb>` inside App — testid `breadcrumb`, items `crumb-<depth>`.
  - `usePlaybackClock(playing: boolean, onTick: (deltaMs: number) => void): void`.
  - Layout: `.app` grid → left column (narration + payload), right column (tabs, breadcrumb, canvas, player, load panel from Task 10).

- [ ] **Step 1: Write the failing test**

`apps/web/test/SceneTabs.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { sampleScenes } from '@rdi/scene';
import { SceneTabs } from '../src/panels/SceneTabs';

describe('SceneTabs', () => {
  it('renders one tab per scene and selects on click', () => {
    const onSelect = vi.fn();
    render(<SceneTabs scenes={sampleScenes} activeId="speaker-sync-flow" onSelect={onSelect} />);
    expect(screen.getAllByRole('tab')).toHaveLength(sampleScenes.length);
    expect(screen.getByTestId('tab-speaker-sync-flow')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('tab-pr-impact'));
    expect(onSelect).toHaveBeenCalledWith('pr-impact');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- SceneTabs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement tabs, clock and App**

`apps/web/src/panels/SceneTabs.tsx`:
```tsx
import type { Scene } from '@rdi/scene';

type SceneTabsProps = { scenes: Scene[]; activeId: string; onSelect: (id: string) => void };

export const SceneTabs = ({ scenes, activeId, onSelect }: SceneTabsProps) => (
  <div role="tablist" className="tabs">
    {scenes.map((scene) => (
      <button
        key={scene.id}
        role="tab"
        type="button"
        data-testid={`tab-${scene.id}`}
        aria-selected={scene.id === activeId}
        className={scene.id === activeId ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
        onClick={() => onSelect(scene.id)}
      >
        <span className={`tabs__kind tabs__kind--${scene.kind}`}>{scene.kind}</span> {scene.title}
      </button>
    ))}
  </div>
);
```

`apps/web/src/engine/usePlaybackClock.ts`:
```ts
import { useEffect, useRef } from 'react';

export const usePlaybackClock = (playing: boolean, onTick: (deltaMs: number) => void): void => {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    let last = performance.now();
    const loop = (now: number) => {
      onTickRef.current(now - last);
      last = now;
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [playing]);
};
```

`apps/web/src/App.tsx`:
```tsx
import { sampleSceneRegistry, sampleScenes, type Scene } from '@rdi/scene';
import { useCallback, useMemo, useReducer, useState } from 'react';
import { Canvas } from './canvas/Canvas';
import { frameAt } from './engine/frame';
import { currentSceneId, enterZoom, goToDepth, rootNav, type NavState } from './engine/navigation';
import { initialPlayerState, reducePlayer, type PlayerAction, type PlayerState } from './engine/player';
import { usePlaybackClock } from './engine/usePlaybackClock';
import { NarrationPanel } from './panels/NarrationPanel';
import { PayloadPanel } from './panels/PayloadPanel';
import { PlayerControls } from './panels/PlayerControls';
import { SceneTabs } from './panels/SceneTabs';

type Playback = { sceneId: string; player: PlayerState };
type PlaybackAction = PlayerAction & { stepCount: number };

const playbackReducer = (state: Playback, action: PlaybackAction | { type: 'load'; sceneId: string }): Playback => {
  if (action.type === 'load') return { sceneId: action.sceneId, player: reducePlayer(state.player, { type: 'reset' }, 0) };
  const { stepCount, ...playerAction } = action;
  return { ...state, player: reducePlayer(state.player, playerAction as PlayerAction, stepCount) };
};

const DEFAULT_SCENE = sampleScenes[0] as Scene;

export const App = () => {
  const [nav, setNav] = useState<NavState>(rootNav(DEFAULT_SCENE.id));
  const scene = sampleSceneRegistry[currentSceneId(nav)] ?? DEFAULT_SCENE;
  const [playback, dispatchPlayback] = useReducer(playbackReducer, { sceneId: scene.id, player: initialPlayerState });

  if (playback.sceneId !== scene.id) dispatchPlayback({ type: 'load', sceneId: scene.id });
  const player = playback.sceneId === scene.id ? playback.player : initialPlayerState;

  const dispatch = useCallback(
    (action: PlayerAction) => dispatchPlayback({ ...action, stepCount: scene.steps.length }),
    [scene.steps.length],
  );
  usePlaybackClock(player.playing, (deltaMs) => dispatch({ type: 'tick', deltaMs }));

  const frame = useMemo(() => frameAt(scene, player.stepIndex), [scene, player.stepIndex]);

  return (
    <div className="app">
      <aside className="app__left">
        <NarrationPanel scene={scene} stepIndex={frame.stepIndex} onSeek={(stepIndex) => dispatch({ type: 'seek', stepIndex })} />
        <PayloadPanel payload={frame.step?.payload} />
      </aside>
      <main className="app__right">
        <SceneTabs scenes={sampleScenes} activeId={nav.stack[0] as string} onSelect={(id) => setNav(rootNav(id))} />
        <nav className="breadcrumb" data-testid="breadcrumb">
          {nav.stack.map((id, depth) => (
            <button key={id} type="button" data-testid={`crumb-${depth}`} onClick={() => setNav(goToDepth(nav, depth))}>
              {sampleSceneRegistry[id]?.title ?? id}
            </button>
          ))}
        </nav>
        <Canvas
          scene={scene}
          frame={frame}
          progress={player.progress}
          onZoom={(nodeId) => setNav(enterZoom(nav, scene, nodeId, sampleSceneRegistry))}
        />
        <PlayerControls state={player} stepCount={scene.steps.length} dispatch={dispatch} />
      </main>
    </div>
  );
};
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/styles.css`:
```css
:root {
  --bg: #0f1115;
  --panel: #171a21;
  --border: #2a2f3a;
  --text: #e6e8ee;
  --muted: #8b93a7;
  --accent: #6ea8fe;
  --focus: #ffd166;
  --added: #3ecf8e;
  --modified: #f5a524;
  --removed: #f25f5c;
  --danger: #f25f5c;
  --hot: #f5a524;
  font-family: Inter, system-ui, sans-serif;
  color: var(--text);
  background: var(--bg);
}
* { box-sizing: border-box; }
body { margin: 0; }
button { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:disabled { opacity: 0.4; cursor: default; }

.app { display: grid; grid-template-columns: 380px 1fr; height: 100vh; }
.app__left { border-right: 1px solid var(--border); overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.app__right { display: grid; grid-template-rows: auto auto 1fr auto auto; min-width: 0; }

.tabs { display: flex; gap: 6px; padding: 10px; border-bottom: 1px solid var(--border); overflow-x: auto; }
.tabs__tab--active { border-color: var(--accent); }
.tabs__kind { font-size: 11px; text-transform: uppercase; color: var(--muted); }
.breadcrumb { display: flex; gap: 4px; padding: 6px 10px; font-size: 13px; }
.breadcrumb button + button::before { content: '› '; color: var(--muted); }

.canvas { position: relative; min-height: 0; }
.canvas--loading { display: grid; place-items: center; color: var(--muted); }
.scene-group { background: rgba(110, 168, 254, 0.05); border: 1px dashed var(--border); border-radius: 10px; }

.scene-node { width: 200px; min-height: 72px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; transition: opacity 250ms, border-color 250ms, box-shadow 250ms, transform 250ms; }
.scene-node__header { display: flex; gap: 6px; align-items: center; font-weight: 600; font-size: 13px; }
.scene-node__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-node__meta { display: flex; flex-wrap: wrap; gap: 4px; font-size: 11px; color: var(--muted); margin-top: 4px; }
.scene-node__zoom { font-size: 10px; color: var(--accent); margin-top: 4px; }
.scene-node__annotation { position: absolute; top: -34px; left: 0; background: var(--focus); color: #111; font-size: 11px; padding: 3px 8px; border-radius: 6px; white-space: nowrap; }
.scene-node--focused { border-color: var(--focus); box-shadow: 0 0 0 3px rgba(255, 209, 102, 0.3); transform: scale(1.04); }
.scene-node--highlighted { border-color: var(--accent); }
.scene-node--dim { opacity: 0.35; }
.scene-node--change-added { border-color: var(--added); }
.scene-node--change-modified { border-color: var(--modified); }
.scene-node--change-removed { border-color: var(--removed); border-style: dashed; }
.scene-node--hot { border-color: var(--hot); }
.scene-node--saturated { border-color: var(--danger); box-shadow: 0 0 0 3px rgba(242, 95, 92, 0.35); }
.scene-node__load { display: flex; gap: 6px; align-items: center; font-size: 11px; margin-top: 6px; }
.load-bar { flex: 1; height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
.load-bar__fill { height: 100%; background: var(--accent); transition: width 200ms; }
.scene-node--hot .load-bar__fill { background: var(--hot); }
.scene-node--saturated .load-bar__fill { background: var(--danger); }

.badge { padding: 0 6px; border-radius: 8px; border: 1px solid currentColor; }
.badge--bottleneck, .badge--removed { color: var(--danger); }
.badge--spof, .badge--hot, .badge--modified { color: var(--hot); }
.badge--added { color: var(--added); }

.scene-edge { stroke: var(--border); stroke-width: 2; transition: stroke 250ms; }
.scene-edge--visited { stroke: #4b5a78; }
.scene-edge--active { stroke: var(--focus); stroke-width: 3; }
.scene-edge__label { position: absolute; font-size: 10px; color: var(--muted); background: var(--bg); padding: 0 4px; pointer-events: none; }
.edge-token { fill: var(--focus); filter: drop-shadow(0 0 6px var(--focus)); }
.edge-token__label { fill: var(--focus); font-size: 11px; }

.player { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--border); }
.player input[type='range'] { flex: 1; }
.player__counter { min-width: 64px; text-align: center; color: var(--muted); font-size: 13px; }

.narration h2 { font-size: 16px; margin: 0 0 8px; }
.narration ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.narration__step { width: 100%; text-align: left; line-height: 1.4; }
.narration__step--current { border-color: var(--focus); background: rgba(255, 209, 102, 0.08); }
.narration__empty { color: var(--muted); }

.payload { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.payload__header { padding: 6px 10px; font-size: 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; }
.payload__format { color: var(--muted); text-transform: uppercase; }
.payload__body { margin: 0; padding: 8px 10px; font-size: 12px; overflow-x: auto; }
.diff-line--added { color: var(--added); animation: fade-in 400ms ease-out; }
.diff-line--removed { color: var(--removed); text-decoration: line-through; }
.diff-line--same { color: var(--muted); }
@keyframes fade-in { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: none; } }

.load-panel { display: flex; gap: 16px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--border); font-size: 13px; }
.load-panel input[type='range'] { width: 240px; }
.load-panel__estimate { color: var(--muted); font-size: 11px; }
.load-panel__bottlenecks { color: var(--danger); }
```

- [ ] **Step 4: Run tests and smoke-test in the browser**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web && npm run dev -w @rdi/web`
Open http://localhost:5177 — expected: flow scene laid out; ▶ moves the token along edges with narration highlighted; payload panel shows on steps 2, 3, 5, 6; double-click "Sync worker" opens the algorithm scene; breadcrumb returns. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add app shell with tabs, breadcrumb and playback clock

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Load panel (RPS slider + bottlenecks)

**Files:**
- Create: `apps/web/src/panels/LoadPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/test/LoadPanel.test.tsx`

**Interfaces:**
- Consumes: `simulateLoad`, `LoadResult`, `formatLatency` (Task 7), `Scene`.
- Produces: `<LoadPanel scene rps onRpsChange(rps) result />` — testids `load-panel`, `load-rps`, `load-e2e`, `load-bottlenecks`. Slider range `0 … scene.load.rps * 8`, step 1. App keeps `rps` per scene id (defaulting to `scene.load.rps`) and passes `load={result}` to `<Canvas>`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/LoadPanel.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { sampleSceneRegistry, simulateLoad } from '@rdi/scene';
import { LoadPanel } from '../src/panels/LoadPanel';

const scene = sampleSceneRegistry['speaker-sync-load']!;

describe('LoadPanel', () => {
  it('shows rps, end-to-end latency and the estimate disclaimer', () => {
    render(<LoadPanel scene={scene} rps={5} result={simulateLoad(scene, 5)} onRpsChange={vi.fn()} />);
    expect(screen.getByTestId('load-panel')).toHaveTextContent('5 rps');
    expect(screen.getByTestId('load-e2e')).toHaveTextContent(/\d+(\.\d)? (ms|s)/);
    expect(screen.getByText('Estimates — not measured metrics')).toBeInTheDocument();
    expect(screen.getByTestId('load-bottlenecks')).toHaveTextContent('No bottlenecks');
  });

  it('lists bottlenecks by label and reports slider changes', () => {
    const onRpsChange = vi.fn();
    render(<LoadPanel scene={scene} rps={20} result={simulateLoad(scene, 20)} onRpsChange={onRpsChange} />);
    expect(screen.getByTestId('load-bottlenecks')).toHaveTextContent('jobs queue');
    fireEvent.change(screen.getByTestId('load-rps'), { target: { value: '12' } });
    expect(onRpsChange).toHaveBeenCalledWith(12);
    expect(screen.getByTestId('load-rps')).toHaveAttribute('max', String(scene.load!.rps * 8));
  });

  it('never renders NaN or Infinity at rps 0', () => {
    render(<LoadPanel scene={scene} rps={0} result={simulateLoad(scene, 0)} onRpsChange={vi.fn()} />);
    expect(screen.getByTestId('load-panel').textContent).not.toMatch(/NaN|Infinity/);
  });

  it('renders nothing for scenes without load config', () => {
    const flow = sampleSceneRegistry['speaker-sync-flow']!;
    const { container } = render(<LoadPanel scene={flow} rps={0} onRpsChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- LoadPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

`apps/web/src/panels/LoadPanel.tsx`:
```tsx
import type { LoadResult, Scene } from '@rdi/scene';
import { formatLatency } from '../canvas/SceneNode';

const RPS_RANGE_MULTIPLIER = 8;

type LoadPanelProps = { scene: Scene; rps: number; result?: LoadResult; onRpsChange: (rps: number) => void };

export const LoadPanel = ({ scene, rps, result, onRpsChange }: LoadPanelProps) => {
  if (!scene.load || !result) return null;
  const labels = new Map(scene.nodes.map((n) => [n.id, n.label]));
  return (
    <div className="load-panel" data-testid="load-panel">
      <label>
        Traffic{' '}
        <input
          type="range"
          data-testid="load-rps"
          aria-label="Requests per second"
          min={0}
          max={scene.load.rps * RPS_RANGE_MULTIPLIER}
          step={1}
          value={rps}
          onChange={(e) => onRpsChange(Number(e.target.value))}
        />{' '}
        {rps} rps
      </label>
      <span data-testid="load-e2e">End-to-end: {formatLatency(result.endToEndLatencyMs)}</span>
      <span data-testid="load-bottlenecks" className="load-panel__bottlenecks">
        {result.bottlenecks.length === 0 ? 'No bottlenecks' : `Bottlenecks: ${result.bottlenecks.map((id) => labels.get(id) ?? id).join(', ')}`}
      </span>
      <span className="load-panel__estimate">Estimates — not measured metrics</span>
    </div>
  );
};
```

- [ ] **Step 4: Wire into App**

In `apps/web/src/App.tsx` add imports:
```tsx
import { simulateLoad } from '@rdi/scene';
import { LoadPanel } from './panels/LoadPanel';
```
Inside `App`, after `frame`:
```tsx
  const [rpsByScene, setRpsByScene] = useState<Record<string, number>>({});
  const rps = rpsByScene[scene.id] ?? scene.load?.rps ?? 0;
  const load = useMemo(() => (scene.load ? simulateLoad(scene, rps) : undefined), [scene, rps]);
```
Pass `load={load}` to `<Canvas … />` and render after `<PlayerControls … />`:
```tsx
        <LoadPanel scene={scene} rps={rps} result={load} onRpsChange={(value) => setRpsByScene((prev) => ({ ...prev, [scene.id]: value }))} />
```

- [ ] **Step 5: Run tests**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add load panel with rps slider and bottleneck list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: End-to-end canvas tests (Playwright)

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/canvas.spec.ts`

**Interfaces:**
- Consumes: DOM contract from Tasks 7–10.

- [ ] **Step 1: Config**

`apps/web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5177' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5177', reuseExistingServer: true, timeout: 60_000 },
});
```
Run: `npx -w @rdi/web playwright install chromium`

- [ ] **Step 2: Write the E2E tests**

`apps/web/e2e/canvas.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-worker')).toBeVisible();
});

test('steps through the flow with a travelling token and synced narration', async ({ page }) => {
  await page.getByTestId('player-next').click();
  await expect(page.getByTestId('player-counter')).toHaveText('2 / 6');
  await expect(page.getByTestId('node-sync-endpoint')).toHaveClass(/scene-node--focused/);
  await expect(page.getByTestId('narration-step-1')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('edge-token')).toBeVisible();
  await expect(page.getByTestId('payload-panel')).toContainText('integrationId');
});

test('plays automatically to the next step', async ({ page }) => {
  await page.getByTestId('player-speed').selectOption('2');
  await page.getByTestId('player-toggle').click();
  await expect(page.getByTestId('player-counter')).toHaveText('2 / 6', { timeout: 5000 });
});

test('zooms into the worker algorithm and back', async ({ page }) => {
  await page.getByTestId('node-worker').dblclick();
  await expect(page.getByTestId('crumb-1')).toHaveText('Reconciliation algorithm (inside the sync worker)');
  await expect(page.getByTestId('node-diff')).toBeVisible();
  await page.getByTestId('crumb-0').click();
  await expect(page.getByTestId('node-worker')).toBeVisible();
});

test('resets playback when switching scenes mid-playback', async ({ page }) => {
  await page.getByTestId('player-next').click();
  await page.getByTestId('player-next').click();
  await page.getByTestId('tab-speaker-reconcile-algorithm').click();
  await expect(page.getByTestId('player-counter')).toHaveText('1 / 6');
  await expect(page.getByTestId('player-toggle')).toHaveAccessibleName('Play');
});

test('saturates the queue when traffic grows', async ({ page }) => {
  await page.getByTestId('tab-speaker-sync-load').click();
  await expect(page.getByTestId('node-queue')).not.toHaveClass(/scene-node--saturated/);
  await page.getByTestId('load-rps').fill('30');
  await expect(page.getByTestId('node-queue')).toHaveClass(/scene-node--saturated/);
  await expect(page.getByTestId('load-bottlenecks')).toContainText('jobs queue');
  await expect(page.getByTestId('player-counter')).toHaveText('No steps');
});

test('highlights changed nodes in the diff-impact scene', async ({ page }) => {
  await page.getByTestId('tab-pr-impact').click();
  await expect(page.getByTestId('node-speaker-mapper')).toHaveClass(/scene-node--change-added/);
  await expect(page.getByTestId('node-web')).toHaveClass(/scene-node--dim/);
});
```

- [ ] **Step 3: Run the E2E suite**

Run: `npm run e2e -w @rdi/web`
Expected: 6 passed. If a test fails, fix the implementation (not the assertion) unless the assertion contradicts the spec.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(web): add end-to-end canvas tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: API skeleton with infrastructure health

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/config.ts`, `apps/api/src/checks.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Test: `apps/api/test/health.test.ts`, `apps/api/test/health.integration.test.ts`

**Interfaces:**
- Produces (used by plans 2–5):
  ```ts
  type Config = { port: number; databaseUrl: string; neo4jUrl: string; neo4jUser: string; neo4jPassword: string; redisUrl: string };
  loadConfig(env?: NodeJS.ProcessEnv): Config
  type Check = () => Promise<void>;
  type InfraChecks = { checks: Record<string, Check>; close: () => Promise<void> };
  createInfraChecks(config: Config): InfraChecks          // postgres, neo4j, redis
  buildApp(opts: { checks: Record<string, Check>; onClose?: () => Promise<void>; checkTimeoutMs?: number /* default 3000 */ }): FastifyInstance
  // GET /health → 200 { status: 'ok', checks: { name: 'ok' } } | 503 { status: 'degraded', checks: { name: 'ok' | '<error message>' } }
  ```

- [ ] **Step 1: Package setup**

`apps/api/package.json`:
```json
{
  "name": "@rdi/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run test/health.test.ts",
    "test:integration": "vitest run test/health.integration.test.ts",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

Run:
```bash
npm install -w @rdi/api fastify pg neo4j-driver ioredis
npm install -w @rdi/api -D tsx vitest @types/pg @types/node
```

`apps/api/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
```

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', testTimeout: 20_000 } });
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/health.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

describe('GET /health', () => {
  it('returns 200 when every check passes', async () => {
    const app = buildApp({ checks: { postgres: async () => {}, redis: async () => {} } });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
    await app.close();
  });

  it('returns 503 with the failing check message', async () => {
    const app = buildApp({
      checks: {
        postgres: async () => {},
        neo4j: async () => {
          throw new Error('connection refused');
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { postgres: 'ok', neo4j: 'connection refused' } });
    await app.close();
  });

  it('times out slow checks', async () => {
    const app = buildApp({ checks: { slow: () => new Promise(() => {}) }, checkTimeoutMs: 50 });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'degraded', checks: { slow: 'timed out after 50ms' } });
    await app.close();
  });
});

describe('loadConfig', () => {
  it('defaults to local ports', () => {
    expect(loadConfig({})).toEqual({
      port: 4040,
      databaseUrl: 'postgres://rdi:rdi@localhost:5548/rdi',
      neo4jUrl: 'bolt://localhost:7690',
      neo4jUser: 'neo4j',
      neo4jPassword: 'rdi-dev-password',
      redisUrl: 'redis://localhost:6391',
    });
  });

  it('reads overrides from env', () => {
    expect(loadConfig({ API_PORT: '5000', REDIS_URL: 'redis://x:1' })).toMatchObject({ port: 5000, redisUrl: 'redis://x:1' });
  });
});
```

`apps/api/test/health.integration.test.ts`:
```ts
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createInfraChecks } from '../src/checks';
import { loadConfig } from '../src/config';

const infra = createInfraChecks(loadConfig());
const app = buildApp({ checks: infra.checks, onClose: infra.close });

afterAll(() => app.close());

describe('GET /health against docker infra (run `npm run infra:up` first)', () => {
  it('reports postgres, neo4j and redis healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', neo4j: 'ok', redis: 'ok' } });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @rdi/api`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`apps/api/src/config.ts`:
```ts
export type Config = {
  port: number;
  databaseUrl: string;
  neo4jUrl: string;
  neo4jUser: string;
  neo4jPassword: string;
  redisUrl: string;
};

const DEFAULTS = {
  API_PORT: '4040',
  DATABASE_URL: 'postgres://rdi:rdi@localhost:5548/rdi',
  NEO4J_URL: 'bolt://localhost:7690',
  NEO4J_USER: 'neo4j',
  NEO4J_PASSWORD: 'rdi-dev-password',
  REDIS_URL: 'redis://localhost:6391',
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const read = (key: keyof typeof DEFAULTS) => env[key] ?? DEFAULTS[key];
  return {
    port: Number(read('API_PORT')),
    databaseUrl: read('DATABASE_URL'),
    neo4jUrl: read('NEO4J_URL'),
    neo4jUser: read('NEO4J_USER'),
    neo4jPassword: read('NEO4J_PASSWORD'),
    redisUrl: read('REDIS_URL'),
  };
};
```

`apps/api/src/checks.ts`:
```ts
import { Redis } from 'ioredis';
import neo4j from 'neo4j-driver';
import pg from 'pg';
import type { Config } from './config';

export type Check = () => Promise<void>;
export type InfraChecks = { checks: Record<string, Check>; close: () => Promise<void> };

export const createInfraChecks = (config: Config): InfraChecks => {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  const driver = neo4j.driver(config.neo4jUrl, neo4j.auth.basic(config.neo4jUser, config.neo4jPassword));
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

  return {
    checks: {
      postgres: async () => {
        await pool.query('SELECT 1');
      },
      neo4j: async () => {
        await driver.verifyConnectivity();
      },
      redis: async () => {
        if (redis.status === 'wait') await redis.connect();
        await redis.ping();
      },
    },
    close: async () => {
      await Promise.allSettled([pool.end(), driver.close(), redis.quit()]);
    },
  };
};
```

`apps/api/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { Check } from './checks';

const DEFAULT_CHECK_TIMEOUT_MS = 3000;
const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;

type BuildAppOptions = { checks: Record<string, Check>; onClose?: () => Promise<void>; checkTimeoutMs?: number };

const withTimeout = (check: Check, ms: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    check().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export const buildApp = ({ checks, onClose, checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS }: BuildAppOptions): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.get('/health', async (_request, reply) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check, checkTimeoutMs);
          return [name, 'ok'] as const;
        } catch (error) {
          return [name, error instanceof Error ? error.message : String(error)] as const;
        }
      }),
    );
    const allOk = entries.every(([, result]) => result === 'ok');
    return reply
      .code(allOk ? HTTP_OK : HTTP_UNAVAILABLE)
      .send({ status: allOk ? 'ok' : 'degraded', checks: Object.fromEntries(entries) });
  });

  if (onClose) app.addHook('onClose', onClose);
  return app;
};
```

`apps/api/src/server.ts`:
```ts
import { buildApp } from './app';
import { createInfraChecks } from './checks';
import { loadConfig } from './config';

const config = loadConfig();
const infra = createInfraChecks(config);
const app = buildApp({ checks: infra.checks, onClose: infra.close });

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`api listening on http://localhost:${config.port}`);
```

- [ ] **Step 5: Run unit + integration tests**

Run:
```bash
npm test -w @rdi/api
npm run infra:up && npm run test:integration -w @rdi/api
npm run typecheck -w @rdi/api
```
Expected: unit PASS; integration PASS with all three `ok`.

- [ ] **Step 6: Full-repo verification**

Run: `npm test && npm run typecheck && npm run e2e -w @rdi/web`
Then `npm run dev` and check `curl -s localhost:4040/health` → `{"status":"ok",...}` and http://localhost:5177 renders the canvas.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): add api skeleton with infrastructure health endpoint

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage (plan 1 scope)

| Spec item | Task |
|---|---|
| Turbo monorepo, apps/web, apps/api, packages/scene, infra (Postgres, Neo4j 5, Redis) | 1, 5, 12 |
| Scene schema verbatim + Zod validation; errors fed back to agent | 2 |
| Load simulation pure TS in `packages/scene`, estimates labeled | 3, 10 |
| Flow mode: travelling token, focus, synced narration, ▶ ⏸ ⏭ ⏮ speed scrub | 5, 7, 8, 9 |
| Example data: before → after animated diff | 8 |
| Algorithm zoom via double-click + breadcrumb | 4, 5, 9 |
| Load mode: RPS slider, saturated red, queues grow | 3, 7, 10 |
| Diff impact: added/modified/removed + dimmed blast radius | 4, 6, 7 |
| React Flow + ELK layout by groups | 6, 7 |
| `graphRef` click → "ask about this" | Deferred to plan 3 (needs chat) |
| `packages/graph`, indexing, agent, Solutions, MCP | Plans 2–5 |
