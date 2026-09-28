# Plan 2 — Exploration Experience v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plan-1 canvas with the v2 exploration workspace: generic Scene v2 (roles, hierarchy, scale, risks, code, language), four levels (System → Architecture → Components → Detail), a VS Code-style explorer, a sequential animated walkthrough with expandable sub-steps, an inspector with "at scale" rows and risks, an optional code drawer, four workspace themes and UI i18n (en/es/pt) — front-only on generic sample scenes.

**Architecture:** `packages/scene` gets a v2 module (schema, validation, hierarchy/visibility, walkthrough flattening, samples) built beside v1 under the `@rdi/scene/v2` subpath so every task stays green; `apps/web` gets a new `src/workspace` tree (engine, canvas, panels) plus `src/i18n` and `src/theme`, assembled in `Workspace.tsx`. The final two tasks switch the app to the workspace, delete the v1 web code and promote v2 to the package root.

**Tech Stack:** unchanged from plan 1 — TypeScript ~5.9, Zod 4, React 19, @xyflow/react 12, elkjs 0.12, diff 9, Vitest 5 + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-scene-v2-progressive-disclosure-design.md` (read it first). The app-shell spec (`2026-09-28-app-shell-design.md`) is a later plan; this plan only borrows its i18n rules (§6) and theme precedence.

## Global Constraints

- Code, comments, identifiers, commit messages in **English**. Every user-visible UI string goes through `t()` from `src/i18n` (catalogs `en`, `es`, `pt`; missing keys fall back to `en`). Scene prose is displayed as-is (it is already in `scene.language`).
- Workspace style: **Mission control** default; themes `mission | studio | paper | contrast` switch CSS custom properties only (`--bg --panel --grid --line --text --muted --accent --token --ok --strained --limit --saturated --font --radius`).
- Levels verbatim: `system | architecture | components | detail`. Roles verbatim: `actor | compute | storage | channel | external | logic | data`. Scale statuses: `ok | strained | limit | saturated`. Strategies: `horizontal | vertical | none | external | n/a`. Risk categories: `performance | security | complexity | reliability`. Severities: `low | medium | high | critical`.
- Code is **never** shown unless the user presses "View code".
- The canvas never simulates volume; scale information lives in the component card.
- Edges are straight SVG lines that start and end exactly on piece borders (floating-edge geometry), arrowheads on the target.
- Every animation respects `prefers-reduced-motion: reduce`.
- Local ports unchanged (web 5177). Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- npm quirk: the first `npm install -w <pkg>` into a brand-new workspace can drop deps — check `package.json` after installing.

## Review Focus

1. **Opening/closing a step while playing** — the cursor stays on the same step if it is still in the sequence, otherwise moves to its nearest open ancestor step; never an out-of-range index. Pinned in Task 7 (`resequenceCursor` tests).
2. **Selecting a risk whose pieces are hidden** (internal pieces, or any piece at System level) — ancestors expand and the level leaves `system`, so the pieces become visible and highlighted. Pinned in Task 7 (reducer test) and Task 14 (E2E).
3. **Scenes without steps, risks, scale or changes** — the corresponding mode tabs / overlay toggle are hidden and player controls are disabled with "No steps". Pinned in Task 13 (TopBar and Footer tests).
4. **A travel edge that collapses inside one visible piece** (internal edge at a higher level) — no self-loop is drawn, no token appears, the focused piece still lights up. Pinned in Task 2 (projection) and Task 8 (frame test).
5. **Language tags with regions** (`pt-BR` scene vs `pt` UI) — regenerate prompt compares the primary subtag only; a key missing in `pt` falls back to `en`. Pinned in Task 5 (i18n test) and Task 13 (TopBar test).

---

## File Structure

```
packages/scene/
  package.json                      + "./v2" export (removed again in Task 15)
  src/v2/schema.ts                  Scene v2 Zod schema + types
  src/v2/validate.ts                referential validation (recursive steps)
  src/v2/hierarchy.ts               index, levels → visible model, representative, edge projection, top-level groups
  src/v2/walkthrough.ts             step numbering, flattening over open steps, lookups
  src/v2/samples/{define,checkout,iot-telemetry,index}.ts
  src/v2/index.ts
  test/v2/*.test.ts
apps/web/src/
  i18n/messages.ts                  catalogs + translate()
  i18n/I18nProvider.tsx             context, useT(), persisted language
  theme/themes.ts                   tokens, resolveTheme, applyTheme
  workspace/workspace.css           all workspace styles (token-based)
  workspace/engine/explorerState.ts reducer: level, local expansion, open steps, selection, mode, risk, code, overlay
  workspace/engine/resequence.ts    cursor mapping when the step sequence changes
  workspace/engine/frame.ts         frameAt(): projected focus/edge/annotations for the current step
  workspace/engine/phase.ts         stepPhase(): token progress vs activation
  workspace/engine/risks.ts         risksByNode, severity/scale ranking and aggregation
  workspace/canvas/floating.ts      border-intersection geometry
  workspace/canvas/layout.ts        hierarchical ELK layout for the visible model
  workspace/canvas/glyphs.ts        role → glyph
  workspace/canvas/toFlow.ts        model + layout + frame → React Flow nodes/edges
  workspace/canvas/PieceNode.tsx, ContainerNode.tsx, GroupBox.tsx, FlowEdge.tsx, Callout.tsx
  workspace/canvas/useSceneLayout.ts, Canvas.tsx
  workspace/panels/explorerTree.ts  buildExplorerTree()
  workspace/panels/ExplorerPanel.tsx, WalkthroughTree.tsx, RisksPanel.tsx, PayloadDiff.tsx
  workspace/panels/Inspector.tsx, ComponentCard.tsx, CodeDrawer.tsx
  workspace/panels/TopBar.tsx, Footer.tsx, Logo.tsx
  workspace/Workspace.tsx
apps/web/test/workspace/*.test.ts(x), apps/web/test/i18n.test.ts, apps/web/test/theme.test.ts
apps/web/e2e/workspace.spec.ts
```

Deleted in Task 14 (web v1): `src/App.tsx`, `src/styles.css`, `src/canvas/*`, `src/engine/frame.ts`, `src/engine/navigation.ts`, `src/panels/*` except `PlayerControls.tsx` (moved), their tests, `e2e/canvas.spec.ts`. Kept: `src/engine/player.ts`, `src/engine/usePlaybackClock.ts`.

---

### Task 1: Scene v2 schema and validation

**Files:**
- Modify: `packages/scene/package.json` (exports)
- Create: `packages/scene/src/v2/schema.ts`, `packages/scene/src/v2/validate.ts`, `packages/scene/src/v2/index.ts`
- Test: `packages/scene/test/v2/validate.test.ts`

**Interfaces:**
- Produces (`@rdi/scene/v2`): constants `ROLES, EDGE_KINDS, SCALE_STATUSES, SCALE_STRATEGIES, RISK_CATEGORIES, SEVERITIES, CHANGES, PAYLOAD_FORMATS`; types `Role, EdgeKind, ScaleStatus, ScaleStrategy, RiskCategory, Severity, Change, Payload, Step, StepInput, Scene, SceneInput, SceneNode, SceneEdge, SceneGroup, SceneRisk, ScaleRow`; `sceneSchema`; `validateScene(input: unknown): ValidationResult` with `type ValidationResult = { ok: true; scene: Scene } | { ok: false; errors: string[] }`.

- [ ] **Step 1: Subpath export**

In `packages/scene/package.json` replace the `exports` block with:
```json
  "exports": {
    ".": "./src/index.ts",
    "./v2": "./src/v2/index.ts"
  },
```

- [ ] **Step 2: Write the failing tests**

`packages/scene/test/v2/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validateScene } from '../../src/v2/index';

const base = () => ({
  id: 'mini',
  title: 'Mini',
  language: 'en',
  nodes: [
    { id: 'client', label: 'Client', role: 'actor', kind: 'browser', summary: 'The user.' },
    { id: 'api', label: 'API', role: 'compute', kind: 'REST', summary: 'Handles requests.', repo: 'svc' },
    { id: 'worker', label: 'Worker', role: 'compute', kind: 'job runner', summary: 'Processes jobs.', repo: 'svc' },
    { id: 'algo', label: 'algo()', role: 'logic', kind: 'function', summary: 'Core logic.', parent: 'worker', complexity: { time: 'O(n)' } },
  ],
  edges: [
    { id: 'e1', from: 'client', to: 'api', kind: 'sync' },
    { id: 'e2', from: 'api', to: 'algo', kind: 'async' },
  ],
  steps: [
    { id: 's1', narration: 'Client calls API', focus: ['api'], travel: { edgeId: 'e1' } },
    { id: 's2', narration: 'Worker runs', focus: ['worker'], expand: 'worker', substeps: [{ id: 's2-1', narration: 'algo runs', focus: ['algo'], travel: { edgeId: 'e2' } }] },
  ],
  risks: [{ id: 'r1', category: 'performance', severity: 'high', title: 'Slow', explanation: 'It is slow.', nodeIds: ['algo'] }],
});

const errorsOf = (input: unknown) => {
  const result = validateScene(input);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
};

describe('validateScene v2', () => {
  it('accepts a valid scene and applies defaults', () => {
    const result = validateScene(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.groups).toEqual([]);
    expect(result.scene.steps[0]?.highlight).toEqual([]);
    expect(result.scene.steps[0]?.travel?.reverse).toBe(false);
    expect(result.scene.steps[1]?.substeps[0]?.substeps).toEqual([]);
  });

  it('rejects unknown roles and bad language tags with dotted paths', () => {
    const scene = { ...base(), language: 'Spanish' };
    (scene.nodes[0] as { role: string }).role = 'robot';
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^language: /), expect.stringMatching(/^nodes\.0\.role: /)]),
    );
  });

  it('rejects duplicate ids across every kind, including nested steps', () => {
    const scene = base();
    scene.nodes.push({ id: 'api', label: 'Dup', role: 'data', kind: 'x', summary: 'x' } as never);
    scene.edges.push({ id: 'e1', from: 'api', to: 'client', kind: 'sync' });
    scene.steps[1]!.substeps!.push({ id: 's1', narration: 'dup', focus: [] } as never);
    scene.risks.push({ ...scene.risks[0]! });
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'nodes.4.id: duplicate node id "api"',
        'edges.2.id: duplicate edge id "e1"',
        'steps.1.substeps.1.id: duplicate step id "s1"',
        'risks.1.id: duplicate risk id "r1"',
      ]),
    );
  });

  it('rejects unknown parents and parent cycles', () => {
    const scene = base();
    scene.nodes[1] = { ...scene.nodes[1]!, parent: 'ghost' } as never;
    scene.nodes[2] = { ...scene.nodes[2]!, parent: 'algo' } as never;
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['nodes.1.parent: unknown node "ghost"', 'nodes.2.parent: parent cycle through "worker"']),
    );
  });

  it('rejects complexity on non-logic nodes and inverted code ranges', () => {
    const scene = base();
    scene.nodes[1] = { ...scene.nodes[1]!, complexity: { time: 'O(1)' }, code: { repo: 'svc', path: 'a.ts', startLine: 9, endLine: 3, language: 'ts' } } as never;
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'nodes.1.complexity: only "logic" nodes can declare complexity',
        'nodes.1.code.endLine: must be >= startLine',
      ]),
    );
  });

  it('rejects dangling references in edges, groups, steps and risks', () => {
    const scene = {
      ...base(),
      edges: [{ id: 'e1', from: 'client', to: 'ghost', kind: 'sync' }],
      groups: [{ id: 'g', label: 'G', nodeIds: ['nobody', 'algo'] }],
      steps: [{ id: 's1', narration: 'x', focus: ['ghost'], highlight: ['ghost2'], travel: { edgeId: 'nope' }, annotate: [{ nodeId: 'ghost3', text: 't' }] }],
      risks: [{ id: 'r1', category: 'security', severity: 'low', title: 't', explanation: 'e', nodeIds: ['ghost4'] }],
    };
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'edges.0.to: unknown node "ghost"',
        'groups.0.nodeIds.0: unknown node "nobody"',
        'groups.0.nodeIds.1: node "algo" is an internal piece; only top-level nodes can be grouped',
        'steps.0.focus.0: unknown node "ghost"',
        'steps.0.highlight.0: unknown node "ghost2"',
        'steps.0.travel.edgeId: unknown edge "nope"',
        'steps.0.annotate.0.nodeId: unknown node "ghost3"',
        'risks.0.nodeIds.0: unknown node "ghost4"',
      ]),
    );
  });

  it('rejects group ids that collide with node ids and nodes in two groups', () => {
    const scene = { ...base(), groups: [{ id: 'api', label: 'A', nodeIds: ['client'] }, { id: 'g2', label: 'B', nodeIds: ['client'] }] };
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining([
        'groups.0.id: id "api" is already used by a node',
        'groups.1.nodeIds.0: node "client" already belongs to group "api"',
      ]),
    );
  });

  it('requires expand on steps with substeps and children on the expanded node', () => {
    const scene = base();
    scene.steps[0] = { ...scene.steps[0]!, substeps: [{ id: 's1-1', narration: 'x', focus: [] }] } as never;
    scene.steps[1] = { ...scene.steps[1]!, expand: 'api' } as never;
    expect(errorsOf(scene)).toEqual(
      expect.arrayContaining(['steps.0.substeps: sub-steps require "expand"', 'steps.1.expand: node "api" has no internal pieces']),
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @rdi/scene -- v2`
Expected: FAIL — `Cannot find module '../../src/v2/index'`.

- [ ] **Step 4: Implement the schema**

`packages/scene/src/v2/schema.ts`:
```ts
import { z } from 'zod';

export const ROLES = ['actor', 'compute', 'storage', 'channel', 'external', 'logic', 'data'] as const;
export const EDGE_KINDS = ['sync', 'async', 'read', 'write', 'calls'] as const;
export const SCALE_STATUSES = ['ok', 'strained', 'limit', 'saturated'] as const;
export const SCALE_STRATEGIES = ['horizontal', 'vertical', 'none', 'external', 'n/a'] as const;
export const RISK_CATEGORIES = ['performance', 'security', 'complexity', 'reliability'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const CHANGES = ['added', 'modified', 'removed'] as const;
export const PAYLOAD_FORMATS = ['json', 'sql', 'text'] as const;

export type Role = (typeof ROLES)[number];
export type EdgeKind = (typeof EDGE_KINDS)[number];
export type ScaleStatus = (typeof SCALE_STATUSES)[number];
export type ScaleStrategy = (typeof SCALE_STRATEGIES)[number];
export type RiskCategory = (typeof RISK_CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Change = (typeof CHANGES)[number];

const MAX_LABEL = 120;
const MAX_TEXT = 2000;
const MAX_PAYLOAD = 20_000;
const MAX_CODE = 20_000;
const MAX_PATH = 500;
const MAX_LANGUAGE = 40;
const MAX_NODES = 150;
const MAX_STEPS = 80;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const idSchema = z.string().min(1).max(MAX_LABEL);
const labelSchema = z.string().min(1).max(MAX_LABEL);
const textSchema = z.string().min(1).max(MAX_TEXT);

const scaleRowSchema = z.object({ status: z.enum(SCALE_STATUSES), note: textSchema });

const nodeSchema = z.object({
  id: idSchema,
  label: labelSchema,
  role: z.enum(ROLES),
  kind: labelSchema,
  summary: textSchema,
  details: textSchema.optional(),
  parent: idSchema.optional(),
  repo: labelSchema.optional(),
  complexity: z.object({ time: labelSchema, space: labelSchema.optional(), note: textSchema.optional() }).optional(),
  scale: z
    .object({
      low: scaleRowSchema,
      medium: scaleRowSchema,
      high: scaleRowSchema,
      strategy: z.enum(SCALE_STRATEGIES),
      advice: textSchema.optional(),
    })
    .optional(),
  code: z
    .object({
      repo: labelSchema,
      path: z.string().min(1).max(MAX_PATH),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      language: z.string().min(1).max(MAX_LANGUAGE),
      snippet: z.string().max(MAX_CODE).optional(),
    })
    .optional(),
  change: z.enum(CHANGES).optional(),
  graphRef: z.string().max(MAX_TEXT).optional(),
});

const edgeSchema = z.object({ id: idSchema, from: idSchema, to: idSchema, kind: z.enum(EDGE_KINDS), label: z.string().max(MAX_LABEL).optional() });

const groupSchema = z.object({ id: idSchema, label: labelSchema, nodeIds: z.array(idSchema).min(1) });

const payloadSchema = z
  .object({
    format: z.enum(PAYLOAD_FORMATS),
    before: z.string().max(MAX_PAYLOAD).optional(),
    after: z.string().max(MAX_PAYLOAD).optional(),
  })
  .refine((p) => p.before !== undefined || p.after !== undefined, { message: 'payload needs before or after' });

export type Payload = z.infer<typeof payloadSchema>;

export interface Step {
  id: string;
  narration: string;
  focus: string[];
  travel?: { edgeId: string; reverse: boolean; payload?: string };
  highlight: string[];
  annotate: { nodeId: string; text: string }[];
  payload?: Payload;
  expand?: string;
  substeps: Step[];
}

export interface StepInput {
  id: string;
  narration: string;
  focus?: string[];
  travel?: { edgeId: string; reverse?: boolean; payload?: string };
  highlight?: string[];
  annotate?: { nodeId: string; text: string }[];
  payload?: Payload;
  expand?: string;
  substeps?: StepInput[];
}

const stepSchema: z.ZodType<Step, StepInput> = z.lazy(() =>
  z.object({
    id: idSchema,
    narration: textSchema,
    focus: z.array(idSchema).default([]),
    travel: z.object({ edgeId: idSchema, reverse: z.boolean().default(false), payload: z.string().max(MAX_LABEL).optional() }).optional(),
    highlight: z.array(idSchema).default([]),
    annotate: z.array(z.object({ nodeId: idSchema, text: textSchema })).default([]),
    payload: payloadSchema.optional(),
    expand: idSchema.optional(),
    substeps: z.array(stepSchema).default([]),
  }),
);

const riskSchema = z.object({
  id: idSchema,
  category: z.enum(RISK_CATEGORIES),
  severity: z.enum(SEVERITIES),
  title: labelSchema,
  explanation: textSchema,
  nodeIds: z.array(idSchema).min(1),
  mitigation: textSchema.optional(),
});

export const sceneSchema = z.object({
  id: idSchema,
  title: labelSchema,
  summary: textSchema.optional(),
  language: z.string().regex(LANGUAGE_TAG, 'must be a BCP-47 language tag like "es" or "pt-BR"'),
  nodes: z.array(nodeSchema).min(1).max(MAX_NODES),
  edges: z.array(edgeSchema).default([]),
  groups: z.array(groupSchema).default([]),
  steps: z.array(stepSchema).max(MAX_STEPS).default([]),
  risks: z.array(riskSchema).default([]),
});

export type Scene = z.infer<typeof sceneSchema>;
export type SceneInput = z.input<typeof sceneSchema>;
export type SceneNode = Scene['nodes'][number];
export type SceneEdge = Scene['edges'][number];
export type SceneGroup = Scene['groups'][number];
export type SceneRisk = Scene['risks'][number];
export type ScaleRow = z.infer<typeof scaleRowSchema>;
```

- [ ] **Step 5: Implement validation**

`packages/scene/src/v2/validate.ts`:
```ts
import { sceneSchema, type Scene, type Step } from './schema';

export type ValidationResult = { ok: true; scene: Scene } | { ok: false; errors: string[] };

const collectDuplicates = (items: { id: string }[], label: string, path: string, errors: string[]) => {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) errors.push(`${path}.${i}.id: duplicate ${label} id "${item.id}"`);
    seen.add(item.id);
  });
  return seen;
};

const checkNodes = (scene: Scene, nodeIds: Set<string>, errors: string[]) => {
  const parentOf = new Map(scene.nodes.map((n) => [n.id, n.parent]));
  scene.nodes.forEach((node, i) => {
    if (node.parent && !nodeIds.has(node.parent)) errors.push(`nodes.${i}.parent: unknown node "${node.parent}"`);
    if (node.parent && nodeIds.has(node.parent)) {
      const seen = new Set<string>([node.id]);
      let cursor: string | undefined = node.parent;
      while (cursor) {
        if (seen.has(cursor)) {
          errors.push(`nodes.${i}.parent: parent cycle through "${node.id}"`);
          break;
        }
        seen.add(cursor);
        cursor = parentOf.get(cursor);
      }
    }
    if (node.complexity && node.role !== 'logic') errors.push(`nodes.${i}.complexity: only "logic" nodes can declare complexity`);
    if (node.code && node.code.endLine < node.code.startLine) errors.push(`nodes.${i}.code.endLine: must be >= startLine`);
  });
};

const checkGroups = (scene: Scene, nodeIds: Set<string>, errors: string[]) => {
  collectDuplicates(scene.groups, 'group', 'groups', errors);
  const parentOf = new Map(scene.nodes.map((n) => [n.id, n.parent]));
  const owner = new Map<string, string>();
  scene.groups.forEach((group, g) => {
    if (nodeIds.has(group.id)) errors.push(`groups.${g}.id: id "${group.id}" is already used by a node`);
    group.nodeIds.forEach((id, i) => {
      if (!nodeIds.has(id)) {
        errors.push(`groups.${g}.nodeIds.${i}: unknown node "${id}"`);
        return;
      }
      if (parentOf.get(id)) {
        errors.push(`groups.${g}.nodeIds.${i}: node "${id}" is an internal piece; only top-level nodes can be grouped`);
        return;
      }
      const previous = owner.get(id);
      if (previous) {
        errors.push(`groups.${g}.nodeIds.${i}: node "${id}" already belongs to group "${previous}"`);
        return;
      }
      owner.set(id, group.id);
    });
  });
};

const checkSteps = (
  steps: Step[],
  path: string,
  ctx: { nodeIds: Set<string>; edgeIds: Set<string>; hasChildren: Set<string>; stepIds: Set<string> },
  errors: string[],
) =>
  steps.forEach((step, s) => {
    const here = `${path}.${s}`;
    if (ctx.stepIds.has(step.id)) errors.push(`${here}.id: duplicate step id "${step.id}"`);
    ctx.stepIds.add(step.id);
    const checkIds = (ids: string[], field: string) =>
      ids.forEach((id, i) => {
        if (!ctx.nodeIds.has(id)) errors.push(`${here}.${field}.${i}: unknown node "${id}"`);
      });
    checkIds(step.focus, 'focus');
    checkIds(step.highlight, 'highlight');
    step.annotate.forEach((a, i) => {
      if (!ctx.nodeIds.has(a.nodeId)) errors.push(`${here}.annotate.${i}.nodeId: unknown node "${a.nodeId}"`);
    });
    if (step.travel && !ctx.edgeIds.has(step.travel.edgeId)) errors.push(`${here}.travel.edgeId: unknown edge "${step.travel.edgeId}"`);
    if (step.expand) {
      if (!ctx.nodeIds.has(step.expand)) errors.push(`${here}.expand: unknown node "${step.expand}"`);
      else if (!ctx.hasChildren.has(step.expand)) errors.push(`${here}.expand: node "${step.expand}" has no internal pieces`);
    }
    if (step.substeps.length > 0 && !step.expand) errors.push(`${here}.substeps: sub-steps require "expand"`);
    checkSteps(step.substeps, `${here}.substeps`, ctx, errors);
  });

const checkReferences = (scene: Scene): string[] => {
  const errors: string[] = [];
  const nodeIds = collectDuplicates(scene.nodes, 'node', 'nodes', errors);
  const edgeIds = collectDuplicates(scene.edges, 'edge', 'edges', errors);
  collectDuplicates(scene.risks, 'risk', 'risks', errors);
  checkNodes(scene, nodeIds, errors);

  scene.edges.forEach((edge, i) => {
    if (!nodeIds.has(edge.from)) errors.push(`edges.${i}.from: unknown node "${edge.from}"`);
    if (!nodeIds.has(edge.to)) errors.push(`edges.${i}.to: unknown node "${edge.to}"`);
  });

  checkGroups(scene, nodeIds, errors);

  const hasChildren = new Set(scene.nodes.flatMap((n) => (n.parent ? [n.parent] : [])));
  checkSteps(scene.steps, 'steps', { nodeIds, edgeIds, hasChildren, stepIds: new Set() }, errors);

  scene.risks.forEach((risk, r) =>
    risk.nodeIds.forEach((id, i) => {
      if (!nodeIds.has(id)) errors.push(`risks.${r}.nodeIds.${i}: unknown node "${id}"`);
    }),
  );
  return errors;
};

export const validateScene = (input: unknown): ValidationResult => {
  const parsed = sceneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`) };
  }
  const errors = checkReferences(parsed.data);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scene: parsed.data };
};
```

`packages/scene/src/v2/index.ts`:
```ts
export * from './schema';
export * from './validate';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w @rdi/scene && npm run typecheck -w @rdi/scene`
Expected: PASS (v1 tests untouched and still green).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scene): add scene v2 schema and validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Hierarchy, levels and edge projection

**Files:**
- Create: `packages/scene/src/v2/hierarchy.ts`
- Modify: `packages/scene/src/v2/index.ts`
- Test: `packages/scene/test/v2/hierarchy.test.ts`, `packages/scene/test/v2/fixture.ts`

**Interfaces:**
- Consumes: `Scene`, `SceneNode`, `EdgeKind` (Task 1).
- Produces:
  ```ts
  LEVELS: readonly ['system','architecture','components','detail']; type Level
  repoBoxId(repo: string): string                      // `repo:<repo>`
  type SceneIndex = { byId: Map<string, SceneNode>; children: Map<string, string[]>; depth: Map<string, number>; topLevel: string[] }
  indexScene(scene: Scene): SceneIndex
  ancestorsOf(index: SceneIndex, id: string): string[]  // nearest first
  descendantsOf(index: SceneIndex, id: string): string[]
  type VisibleModel = { level: Level; expanded: Set<string>; visible: Set<string>; repoBoxes: Map<string, string[]>; representative: Map<string, string> }
  computeVisible(scene: Scene, index: SceneIndex, level: Level, localExpanded: ReadonlySet<string>): VisibleModel
  type ProjectedEdge = { key: string; from: string; to: string; kind: EdgeKind; label?: string; edgeIds: string[] }
  type ProjectedEdges = { edges: ProjectedEdge[]; keyOf: Map<string, string> }   // hidden edges absent from keyOf
  projectEdges(scene: Scene, model: VisibleModel): ProjectedEdges
  type TopGroup = { id: string; label: string; nodeIds: string[] }
  topLevelGroups(scene: Scene, visibleTop: string[]): TopGroup[]   // explicit groups, else by repo (`group:<repo>`)
  ```

- [ ] **Step 1: Shared fixture**

`packages/scene/test/v2/fixture.ts`:
```ts
import { validateScene, type Scene } from '../../src/v2/index';

export const fixtureScene = (): Scene => {
  const result = validateScene({
    id: 'fx',
    title: 'Fixture',
    language: 'en',
    nodes: [
      { id: 'client', label: 'Client', role: 'actor', kind: 'browser', summary: 's', repo: 'web' },
      { id: 'api', label: 'API', role: 'compute', kind: 'REST', summary: 's', repo: 'svc' },
      { id: 'worker', label: 'Worker', role: 'compute', kind: 'jobs', summary: 's', repo: 'svc' },
      { id: 'reserve', label: 'reserve()', role: 'logic', kind: 'fn', summary: 's', parent: 'worker' },
      { id: 'lock', label: 'lock()', role: 'logic', kind: 'fn', summary: 's', parent: 'reserve' },
      { id: 'db', label: 'DB', role: 'storage', kind: 'pg', summary: 's', repo: 'svc' },
      { id: 'pay', label: 'Payments', role: 'external', kind: 'stripe', summary: 's' },
    ],
    edges: [
      { id: 'e1', from: 'client', to: 'api', kind: 'sync', label: 'POST' },
      { id: 'e2', from: 'api', to: 'worker', kind: 'async' },
      { id: 'e3', from: 'reserve', to: 'db', kind: 'write', label: 'reserve' },
      { id: 'e4', from: 'worker', to: 'pay', kind: 'calls' },
      { id: 'e5', from: 'lock', to: 'db', kind: 'read', label: 'lock' },
      { id: 'e6', from: 'reserve', to: 'lock', kind: 'calls' },
    ],
    steps: [
      { id: 's1', narration: 'call', focus: ['api'], travel: { edgeId: 'e1' } },
      { id: 's2', narration: 'work', focus: ['worker'], travel: { edgeId: 'e2' }, expand: 'worker', substeps: [
        { id: 's2-1', narration: 'reserve', focus: ['reserve'], travel: { edgeId: 'e3' }, expand: 'reserve', substeps: [
          { id: 's2-1-1', narration: 'lock', focus: ['lock'], travel: { edgeId: 'e5' } },
        ] },
        { id: 's2-2', narration: 'inner call', focus: ['lock'], travel: { edgeId: 'e6' } },
      ] },
      { id: 's3', narration: 'pay', focus: ['pay'], travel: { edgeId: 'e4' } },
    ],
    risks: [{ id: 'r1', category: 'performance', severity: 'high', title: 'contention', explanation: 'x', nodeIds: ['lock'] }],
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.scene;
};
```

- [ ] **Step 2: Write the failing tests**

`packages/scene/test/v2/hierarchy.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ancestorsOf, computeVisible, descendantsOf, indexScene, projectEdges, topLevelGroups, validateScene } from '../../src/v2/index';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const none = new Set<string>();
const sorted = (s: Iterable<string>) => [...s].sort();
const pairs = (level: Parameters<typeof computeVisible>[2], local = none) =>
  projectEdges(scene, computeVisible(scene, index, level, local)).edges.map((e) => `${e.key}:${e.edgeIds.join('+')}`);

describe('indexScene', () => {
  it('computes children, depth, top level, ancestors and descendants', () => {
    expect(index.children.get('worker')).toEqual(['reserve']);
    expect(index.depth.get('lock')).toBe(2);
    expect(index.topLevel).toEqual(['client', 'api', 'worker', 'db', 'pay']);
    expect(ancestorsOf(index, 'lock')).toEqual(['reserve', 'worker']);
    expect(descendantsOf(index, 'worker')).toEqual(['reserve', 'lock']);
  });
});

describe('computeVisible', () => {
  it('architecture shows top-level pieces and maps internals to their visible ancestor', () => {
    const m = computeVisible(scene, index, 'architecture', none);
    expect(sorted(m.visible)).toEqual(['api', 'client', 'db', 'pay', 'worker']);
    expect(m.expanded.size).toBe(0);
    expect(m.representative.get('lock')).toBe('worker');
    expect(pairs('architecture')).toEqual(['client->api:e1', 'api->worker:e2', 'worker->db:e3+e5', 'worker->pay:e4']);
  });

  it('components expands top-level pieces with children', () => {
    const m = computeVisible(scene, index, 'components', none);
    expect(sorted(m.expanded)).toEqual(['worker']);
    expect(m.visible.has('reserve')).toBe(true);
    expect(m.representative.get('lock')).toBe('reserve');
    expect(pairs('components')).toEqual(['client->api:e1', 'api->worker:e2', 'reserve->db:e3+e5', 'worker->pay:e4']);
  });

  it('detail expands everything', () => {
    const m = computeVisible(scene, index, 'detail', none);
    expect(sorted(m.expanded)).toEqual(['reserve', 'worker']);
    expect(pairs('detail')).toEqual(['client->api:e1', 'api->worker:e2', 'reserve->db:e3', 'worker->pay:e4', 'lock->db:e5', 'reserve->lock:e6']);
  });

  it('system collapses each repo into a box and keeps repo-less pieces', () => {
    const m = computeVisible(scene, index, 'system', new Set(['worker']));
    expect(m.repoBoxes.get('repo:svc')).toEqual(['api', 'worker', 'db']);
    expect(m.repoBoxes.get('repo:web')).toEqual(['client']);
    expect(sorted(m.visible)).toEqual(['pay']);
    expect(m.expanded.size).toBe(0);
    expect(m.representative.get('lock')).toBe('repo:svc');
    expect(pairs('system')).toEqual(['repo:web->repo:svc:e1', 'repo:svc->pay:e4']);
  });

  it('local expansion adds the node and its ancestors; leaves are ignored', () => {
    const m = computeVisible(scene, index, 'architecture', new Set(['reserve', 'db', 'ghost']));
    expect(sorted(m.expanded)).toEqual(['reserve', 'worker']);
    expect(m.visible.has('lock')).toBe(true);
  });

  it('keyOf omits edges that collapse into one visible piece', () => {
    const projected = projectEdges(scene, computeVisible(scene, index, 'architecture', none));
    expect(projected.keyOf.get('e3')).toBe('worker->db');
    expect(projected.keyOf.has('e6')).toBe(false);
  });
});

describe('topLevelGroups', () => {
  it('groups by repo when no explicit groups exist', () => {
    expect(topLevelGroups(scene, index.topLevel)).toEqual([
      { id: 'group:web', label: 'web', nodeIds: ['client'] },
      { id: 'group:svc', label: 'svc', nodeIds: ['api', 'worker', 'db'] },
    ]);
  });

  it('uses explicit groups filtered to visible nodes', () => {
    const result = validateScene({ ...scene, groups: [{ id: 'core', label: 'Core', nodeIds: ['api', 'db'] }] });
    if (!result.ok) throw new Error(result.errors.join());
    expect(topLevelGroups(result.scene, ['api', 'client'])).toEqual([{ id: 'core', label: 'Core', nodeIds: ['api'] }]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @rdi/scene -- hierarchy`
Expected: FAIL — `indexScene` is not exported.

- [ ] **Step 4: Implement**

`packages/scene/src/v2/hierarchy.ts`:
```ts
import type { EdgeKind, Scene, SceneNode } from './schema';

export const LEVELS = ['system', 'architecture', 'components', 'detail'] as const;
export type Level = (typeof LEVELS)[number];

export const repoBoxId = (repo: string): string => `repo:${repo}`;
const REPO_GROUP_PREFIX = 'group:';

export type SceneIndex = {
  byId: Map<string, SceneNode>;
  children: Map<string, string[]>;
  depth: Map<string, number>;
  topLevel: string[];
};

export const indexScene = (scene: Scene): SceneIndex => {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>(scene.nodes.map((n) => [n.id, []]));
  scene.nodes.forEach((n) => {
    if (n.parent) children.get(n.parent)?.push(n.id);
  });
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const parent = byId.get(id)?.parent;
    const value = parent ? depthOf(parent) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  scene.nodes.forEach((n) => depthOf(n.id));
  return { byId, children, depth, topLevel: scene.nodes.filter((n) => !n.parent).map((n) => n.id) };
};

export const ancestorsOf = (index: SceneIndex, id: string): string[] => {
  const result: string[] = [];
  let cursor = index.byId.get(id)?.parent;
  while (cursor) {
    result.push(cursor);
    cursor = index.byId.get(cursor)?.parent;
  }
  return result;
};

export const descendantsOf = (index: SceneIndex, id: string): string[] =>
  (index.children.get(id) ?? []).flatMap((child) => [child, ...descendantsOf(index, child)]);

export type VisibleModel = {
  level: Level;
  expanded: Set<string>;
  visible: Set<string>;
  repoBoxes: Map<string, string[]>;
  representative: Map<string, string>;
};

const hasChildren = (index: SceneIndex, id: string) => (index.children.get(id)?.length ?? 0) > 0;

const systemModel = (scene: Scene, index: SceneIndex): VisibleModel => {
  const repoBoxes = new Map<string, string[]>();
  const visible = new Set<string>();
  index.topLevel.forEach((id) => {
    const repo = index.byId.get(id)?.repo;
    if (!repo) {
      visible.add(id);
      return;
    }
    const box = repoBoxId(repo);
    repoBoxes.set(box, [...(repoBoxes.get(box) ?? []), id]);
  });
  const representative = new Map<string, string>();
  scene.nodes.forEach((n) => {
    const top = [n.id, ...ancestorsOf(index, n.id)].at(-1) as string;
    const repo = index.byId.get(top)?.repo;
    representative.set(n.id, repo ? repoBoxId(repo) : top);
  });
  return { level: 'system', expanded: new Set(), visible, repoBoxes, representative };
};

export const computeVisible = (scene: Scene, index: SceneIndex, level: Level, localExpanded: ReadonlySet<string>): VisibleModel => {
  if (level === 'system') return systemModel(scene, index);

  const expanded = new Set<string>();
  scene.nodes.forEach((n) => {
    if (!hasChildren(index, n.id)) return;
    if (level === 'detail' || (level === 'components' && index.depth.get(n.id) === 0)) expanded.add(n.id);
  });
  localExpanded.forEach((id) => {
    if (!index.byId.has(id) || !hasChildren(index, id)) return;
    expanded.add(id);
    ancestorsOf(index, id).forEach((a) => expanded.add(a));
  });

  const visible = new Set(scene.nodes.filter((n) => ancestorsOf(index, n.id).every((a) => expanded.has(a))).map((n) => n.id));
  const representative = new Map<string, string>();
  scene.nodes.forEach((n) => {
    const chain = [n.id, ...ancestorsOf(index, n.id)];
    representative.set(n.id, chain.find((id) => visible.has(id)) as string);
  });
  return { level, expanded, visible, repoBoxes: new Map(), representative };
};

export type ProjectedEdge = { key: string; from: string; to: string; kind: EdgeKind; label?: string; edgeIds: string[] };
export type ProjectedEdges = { edges: ProjectedEdge[]; keyOf: Map<string, string> };

export const projectEdges = (scene: Scene, model: VisibleModel): ProjectedEdges => {
  const byKey = new Map<string, ProjectedEdge>();
  const keyOf = new Map<string, string>();
  scene.edges.forEach((edge) => {
    const from = model.representative.get(edge.from);
    const to = model.representative.get(edge.to);
    if (!from || !to || from === to) return;
    const key = `${from}->${to}`;
    keyOf.set(edge.id, key);
    const existing = byKey.get(key);
    if (existing) {
      existing.edgeIds.push(edge.id);
      return;
    }
    byKey.set(key, { key, from, to, kind: edge.kind, label: edge.label, edgeIds: [edge.id] });
  });
  return { edges: [...byKey.values()], keyOf };
};

export type TopGroup = { id: string; label: string; nodeIds: string[] };

export const topLevelGroups = (scene: Scene, visibleTop: string[]): TopGroup[] => {
  const visible = new Set(visibleTop);
  if (scene.groups.length > 0) {
    return scene.groups
      .map((g) => ({ id: g.id, label: g.label, nodeIds: g.nodeIds.filter((id) => visible.has(id)) }))
      .filter((g) => g.nodeIds.length > 0);
  }
  const byRepo = new Map<string, string[]>();
  const repoOf = new Map(scene.nodes.map((n) => [n.id, n.repo]));
  visibleTop.forEach((id) => {
    const repo = repoOf.get(id);
    if (repo) byRepo.set(repo, [...(byRepo.get(repo) ?? []), id]);
  });
  return [...byRepo.entries()].map(([repo, nodeIds]) => ({ id: `${REPO_GROUP_PREFIX}${repo}`, label: repo, nodeIds }));
};
```

Append to `packages/scene/src/v2/index.ts`:
```ts
export * from './hierarchy';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @rdi/scene && npm run typecheck -w @rdi/scene`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scene): add v2 hierarchy, levels and edge projection

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Walkthrough numbering and flattening

**Files:**
- Create: `packages/scene/src/v2/walkthrough.ts`
- Modify: `packages/scene/src/v2/index.ts`
- Test: `packages/scene/test/v2/walkthrough.test.ts`

**Interfaces:**
- Consumes: `Step` (Task 1), fixture (Task 2).
- Produces:
  ```ts
  type FlatStep = { step: Step; path: string; depth: number; parentId: string | null }
  numberSteps(steps: Step[]): Map<string, string>                 // id → "1", "2.1", "2.1.1"
  flattenSteps(steps: Step[], open: ReadonlySet<string>): FlatStep[] // depth-first; children only when parent open
  findStep(steps: Step[], id: string): Step | undefined
  stepAncestors(steps: Step[], id: string): string[]              // nearest first
  descendantStepIds(step: Step): string[]
  ```

- [ ] **Step 1: Write the failing tests**

`packages/scene/test/v2/walkthrough.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { descendantStepIds, findStep, flattenSteps, numberSteps, stepAncestors } from '../../src/v2/index';
import { fixtureScene } from './fixture';

const { steps } = fixtureScene();

describe('walkthrough', () => {
  it('numbers steps hierarchically', () => {
    const n = numberSteps(steps);
    expect(n.get('s2')).toBe('2');
    expect(n.get('s2-1')).toBe('2.1');
    expect(n.get('s2-1-1')).toBe('2.1.1');
    expect(n.get('s3')).toBe('3');
  });

  it('flattens only open steps, depth first', () => {
    expect(flattenSteps(steps, new Set()).map((f) => f.path)).toEqual(['1', '2', '3']);
    expect(flattenSteps(steps, new Set(['s2'])).map((f) => f.path)).toEqual(['1', '2', '2.1', '2.2', '3']);
    const deep = flattenSteps(steps, new Set(['s2', 's2-1']));
    expect(deep.map((f) => f.step.id)).toEqual(['s1', 's2', 's2-1', 's2-1-1', 's2-2', 's3']);
    expect(deep[3]).toMatchObject({ depth: 2, parentId: 's2-1' });
  });

  it('skips grandchildren when the middle step is closed', () => {
    expect(flattenSteps(steps, new Set(['s2-1'])).map((f) => f.path)).toEqual(['1', '2', '3']);
  });

  it('finds steps, ancestors and descendants', () => {
    expect(findStep(steps, 's2-1-1')?.narration).toBe('lock');
    expect(findStep(steps, 'ghost')).toBeUndefined();
    expect(stepAncestors(steps, 's2-1-1')).toEqual(['s2-1', 's2']);
    expect(stepAncestors(steps, 's1')).toEqual([]);
    expect(descendantStepIds(findStep(steps, 's2')!)).toEqual(['s2-1', 's2-1-1', 's2-2']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/scene -- walkthrough`
Expected: FAIL — `numberSteps` is not exported.

- [ ] **Step 3: Implement**

`packages/scene/src/v2/walkthrough.ts`:
```ts
import type { Step } from './schema';

export type FlatStep = { step: Step; path: string; depth: number; parentId: string | null };

export const numberSteps = (steps: Step[]): Map<string, string> => {
  const result = new Map<string, string>();
  const walk = (list: Step[], prefix: string) =>
    list.forEach((step, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      result.set(step.id, path);
      walk(step.substeps, path);
    });
  walk(steps, '');
  return result;
};

export const flattenSteps = (steps: Step[], open: ReadonlySet<string>): FlatStep[] => {
  const result: FlatStep[] = [];
  const walk = (list: Step[], prefix: string, depth: number, parentId: string | null) =>
    list.forEach((step, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      result.push({ step, path, depth, parentId });
      if (open.has(step.id)) walk(step.substeps, path, depth + 1, step.id);
    });
  walk(steps, '', 0, null);
  return result;
};

export const findStep = (steps: Step[], id: string): Step | undefined => {
  for (const step of steps) {
    if (step.id === id) return step;
    const nested = findStep(step.substeps, id);
    if (nested) return nested;
  }
  return undefined;
};

export const stepAncestors = (steps: Step[], id: string): string[] => {
  const search = (list: Step[], trail: string[]): string[] | null => {
    for (const step of list) {
      if (step.id === id) return trail;
      const found = search(step.substeps, [step.id, ...trail]);
      if (found) return found;
    }
    return null;
  };
  return search(steps, []) ?? [];
};

export const descendantStepIds = (step: Step): string[] =>
  step.substeps.flatMap((child) => [child.id, ...descendantStepIds(child)]);
```

Append to `packages/scene/src/v2/index.ts`:
```ts
export * from './walkthrough';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/scene && npm run typecheck -w @rdi/scene`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scene): add v2 walkthrough numbering and flattening

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Generic v2 sample scenes

**Files:**
- Create: `packages/scene/src/v2/samples/define.ts`, `checkout.ts`, `iot-telemetry.ts`, `index.ts`
- Modify: `packages/scene/src/v2/index.ts`
- Test: `packages/scene/test/v2/samples.test.ts`

**Interfaces:**
- Consumes: `validateScene`, `SceneInput`, `Scene`, `indexScene`, `flattenSteps`.
- Produces: `defineScene(input: SceneInput): Scene`; `sampleScenes: Scene[]`; `sampleRegistry: Record<string, Scene>`. Ids: `checkout-es`, `checkout-en`, `iot-telemetry`. Node/step/risk ids E2E relies on (checkout): nodes `checkout, api, orders-queue, worker, reserve-stock, lock-rows, check-qty, stock-row, charge, emit, inventory, payments, email`; steps `s1…s5`, `s3-1`, `s3-1-1…s3-1-4`, `s3-2`, `s3-3`; risks `r-lock, r-double-charge, r-deadlock, r-amount, r-pci, r-roundtrips`.

- [ ] **Step 1: Write the failing test**

`packages/scene/test/v2/samples.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { defineScene, flattenSteps, indexScene, sampleRegistry, sampleScenes, validateScene, type Scene, type Step } from '../../src/v2/index';

const allSteps = (steps: Step[]): Step[] => steps.flatMap((s) => [s, ...allSteps(s.substeps)]);
const shape = (scene: Scene) => ({
  nodes: scene.nodes.map((n) => [n.id, n.role, n.parent ?? null, n.repo ?? null]),
  edges: scene.edges.map((e) => [e.id, e.from, e.to]),
  steps: allSteps(scene.steps).map((s) => [s.id, s.travel?.edgeId ?? null, s.expand ?? null]),
  risks: scene.risks.map((r) => [r.id, r.category, r.severity]),
});

describe('v2 samples', () => {
  it('are valid and registered', () => {
    sampleScenes.forEach((s) => expect(validateScene(s)).toMatchObject({ ok: true }));
    expect(Object.keys(sampleRegistry).sort()).toEqual(['checkout-en', 'checkout-es', 'iot-telemetry']);
  });

  it('checkout exists in Spanish and English with identical structure', () => {
    const es = sampleRegistry['checkout-es']!;
    const en = sampleRegistry['checkout-en']!;
    expect(es.language).toBe('es');
    expect(en.language).toBe('en');
    expect(shape(es)).toEqual(shape(en));
    expect(es.nodes.find((n) => n.id === 'worker')!.summary).not.toBe(en.nodes.find((n) => n.id === 'worker')!.summary);
  });

  it('checkout covers every risk category, nesting two levels deep, code and changes', () => {
    const s = sampleRegistry['checkout-es']!;
    expect(new Set(s.risks.map((r) => r.category))).toEqual(new Set(['performance', 'security', 'complexity', 'reliability']));
    expect(Math.max(...indexScene(s).depth.values())).toBe(2);
    expect(s.nodes.some((n) => n.code?.snippet)).toBe(true);
    expect(s.nodes.some((n) => n.change)).toBe(true);
  });

  it('every non-logic top-level piece in checkout declares scale', () => {
    const s = sampleRegistry['checkout-en']!;
    s.nodes.filter((n) => !n.parent && n.role !== 'actor').forEach((n) => expect(n.scale, n.id).toBeDefined());
  });

  it('every top-level step travels an edge', () => {
    sampleScenes.forEach((s) => flattenSteps(s.steps, new Set()).forEach((f) => expect(f.step.travel, `${s.id}/${f.step.id}`).toBeDefined()));
  });

  it('iot telemetry is a non-web system with sub-steps', () => {
    const s = sampleRegistry['iot-telemetry']!;
    expect(s.nodes.map((n) => n.role)).toContain('channel');
    expect(s.steps.some((st) => st.substeps.length > 0)).toBe(true);
  });

  it('defineScene throws readable errors', () => {
    expect(() => defineScene({ id: 'x', title: 'x', language: 'en', nodes: [{ id: 'a', label: 'A', role: 'actor', kind: 'k', summary: 's', parent: 'b' }] })).toThrow(
      /nodes\.0\.parent: unknown node "b"/,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/scene -- samples`
Expected: FAIL — `sampleRegistry` is not exported from v2 (the v1 samples test still passes).

- [ ] **Step 3: Implement the samples**

`packages/scene/src/v2/samples/define.ts`:
```ts
import type { Scene, SceneInput } from '../schema';
import { validateScene } from '../validate';

export const defineScene = (input: SceneInput): Scene => {
  const result = validateScene(input);
  if (!result.ok) throw new Error(`Invalid scene "${input.id}":\n${result.errors.join('\n')}`);
  return result.scene;
};
```

`packages/scene/src/v2/samples/checkout.ts`:
```ts
import type { SceneInput } from '../schema';
import { defineScene } from './define';

type Lang = 'es' | 'en';

const RESERVE_SNIPPET = [
  'export async function reserveStock(tx: Tx, items: Item[]) {',
  '  for (const item of items) {',
  "    const row = await tx.one('SELECT qty FROM stock WHERE sku = $1 FOR UPDATE', [item.sku]);",
  '    if (row.qty < item.qty) throw new OutOfStock(item.sku);',
  "    await tx.none('UPDATE stock SET qty = qty - $1 WHERE sku = $2', [item.qty, item.sku]);",
  '  }',
  '}',
].join('\n');

const CHARGE_SNIPPET = [
  'export async function charge(order: Order) {',
  '  return stripe.paymentIntents.create(',
  "    { amount: order.totalCents, currency: 'usd', customer: order.customerId },",
  '    { idempotencyKey: `order-${order.id}` },',
  '  );',
  '}',
].join('\n');

const API_SNIPPET = [
  "router.post('/orders', auth, async (req, res) => {",
  '  const order = await orders.create(req.user.id, req.body.items);',
  "  await queue.send('orders', { orderId: order.id, attempt: 1 });",
  '  res.status(202).json({ orderId: order.id });',
  '});',
].join('\n');

const build = (lang: Lang): SceneInput => {
  const L = (es: string, en: string) => (lang === 'es' ? es : en);
  return {
    id: `checkout-${lang}`,
    title: L('Checkout y procesamiento de órdenes', 'Checkout & order processing'),
    summary: L(
      'Cómo una compra viaja desde el botón "Pagar" hasta el stock reservado, el cobro y el mail de confirmación.',
      'How a purchase travels from the "Pay" button to reserved stock, payment and the confirmation email.',
    ),
    language: lang,
    nodes: [
      {
        id: 'checkout', label: 'Checkout', role: 'actor', kind: 'React page', repo: 'web-store',
        summary: L('La página donde el cliente confirma la compra.', 'The page where the customer confirms the purchase.'),
      },
      {
        id: 'api', label: 'Orders API', role: 'compute', kind: 'REST API (Express)', repo: 'orders-api',
        summary: L('Valida la orden, la guarda y la encola; responde 202 sin esperar el procesamiento.', 'Validates and stores the order, enqueues it and answers 202 without waiting for processing.'),
        scale: {
          low: { status: 'ok', note: L('Holgada, ~5% de su capacidad.', 'Comfortable, ~5% of capacity.') },
          medium: { status: 'ok', note: L('~40% de uso, sin fila.', '~40% busy, no queueing.') },
          high: { status: 'strained', note: L('~90%: empieza a encolar requests.', '~90%: requests start to queue.') },
          strategy: 'horizontal',
          advice: L('Es stateless: sumar instancias detrás del balanceador.', 'Stateless: add instances behind the load balancer.'),
        },
        code: { repo: 'orders-api', path: 'src/routes/orders.ts', startLine: 12, endLine: 16, language: 'typescript', snippet: API_SNIPPET },
      },
      {
        id: 'orders-queue', label: 'orders queue', role: 'channel', kind: 'SQS queue', repo: 'orders-api',
        summary: L('Desacopla la API del procesamiento y absorbe picos.', 'Decouples the API from processing and absorbs spikes.'),
        scale: {
          low: { status: 'ok', note: L('Casi siempre vacía.', 'Almost always empty.') },
          medium: { status: 'ok', note: L('Absorbe el pico sin problema.', 'Absorbs the spike without trouble.') },
          high: { status: 'strained', note: L('Crece la profundidad: la fila real está en quien consume.', 'Depth grows: the real bottleneck is the consumer.') },
          strategy: 'horizontal',
          advice: L('Escalar consumidores; procesar de forma idempotente (entrega at-least-once).', 'Scale consumers; process idempotently (at-least-once delivery).'),
        },
      },
      {
        id: 'worker', label: 'Order worker', role: 'compute', kind: 'Node worker ×2', repo: 'orders-api',
        summary: L('Toma órdenes de la cola, reserva stock, cobra y avisa.', 'Takes orders from the queue, reserves stock, charges and notifies.'),
        scale: {
          low: { status: 'ok', note: L('Una orden a la vez, sin espera.', 'One order at a time, no waiting.') },
          medium: { status: 'limit', note: L('Los 2 workers casi siempre ocupados; se forma fila en la cola.', 'Both workers are almost always busy; a queue builds up.') },
          high: { status: 'saturated', note: L('Saturado: la fila crece sin parar.', 'Saturated: the queue keeps growing.') },
          strategy: 'horizontal',
          advice: L('Sumar workers… pero más workers empujan más carga al inventario, que no escala igual.', 'Add workers… but more workers push more load onto inventory, which does not scale the same way.'),
        },
      },
      {
        id: 'reserve-stock', label: 'reserveStock()', role: 'logic', kind: L('función transaccional', 'transactional function'), parent: 'worker',
        summary: L('Reserva el stock de todos los ítems dentro de una transacción.', 'Reserves stock for every item inside one transaction.'),
        complexity: { time: 'O(k)', space: 'O(1)', note: L('k = ítems de la orden; un round-trip por ítem.', 'k = items in the order; one round-trip per item.') },
        code: { repo: 'orders-api', path: 'src/worker/reserve.ts', startLine: 8, endLine: 14, language: 'typescript', snippet: RESERVE_SNIPPET },
      },
      {
        id: 'lock-rows', label: 'lock rows', role: 'logic', kind: 'SELECT … FOR UPDATE', parent: 'reserve-stock',
        summary: L('Bloquea la fila de cada producto para que nadie más la venda.', 'Locks each product row so nobody else can sell it.'),
        complexity: { time: 'O(k log n)', note: L('Búsqueda por índice en n productos.', 'Index lookup over n products.') },
      },
      {
        id: 'check-qty', label: 'check quantity', role: 'logic', kind: L('validación', 'validation'), parent: 'reserve-stock',
        summary: L('Si no alcanza el stock, aborta la transacción.', 'Aborts the transaction when there is not enough stock.'),
        complexity: { time: 'O(1)' },
      },
      {
        id: 'stock-row', label: 'stock row', role: 'data', kind: L('fila de la tabla stock', 'stock table row'), parent: 'reserve-stock',
        summary: L('La cantidad disponible de un SKU.', 'The available quantity of one SKU.'),
      },
      {
        id: 'charge', label: 'charge()', role: 'logic', kind: L('llamada a pagos', 'payment call'), parent: 'worker', change: 'modified',
        summary: L('Cobra la orden con una clave de idempotencia.', 'Charges the order with an idempotency key.'),
        complexity: { time: 'O(1)', note: L('Dominado por la latencia del proveedor (~700ms).', 'Dominated by provider latency (~700ms).') },
        code: { repo: 'orders-api', path: 'src/worker/charge.ts', startLine: 3, endLine: 8, language: 'typescript', snippet: CHARGE_SNIPPET },
      },
      {
        id: 'emit', label: 'emit(order.paid)', role: 'logic', kind: L('evento de dominio', 'domain event'), parent: 'worker', change: 'added',
        summary: L('Publica que la orden quedó paga.', 'Publishes that the order was paid.'),
      },
      {
        id: 'inventory', label: 'Inventory DB', role: 'storage', kind: 'PostgreSQL', repo: 'orders-api',
        summary: L('Guarda el stock y lo bloquea por fila durante la reserva.', 'Stores stock and locks it per row during reservation.'),
        scale: {
          low: { status: 'ok', note: L('Sin contención.', 'No contention.') },
          medium: { status: 'strained', note: L('Esperas cortas en productos populares.', 'Short waits on popular products.') },
          high: { status: 'saturated', note: L('El lock por fila serializa las reservas del mismo producto.', 'Row locks serialize reservations of the same product.') },
          strategy: 'none',
          advice: L('Sumar réplicas no ayuda: particionar stock por SKU o usar reservas optimistas.', 'Replicas do not help: partition stock per SKU or use optimistic reservations.'),
        },
      },
      {
        id: 'payments', label: 'Payments', role: 'external', kind: 'Stripe API',
        summary: L('Proveedor externo que cobra la tarjeta.', 'External provider that charges the card.'),
        scale: {
          low: { status: 'ok', note: L('Sin problemas.', 'No issues.') },
          medium: { status: 'ok', note: L('Dentro de los rate limits.', 'Within rate limits.') },
          high: { status: 'strained', note: L('Respuestas 429 por rate limit.', '429 responses from rate limiting.') },
          strategy: 'external',
          advice: L('Backoff exponencial y reintentos idempotentes.', 'Exponential backoff and idempotent retries.'),
        },
      },
      {
        id: 'email', label: 'Email provider', role: 'external', kind: 'transactional email',
        summary: L('Envía la confirmación al cliente.', 'Sends the confirmation to the customer.'),
        scale: {
          low: { status: 'ok', note: L('Sin problemas.', 'No issues.') },
          medium: { status: 'ok', note: L('Sin problemas.', 'No issues.') },
          high: { status: 'ok', note: L('Asíncrono: un atraso no bloquea la compra.', 'Asynchronous: delays do not block the purchase.') },
          strategy: 'external',
        },
      },
    ],
    edges: [
      { id: 'e-checkout-api', from: 'checkout', to: 'api', kind: 'sync', label: 'POST /orders' },
      { id: 'e-api-queue', from: 'api', to: 'orders-queue', kind: 'async', label: 'enqueue' },
      { id: 'e-queue-worker', from: 'orders-queue', to: 'worker', kind: 'async', label: 'consume' },
      { id: 'e-reserve-inventory', from: 'reserve-stock', to: 'inventory', kind: 'write', label: 'reserve stock' },
      { id: 'e-lock-inventory', from: 'lock-rows', to: 'inventory', kind: 'read', label: 'FOR UPDATE' },
      { id: 'e-lock-check', from: 'lock-rows', to: 'check-qty', kind: 'calls' },
      { id: 'e-check-row', from: 'check-qty', to: 'stock-row', kind: 'write', label: 'qty - k' },
      { id: 'e-reserve-charge', from: 'reserve-stock', to: 'charge', kind: 'calls' },
      { id: 'e-charge-emit', from: 'charge', to: 'emit', kind: 'calls' },
      { id: 'e-charge-payments', from: 'charge', to: 'payments', kind: 'calls', label: 'charge' },
      { id: 'e-emit-email', from: 'emit', to: 'email', kind: 'async', label: 'order.paid' },
    ],
    steps: [
      {
        id: 's1', narration: L('El cliente toca "Pagar": el checkout envía la orden a la API.', 'The customer presses "Pay": checkout sends the order to the API.'),
        focus: ['api'], travel: { edgeId: 'e-checkout-api', payload: 'POST' },
        payload: { format: 'json', after: '{\n  "items": [{ "sku": "TSHIRT-M", "qty": 2 }],\n  "total": 59.8\n}' },
      },
      {
        id: 's2', narration: L('La API valida, guarda la orden y la encola. Responde 202 al instante.', 'The API validates, stores and enqueues the order. It answers 202 right away.'),
        focus: ['orders-queue'], travel: { edgeId: 'e-api-queue', payload: 'order' },
        payload: { format: 'json', before: '{ "items": [...], "total": 59.8 }', after: '{\n  "orderId": "ord_91",\n  "attempt": 1\n}' },
      },
      {
        id: 's3', narration: L('Un worker libre toma la orden de la cola y la procesa.', 'A free worker takes the order from the queue and processes it.'),
        focus: ['worker'], travel: { edgeId: 'e-queue-worker', payload: 'ord_91' }, expand: 'worker',
        substeps: [
          {
            id: 's3-1', narration: L('Reserva el stock de cada ítem dentro de una transacción.', 'Reserves stock for each item inside a transaction.'),
            focus: ['reserve-stock', 'inventory'], travel: { edgeId: 'e-reserve-inventory', payload: 'reserve' }, expand: 'reserve-stock',
            substeps: [
              {
                id: 's3-1-1', narration: L('Bloquea la fila del producto: nadie más puede venderlo hasta que termine.', 'Locks the product row: nobody else can sell it until this finishes.'),
                focus: ['lock-rows', 'inventory'], travel: { edgeId: 'e-lock-inventory', payload: 'FOR UPDATE' },
                annotate: [{ nodeId: 'lock-rows', text: L('1 reserva a la vez por SKU', '1 reservation at a time per SKU') }],
              },
              {
                id: 's3-1-2', narration: L('La base devuelve la fila bloqueada con la cantidad actual.', 'The database returns the locked row with the current quantity.'),
                focus: ['lock-rows'], travel: { edgeId: 'e-lock-inventory', reverse: true, payload: 'qty = 3' },
              },
              {
                id: 's3-1-3', narration: L('Verifica que alcance: 3 disponibles, se piden 2.', 'Checks there is enough: 3 available, 2 requested.'),
                focus: ['check-qty'], travel: { edgeId: 'e-lock-check' },
              },
              {
                id: 's3-1-4', narration: L('Descuenta la cantidad; el lock se libera al hacer commit.', 'Decrements the quantity; the lock is released on commit.'),
                focus: ['stock-row'], travel: { edgeId: 'e-check-row', payload: '-2' },
                payload: { format: 'sql', before: 'qty = 3', after: "UPDATE stock SET qty = qty - 2\nWHERE sku = 'TSHIRT-M';  -- qty = 1" },
              },
            ],
          },
          { id: 's3-2', narration: L('Con el stock reservado, pasa a cobrar.', 'With stock reserved, it moves on to charge.'), focus: ['charge'], travel: { edgeId: 'e-reserve-charge' } },
          { id: 's3-3', narration: L('Si el cobro sale bien, emite el evento de orden paga.', 'When the charge succeeds, it emits the order-paid event.'), focus: ['emit'], travel: { edgeId: 'e-charge-emit' } },
        ],
      },
      {
        id: 's4', narration: L('El worker cobra con el proveedor de pagos usando una clave de idempotencia.', 'The worker charges through the payment provider with an idempotency key.'),
        focus: ['payments'], highlight: ['worker'], travel: { edgeId: 'e-charge-payments', payload: '$59.80' },
      },
      {
        id: 's5', narration: L('El evento dispara el mail de confirmación. Fin del recorrido.', 'The event triggers the confirmation email. End of the walkthrough.'),
        focus: ['email'], travel: { edgeId: 'e-emit-email', payload: 'order.paid' },
      },
    ],
    risks: [
      {
        id: 'r-lock', category: 'performance', severity: 'high', nodeIds: ['lock-rows', 'inventory'],
        title: L('Contención de locks en productos populares', 'Lock contention on popular products'),
        explanation: L('Todas las reservas de un mismo SKU esperan en fila por el mismo lock de fila.', 'Every reservation of the same SKU waits in line for the same row lock.'),
        mitigation: L('Particionar el stock en "buckets" por SKU o reservar de forma optimista con reintento.', 'Split stock into per-SKU buckets or reserve optimistically with retry.'),
      },
      {
        id: 'r-double-charge', category: 'reliability', severity: 'critical', nodeIds: ['charge', 'orders-queue'],
        title: L('Doble cobro si el mensaje se reentrega', 'Double charge when a message is redelivered'),
        explanation: L('La cola entrega al menos una vez: si el worker muere después de cobrar, otro worker vuelve a cobrar.', 'The queue delivers at least once: if a worker dies after charging, another worker charges again.'),
        mitigation: L('Clave de idempotencia por orden (ya aplicada en este cambio) y registrar el cobro antes de confirmar el mensaje.', 'Per-order idempotency key (added in this change) and record the charge before acknowledging the message.'),
      },
      {
        id: 'r-deadlock', category: 'reliability', severity: 'medium', nodeIds: ['lock-rows'],
        title: L('Deadlocks entre órdenes', 'Deadlocks between orders'),
        explanation: L('Dos órdenes que bloquean los mismos SKUs en distinto orden pueden trabarse mutuamente.', 'Two orders locking the same SKUs in a different order can block each other.'),
        mitigation: L('Ordenar los ítems por SKU antes de bloquear.', 'Sort items by SKU before locking.'),
      },
      {
        id: 'r-amount', category: 'security', severity: 'high', nodeIds: ['api'],
        title: L('El total viene del cliente', 'The total comes from the client'),
        explanation: L('Si la API confía en el total enviado por el navegador, un usuario puede pagar menos.', 'If the API trusts the total sent by the browser, a user can pay less.'),
        mitigation: L('Recalcular precios y total del lado servidor.', 'Recompute prices and totals on the server.'),
      },
      {
        id: 'r-pci', category: 'security', severity: 'medium', nodeIds: ['payments', 'checkout'],
        title: L('Datos de tarjeta', 'Card data'),
        explanation: L('Los datos de tarjeta nunca deben pasar por nuestros servidores.', 'Card data must never pass through our servers.'),
        mitigation: L('Tokenizar en el navegador con el SDK del proveedor.', 'Tokenize in the browser with the provider SDK.'),
      },
      {
        id: 'r-roundtrips', category: 'complexity', severity: 'low', nodeIds: ['reserve-stock'],
        title: L('Un round-trip por ítem', 'One round-trip per item'),
        explanation: L('reserveStock hace k consultas secuenciales: O(k) viajes a la base mientras sostiene locks.', 'reserveStock issues k sequential queries: O(k) database trips while holding locks.'),
        mitigation: L('Bloquear y actualizar todos los SKUs en una sola consulta.', 'Lock and update all SKUs in a single query.'),
      },
    ],
  };
};

export const checkoutEs = defineScene(build('es'));
export const checkoutEn = defineScene(build('en'));
```

`packages/scene/src/v2/samples/iot-telemetry.ts`:
```ts
import { defineScene } from './define';

export const iotTelemetry = defineScene({
  id: 'iot-telemetry',
  title: 'IoT telemetry ingestion',
  summary: 'How sensor readings travel from devices to dashboards and on-call alerts.',
  language: 'en',
  nodes: [
    { id: 'devices', label: 'Sensor fleet', role: 'actor', kind: 'ESP32 firmware', repo: 'firmware', summary: 'Thousands of devices publishing a reading every 5 seconds.' },
    {
      id: 'broker', label: 'MQTT broker', role: 'channel', kind: 'EMQX cluster', repo: 'ingest', summary: 'Receives device messages and fans them out to subscribers.',
      scale: {
        low: { status: 'ok', note: 'Idle most of the time.' },
        medium: { status: 'ok', note: 'Comfortable with a few thousand devices.' },
        high: { status: 'strained', note: 'Connection count per node becomes the limit.' },
        strategy: 'horizontal', advice: 'Add broker nodes; shard devices by id.',
      },
    },
    {
      id: 'processor', label: 'Stream processor', role: 'compute', kind: 'Flink job', repo: 'ingest', summary: 'Deduplicates readings and aggregates them per device every minute.',
      scale: {
        low: { status: 'ok', note: 'Tiny windows.' },
        medium: { status: 'strained', note: 'Window state grows with active devices.' },
        high: { status: 'limit', note: 'Memory pressure from per-device state.' },
        strategy: 'horizontal', advice: 'Increase parallelism keyed by device id; spill state to RocksDB.',
      },
    },
    { id: 'dedupe', label: 'dedupe', role: 'logic', kind: 'hash set per window', parent: 'processor', summary: 'Drops readings already seen in the current window.', complexity: { time: 'O(1) avg', space: 'O(n)', note: 'n = readings in the window.' } },
    { id: 'window', label: '60s window', role: 'logic', kind: 'tumbling window', parent: 'processor', summary: 'Buckets readings into one-minute windows per device.', complexity: { time: 'O(n)' } },
    { id: 'aggregate', label: 'aggregates', role: 'data', kind: 'min / max / avg', parent: 'processor', summary: 'Per-device statistics for the closed window.' },
    {
      id: 'tsdb', label: 'Time-series DB', role: 'storage', kind: 'TimescaleDB', repo: 'ingest', summary: 'Stores one aggregate row per device per minute.',
      scale: {
        low: { status: 'ok', note: 'Trivial write rate.' },
        medium: { status: 'ok', note: 'Batched inserts keep up.' },
        high: { status: 'strained', note: 'Chunk size and indexes need tuning.' },
        strategy: 'vertical', advice: 'Tune chunk intervals and add compression; scale the primary.',
      },
    },
    {
      id: 'alerts', label: 'Alerting service', role: 'compute', kind: 'rules engine', repo: 'alerts', summary: 'Evaluates thresholds on aggregates.',
      scale: {
        low: { status: 'ok', note: 'Few rules, few events.' },
        medium: { status: 'ok', note: 'Fine.' },
        high: { status: 'strained', note: 'Alert storms when many devices breach at once.' },
        strategy: 'horizontal', advice: 'Group alerts per site before paging.',
      },
    },
    { id: 'pager', label: 'On-call pager', role: 'external', kind: 'PagerDuty', summary: 'Pages the engineer on call.' },
  ],
  edges: [
    { id: 'e-pub', from: 'devices', to: 'broker', kind: 'async', label: 'publish telemetry/{id}' },
    { id: 'e-sub', from: 'broker', to: 'dedupe', kind: 'async', label: 'subscribe' },
    { id: 'e-dedupe-window', from: 'dedupe', to: 'window', kind: 'calls' },
    { id: 'e-window-agg', from: 'window', to: 'aggregate', kind: 'write' },
    { id: 'e-flush', from: 'aggregate', to: 'tsdb', kind: 'write', label: 'flush every 60s' },
    { id: 'e-breach', from: 'aggregate', to: 'alerts', kind: 'async', label: 'threshold breach' },
    { id: 'e-page', from: 'alerts', to: 'pager', kind: 'calls', label: 'page' },
  ],
  steps: [
    { id: 's1', narration: 'A device publishes a temperature reading to the broker.', focus: ['broker'], travel: { edgeId: 'e-pub', payload: '21.7°C' }, payload: { format: 'json', after: '{ "device": "d-4411", "temp": 21.7, "ts": 1790614500 }' } },
    {
      id: 's2', narration: 'The stream processor receives the reading.', focus: ['processor'], travel: { edgeId: 'e-sub', payload: 'reading' }, expand: 'processor',
      substeps: [
        { id: 's2-1', narration: 'Duplicates from device retries are dropped.', focus: ['dedupe'], annotate: [{ nodeId: 'dedupe', text: 'QoS 1 can resend' }] },
        { id: 's2-2', narration: 'The reading lands in the device’s current one-minute window.', focus: ['window'], travel: { edgeId: 'e-dedupe-window' } },
        { id: 's2-3', narration: 'When the window closes, min/max/avg are computed.', focus: ['aggregate'], travel: { edgeId: 'e-window-agg', payload: 'avg 21.9' } },
      ],
    },
    { id: 's3', narration: 'Aggregates are flushed to the time-series database.', focus: ['tsdb'], travel: { edgeId: 'e-flush', payload: 'batch' } },
    { id: 's4', narration: 'A threshold breach is sent to the alerting service.', focus: ['alerts'], travel: { edgeId: 'e-breach', payload: 'temp > 40' } },
    { id: 's5', narration: 'The on-call engineer is paged.', focus: ['pager'], travel: { edgeId: 'e-page', payload: 'P2' } },
  ],
  risks: [
    { id: 'r-state', category: 'performance', severity: 'high', title: 'Window state grows with device count', explanation: 'Per-device state lives in memory for the whole window.', nodeIds: ['window', 'processor'], mitigation: 'Key by device, raise parallelism, use RocksDB state backend.' },
    { id: 'r-qos', category: 'reliability', severity: 'medium', title: 'Readings lost with QoS 0', explanation: 'Devices on QoS 0 drop readings during broker failovers.', nodeIds: ['devices', 'broker'], mitigation: 'Use QoS 1 plus dedupe (already in place).' },
    { id: 'r-creds', category: 'security', severity: 'critical', title: 'Shared device credential', explanation: 'All devices authenticate with the same username/password.', nodeIds: ['devices', 'broker'], mitigation: 'Per-device X.509 certificates.' },
    { id: 'r-dedupe', category: 'complexity', severity: 'low', title: 'Dedupe set is O(n) per window', explanation: 'The hash set keeps every reading id seen in the window.', nodeIds: ['dedupe'], mitigation: 'Bloom filter per device window.' },
  ],
});
```

`packages/scene/src/v2/samples/index.ts`:
```ts
import type { Scene } from '../schema';
import { checkoutEn, checkoutEs } from './checkout';
import { iotTelemetry } from './iot-telemetry';

export { defineScene } from './define';

export const sampleScenes: Scene[] = [checkoutEs, checkoutEn, iotTelemetry];

export const sampleRegistry: Record<string, Scene> = Object.fromEntries(sampleScenes.map((s) => [s.id, s]));
```

Append to `packages/scene/src/v2/index.ts`:
```ts
export * from './samples';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/scene && npm run typecheck -w @rdi/scene`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scene): add generic v2 sample scenes (checkout es/en, iot telemetry)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: UI internationalization

**Files:**
- Create: `apps/web/src/i18n/messages.ts`, `apps/web/src/i18n/I18nProvider.tsx`
- Test: `apps/web/test/i18n.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  UI_LANGUAGES: readonly ['en','es','pt']; type UiLanguage; type MessageKey (keys of the en catalog)
  translate(language: UiLanguage, key: MessageKey, params?: Record<string, string | number>): string
  detectLanguage(stored: string | null, navigatorLanguage: string | undefined): UiLanguage
  primarySubtag(tag: string): string
  <I18nProvider initialLanguage?> ; useI18n(): { language: UiLanguage; setLanguage(l: UiLanguage): void; t: (key, params?) => string }
  LANGUAGE_STORAGE_KEY = 'rdi.uiLanguage'
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/i18n.test.tsx`:
```tsx
import { act, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from '../src/i18n/I18nProvider';
import { detectLanguage, messages, primarySubtag, translate } from '../src/i18n/messages';

describe('translate', () => {
  it('returns the catalog string and interpolates params', () => {
    expect(translate('es', 'level.architecture')).toBe('Arquitectura');
    expect(translate('en', 'callout.risks', { count: 2 })).toBe('2 risks');
  });

  it('falls back to English when a key is missing in the language', () => {
    const key = 'level.system';
    const original = messages.pt[key];
    delete messages.pt[key];
    expect(translate('pt', key)).toBe('System');
    messages.pt[key] = original;
  });

  it('keeps every es and pt key present in en', () => {
    Object.keys(messages.es).forEach((k) => expect(messages.en).toHaveProperty(k));
    Object.keys(messages.pt).forEach((k) => expect(messages.en).toHaveProperty(k));
  });
});

describe('detectLanguage', () => {
  it('prefers a stored supported value, then the browser language, then English', () => {
    expect(detectLanguage('pt', 'es-AR')).toBe('pt');
    expect(detectLanguage('xx', 'es-AR')).toBe('es');
    expect(detectLanguage(null, 'pt-BR')).toBe('pt');
    expect(detectLanguage(null, 'de-DE')).toBe('en');
    expect(primarySubtag('pt-BR')).toBe('pt');
  });
});

const Probe = () => {
  const { t, setLanguage, language } = useI18n();
  return (
    <button type="button" onClick={() => setLanguage('es')} data-lang={language}>
      {t('level.components')}
    </button>
  );
};

describe('I18nProvider', () => {
  it('switches language without reload and persists it', () => {
    render(
      <I18nProvider initialLanguage="en">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Components');
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button')).toHaveTextContent('Componentes');
    expect(localStorage.getItem('rdi.uiLanguage')).toBe('es');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- i18n`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the catalogs**

`apps/web/src/i18n/messages.ts`:
```ts
export const UI_LANGUAGES = ['en', 'es', 'pt'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

const en = {
  'app.name': 'Repository Designer',
  'scene.label': 'Scene',
  'scene.regenerate': 'Regenerate in {language}',
  'scene.regenerateSoon': 'Available once the agent is connected',
  'language.label': 'Language',
  'language.en': 'English',
  'language.es': 'Español',
  'language.pt': 'Português',
  'level.label': 'Level',
  'level.system': 'System',
  'level.architecture': 'Architecture',
  'level.components': 'Components',
  'level.detail': 'Detail',
  'mode.walkthrough': 'Walkthrough',
  'mode.risks': 'Risks',
  'mode.changes': 'Changes',
  'overlay.scale': 'Scale overlay',
  'theme.label': 'Theme',
  'theme.mission': 'Mission control',
  'theme.studio': 'Studio',
  'theme.paper': 'Paper',
  'theme.contrast': 'High contrast',
  'explorer.title': 'Explorer',
  'explorer.walkthrough': 'Walkthrough',
  'explorer.risks': 'Risks',
  'explorer.expand': 'Expand',
  'explorer.collapse': 'Collapse',
  'walkthrough.empty': 'This scene has no walkthrough.',
  'now.title': 'Now',
  'now.idle': 'Press play to follow a request step by step.',
  'now.step': 'Step {path}',
  'card.title': 'Piece',
  'card.none': 'Select a piece on the canvas or in the explorer.',
  'card.complexity': 'Complexity',
  'card.time': 'time',
  'card.space': 'space',
  'card.atScale': 'At scale · likely problems',
  'card.low': 'Low',
  'card.medium': 'Medium',
  'card.high': 'High volume',
  'card.risks': 'Risks',
  'card.noRisks': 'No known risks.',
  'card.viewCode': 'View code (optional)',
  'card.openInside': 'Open inside',
  'card.details': 'Details',
  'strategy.horizontal': 'Scales horizontally',
  'strategy.vertical': 'Scales vertically',
  'strategy.none': 'Does not scale',
  'strategy.external': 'External provider',
  'strategy.na': 'Not applicable',
  'status.ok': 'comfortable',
  'status.strained': 'strained',
  'status.limit': 'at the limit',
  'status.saturated': 'saturated',
  'category.performance': 'Performance & scale',
  'category.security': 'Security',
  'category.complexity': 'Algorithmic complexity',
  'category.reliability': 'Reliability & consistency',
  'severity.low': 'low',
  'severity.medium': 'medium',
  'severity.high': 'high',
  'severity.critical': 'critical',
  'risks.empty': 'No risks recorded for this scene.',
  'risks.mitigation': 'Mitigation',
  'risks.affects': 'Affects',
  'code.title': 'Code',
  'code.close': 'Close',
  'code.unavailable': 'Code will be available after the repository is indexed.',
  'payload.title': 'Example data',
  'player.prev': 'Previous step',
  'player.next': 'Next step',
  'player.play': 'Play',
  'player.pause': 'Pause',
  'player.speed': 'Speed',
  'player.step': 'Step',
  'player.noSteps': 'No steps',
  'player.progress': 'Step {path} · {index} / {total}',
  'callout.openDetail': 'Open detail',
  'callout.viewCode': 'View code',
  'callout.risks': '{count} risks',
  'change.added': 'added',
  'change.modified': 'modified',
  'change.removed': 'removed',
  'canvas.loading': 'Laying out…',
  'canvas.error': 'Could not lay out this scene: {error}',
  'piece.inside': '{count} inside',
} as const;

export type MessageKey = keyof typeof en;
type Catalog = Partial<Record<MessageKey, string>>;

const es: Catalog = {
  'app.name': 'Repository Designer',
  'scene.label': 'Escena',
  'scene.regenerate': 'Regenerar en {language}',
  'scene.regenerateSoon': 'Disponible cuando el agente esté conectado',
  'language.label': 'Idioma',
  'language.en': 'English',
  'language.es': 'Español',
  'language.pt': 'Português',
  'level.label': 'Nivel',
  'level.system': 'Sistema',
  'level.architecture': 'Arquitectura',
  'level.components': 'Componentes',
  'level.detail': 'Detalle',
  'mode.walkthrough': 'Recorrido',
  'mode.risks': 'Riesgos',
  'mode.changes': 'Cambios',
  'overlay.scale': 'Capa de escala',
  'theme.label': 'Tema',
  'theme.mission': 'Mission control',
  'theme.studio': 'Studio',
  'theme.paper': 'Paper',
  'theme.contrast': 'Alto contraste',
  'explorer.title': 'Explorador',
  'explorer.walkthrough': 'Recorrido',
  'explorer.risks': 'Riesgos',
  'explorer.expand': 'Expandir',
  'explorer.collapse': 'Colapsar',
  'walkthrough.empty': 'Esta escena no tiene recorrido.',
  'now.title': 'Ahora',
  'now.idle': 'Tocá play para seguir una request paso a paso.',
  'now.step': 'Paso {path}',
  'card.title': 'Pieza',
  'card.none': 'Seleccioná una pieza en el canvas o en el explorador.',
  'card.complexity': 'Complejidad',
  'card.time': 'tiempo',
  'card.space': 'memoria',
  'card.atScale': 'A escala · posibles problemas',
  'card.low': 'Pocos',
  'card.medium': 'Medios',
  'card.high': 'Alto volumen',
  'card.risks': 'Riesgos',
  'card.noRisks': 'Sin riesgos conocidos.',
  'card.viewCode': 'Ver código (opcional)',
  'card.openInside': 'Abrir adentro',
  'card.details': 'Detalles',
  'strategy.horizontal': 'Escala horizontalmente',
  'strategy.vertical': 'Escala verticalmente',
  'strategy.none': 'No escala',
  'strategy.external': 'Proveedor externo',
  'strategy.na': 'No aplica',
  'status.ok': 'holgado',
  'status.strained': 'exigido',
  'status.limit': 'al límite',
  'status.saturated': 'saturado',
  'category.performance': 'Performance y escala',
  'category.security': 'Seguridad',
  'category.complexity': 'Complejidad algorítmica',
  'category.reliability': 'Confiabilidad y consistencia',
  'severity.low': 'baja',
  'severity.medium': 'media',
  'severity.high': 'alta',
  'severity.critical': 'crítica',
  'risks.empty': 'Esta escena no tiene riesgos registrados.',
  'risks.mitigation': 'Mitigación',
  'risks.affects': 'Afecta a',
  'code.title': 'Código',
  'code.close': 'Cerrar',
  'code.unavailable': 'El código va a estar disponible cuando se indexe el repositorio.',
  'payload.title': 'Datos de ejemplo',
  'player.prev': 'Paso anterior',
  'player.next': 'Paso siguiente',
  'player.play': 'Reproducir',
  'player.pause': 'Pausar',
  'player.speed': 'Velocidad',
  'player.step': 'Paso',
  'player.noSteps': 'Sin pasos',
  'player.progress': 'Paso {path} · {index} / {total}',
  'callout.openDetail': 'Abrir detalle',
  'callout.viewCode': 'Ver código',
  'callout.risks': '{count} riesgos',
  'change.added': 'agregado',
  'change.modified': 'modificado',
  'change.removed': 'eliminado',
  'canvas.loading': 'Acomodando…',
  'canvas.error': 'No se pudo acomodar la escena: {error}',
  'piece.inside': '{count} adentro',
};

const pt: Catalog = {
  'app.name': 'Repository Designer',
  'scene.label': 'Cena',
  'scene.regenerate': 'Regenerar em {language}',
  'scene.regenerateSoon': 'Disponível quando o agente estiver conectado',
  'language.label': 'Idioma',
  'language.en': 'English',
  'language.es': 'Español',
  'language.pt': 'Português',
  'level.label': 'Nível',
  'level.system': 'Sistema',
  'level.architecture': 'Arquitetura',
  'level.components': 'Componentes',
  'level.detail': 'Detalhe',
  'mode.walkthrough': 'Percurso',
  'mode.risks': 'Riscos',
  'mode.changes': 'Mudanças',
  'overlay.scale': 'Camada de escala',
  'theme.label': 'Tema',
  'theme.mission': 'Mission control',
  'theme.studio': 'Studio',
  'theme.paper': 'Paper',
  'theme.contrast': 'Alto contraste',
  'explorer.title': 'Explorador',
  'explorer.walkthrough': 'Percurso',
  'explorer.risks': 'Riscos',
  'explorer.expand': 'Expandir',
  'explorer.collapse': 'Recolher',
  'walkthrough.empty': 'Esta cena não tem percurso.',
  'now.title': 'Agora',
  'now.idle': 'Aperte play para seguir uma requisição passo a passo.',
  'now.step': 'Passo {path}',
  'card.title': 'Peça',
  'card.none': 'Selecione uma peça no canvas ou no explorador.',
  'card.complexity': 'Complexidade',
  'card.time': 'tempo',
  'card.space': 'memória',
  'card.atScale': 'Em escala · possíveis problemas',
  'card.low': 'Pouco',
  'card.medium': 'Médio',
  'card.high': 'Alto volume',
  'card.risks': 'Riscos',
  'card.noRisks': 'Nenhum risco conhecido.',
  'card.viewCode': 'Ver código (opcional)',
  'card.openInside': 'Abrir por dentro',
  'card.details': 'Detalhes',
  'strategy.horizontal': 'Escala horizontalmente',
  'strategy.vertical': 'Escala verticalmente',
  'strategy.none': 'Não escala',
  'strategy.external': 'Provedor externo',
  'strategy.na': 'Não se aplica',
  'status.ok': 'folgado',
  'status.strained': 'exigido',
  'status.limit': 'no limite',
  'status.saturated': 'saturado',
  'category.performance': 'Performance e escala',
  'category.security': 'Segurança',
  'category.complexity': 'Complexidade algorítmica',
  'category.reliability': 'Confiabilidade e consistência',
  'severity.low': 'baixa',
  'severity.medium': 'média',
  'severity.high': 'alta',
  'severity.critical': 'crítica',
  'risks.empty': 'Esta cena não tem riscos registrados.',
  'risks.mitigation': 'Mitigação',
  'risks.affects': 'Afeta',
  'code.title': 'Código',
  'code.close': 'Fechar',
  'code.unavailable': 'O código estará disponível quando o repositório for indexado.',
  'payload.title': 'Dados de exemplo',
  'player.prev': 'Passo anterior',
  'player.next': 'Próximo passo',
  'player.play': 'Reproduzir',
  'player.pause': 'Pausar',
  'player.speed': 'Velocidade',
  'player.step': 'Passo',
  'player.noSteps': 'Sem passos',
  'player.progress': 'Passo {path} · {index} / {total}',
  'callout.openDetail': 'Abrir detalhe',
  'callout.viewCode': 'Ver código',
  'callout.risks': '{count} riscos',
  'change.added': 'adicionado',
  'change.modified': 'modificado',
  'change.removed': 'removido',
  'canvas.loading': 'Organizando…',
  'canvas.error': 'Não foi possível organizar a cena: {error}',
  'piece.inside': '{count} dentro',
};

export const messages: Record<UiLanguage, Catalog> & { en: typeof en } = { en, es, pt };

const PARAM = /\{(\w+)\}/g;

export const translate = (language: UiLanguage, key: MessageKey, params?: Record<string, string | number>): string => {
  const template = messages[language][key] ?? en[key];
  return params ? template.replace(PARAM, (match, name: string) => (name in params ? String(params[name]) : match)) : template;
};

export const primarySubtag = (tag: string): string => tag.toLowerCase().split('-')[0] ?? tag;

const isUiLanguage = (value: string | null | undefined): value is UiLanguage =>
  value !== null && value !== undefined && (UI_LANGUAGES as readonly string[]).includes(value);

export const detectLanguage = (stored: string | null, navigatorLanguage: string | undefined): UiLanguage => {
  if (isUiLanguage(stored)) return stored;
  const fromNavigator = navigatorLanguage ? primarySubtag(navigatorLanguage) : undefined;
  return isUiLanguage(fromNavigator) ? fromNavigator : 'en';
};
```

- [ ] **Step 4: Implement the provider**

`apps/web/src/i18n/I18nProvider.tsx`:
```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { detectLanguage, translate, type MessageKey, type UiLanguage } from './messages';

export const LANGUAGE_STORAGE_KEY = 'rdi.uiLanguage';

type I18nValue = {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

const initial = (): UiLanguage =>
  detectLanguage(typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY), typeof navigator === 'undefined' ? undefined : navigator.language);

export const I18nProvider = ({ children, initialLanguage }: { children: ReactNode; initialLanguage?: UiLanguage }) => {
  const [language, setLanguageState] = useState<UiLanguage>(initialLanguage ?? initial);

  const setLanguage = useCallback((next: UiLanguage) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    document.documentElement.lang = next;
    setLanguageState(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ language, setLanguage, t: (key, params) => translate(language, key, params) }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nValue => {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add UI i18n catalogs (en, es, pt) and provider

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Workspace themes and stylesheet

**Files:**
- Create: `apps/web/src/theme/themes.ts`, `apps/web/src/workspace/workspace.css`
- Test: `apps/web/test/theme.test.ts`

**Interfaces:**
- Produces:
  ```ts
  THEMES: readonly ['mission','studio','paper','contrast']; type ThemeId
  THEME_STORAGE_KEY = 'rdi.theme'
  themeTokens: Record<ThemeId, Record<ThemeToken, string>>   // ThemeToken = the 14 CSS custom properties
  resolveTheme(user?: string | null, org?: string | null): ThemeId   // user → org → 'mission'
  applyTheme(element: HTMLElement, theme: ThemeId): void           // sets vars, data-theme, data-color-scheme
  ```
- CSS class contract used by Tasks 10–14 (all in `workspace.css`): `.ws .ws-top .ws-body .ws-activity .ws-explorer .ws-canvas .ws-inspector .ws-footer .sec-title .seg .tabs-inline .select .btn .btn-accent .tree .tree-item(.is-group/.is-selected) .twisty .risk-dot .sev-{low,medium,high,critical} .steps .step-row .step(.is-current/.is-done) .step-path .piece .piece-head .piece-label .piece-kind .piece-foot .piece-bar .is-focused .is-highlighted .is-dim .is-selected .is-active .change-{added,modified,removed} .scale-{ok,strained,limit,saturated} .badge .container .container-label .group-box .group-label .edge-line(.is-visited/.is-active/.kind-async) .edge-label .token .token-label .callout .callout-path .callout-actions .now .card-title .muted .h .scale-row .status-{ok,strained,limit,saturated} .risk-item .risk-card(.is-selected) .chips .chip .drawer .kw .payload .payload-head .diff-line--{added,removed,same} .player .player__counter .canvas-loading .canvas-error`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/theme.test.ts`:
```ts
import { applyTheme, resolveTheme, THEMES, themeTokens } from '../src/theme/themes';

describe('themes', () => {
  it('resolves user preference, then org default, then mission', () => {
    expect(resolveTheme('paper', 'studio')).toBe('paper');
    expect(resolveTheme(null, 'studio')).toBe('studio');
    expect(resolveTheme('neon', undefined)).toBe('mission');
    expect(resolveTheme()).toBe('mission');
  });

  it('defines every token for every theme', () => {
    const keys = Object.keys(themeTokens.mission).sort();
    THEMES.forEach((id) => expect(Object.keys(themeTokens[id]).sort()).toEqual(keys));
    expect(keys).toHaveLength(14);
  });

  it('applies tokens, data-theme and color-scheme to an element', () => {
    const el = document.createElement('div');
    applyTheme(el, 'paper');
    expect(el.dataset.theme).toBe('paper');
    expect(el.style.getPropertyValue('--bg')).toBe(themeTokens.paper['--bg']);
    expect(el.dataset.colorScheme).toBe('light');
    applyTheme(el, 'contrast');
    expect(el.style.getPropertyValue('--accent')).toBe('#ffea00');
    expect(el.dataset.colorScheme).toBe('dark');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- theme`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement themes**

`apps/web/src/theme/themes.ts`:
```ts
export const THEMES = ['mission', 'studio', 'paper', 'contrast'] as const;
export type ThemeId = (typeof THEMES)[number];
export const THEME_STORAGE_KEY = 'rdi.theme';

type ThemeToken =
  | '--bg' | '--panel' | '--grid' | '--line' | '--text' | '--muted' | '--accent' | '--token'
  | '--ok' | '--strained' | '--limit' | '--saturated' | '--font' | '--radius';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = 'Inter, system-ui, -apple-system, sans-serif';
const LIGHT_THEMES = new Set<ThemeId>(['paper']);

export const themeTokens: Record<ThemeId, Record<ThemeToken, string>> = {
  mission: {
    '--bg': '#05070b', '--panel': '#07120e', '--grid': '#0a1410', '--line': '#1d5a4a', '--text': '#d7fbe8', '--muted': '#5f9a85',
    '--accent': '#2dffa6', '--token': '#ffffff', '--ok': '#2dffa6', '--strained': '#f5d90a', '--limit': '#ff8a1f', '--saturated': '#ff3b5c',
    '--font': MONO, '--radius': '2px',
  },
  studio: {
    '--bg': '#0d0f14', '--panel': '#151923', '--grid': '#161b25', '--line': '#2a3142', '--text': '#e7e9ef', '--muted': '#8d95a8',
    '--accent': '#8b7dff', '--token': '#46a6ff', '--ok': '#3ecf8e', '--strained': '#f5d90a', '--limit': '#f5a524', '--saturated': '#f25f5c',
    '--font': SANS, '--radius': '10px',
  },
  paper: {
    '--bg': '#fbf8f3', '--panel': '#ffffff', '--grid': '#f1ece3', '--line': '#e2dccf', '--text': '#2b2a33', '--muted': '#6b6a75',
    '--accent': '#ff8a5b', '--token': '#2b2a33', '--ok': '#1a9e6c', '--strained': '#c9a200', '--limit': '#e07b1f', '--saturated': '#d93a4f',
    '--font': SANS, '--radius': '12px',
  },
  contrast: {
    '--bg': '#000000', '--panel': '#000000', '--grid': '#111111', '--line': '#ffffff', '--text': '#ffffff', '--muted': '#e0e0e0',
    '--accent': '#ffea00', '--token': '#00e5ff', '--ok': '#00ff66', '--strained': '#ffea00', '--limit': '#ff9100', '--saturated': '#ff1744',
    '--font': MONO, '--radius': '0px',
  },
};

const isTheme = (value: string | null | undefined): value is ThemeId =>
  value !== null && value !== undefined && (THEMES as readonly string[]).includes(value);

export const resolveTheme = (user?: string | null, org?: string | null): ThemeId => {
  if (isTheme(user)) return user;
  if (isTheme(org)) return org;
  return 'mission';
};

export const applyTheme = (element: HTMLElement, theme: ThemeId): void => {
  Object.entries(themeTokens[theme]).forEach(([token, value]) => element.style.setProperty(token, value));
  element.dataset.theme = theme;
  element.dataset.colorScheme = LIGHT_THEMES.has(theme) ? 'light' : 'dark';
};
```

- [ ] **Step 4: Stylesheet**

`apps/web/src/workspace/workspace.css`:
```css
* { box-sizing: border-box; }
[data-color-scheme='light'] { color-scheme: light; }
[data-color-scheme='dark'] { color-scheme: dark; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); }
button, select, input { font: inherit; color: inherit; }

.ws { display: grid; grid-template-rows: 44px minmax(0, 1fr) 44px; height: 100vh; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 12px; }
.ws-top { display: flex; align-items: center; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--line); min-width: 0; }
.ws-title { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-spacer { flex: 1; }
.ws-body { display: grid; grid-template-columns: 36px 260px minmax(0, 1fr) 320px; min-height: 0; }
.ws-activity { border-right: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 8px; }
.ws-activity button { width: 28px; height: 28px; border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: var(--radius); }
.ws-activity button[aria-pressed='true'] { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.ws-explorer { border-right: 1px solid var(--line); overflow: auto; }
.ws-canvas { position: relative; min-width: 0; background: linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 22px, linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0 / 22px 100%; }
.ws-inspector { border-left: 1px solid var(--line); overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.ws-footer { border-top: 1px solid var(--line); }

.sec-title { padding: 8px 10px; color: var(--muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; border-bottom: 1px solid var(--line); }
.seg { display: inline-flex; }
.seg button { border: 1px solid var(--line); background: transparent; padding: 4px 10px; margin-right: -1px; color: var(--muted); cursor: pointer; }
.seg button[aria-pressed='true'] { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.tabs-inline { display: inline-flex; gap: 4px; }
.tabs-inline button { border: 1px solid var(--line); background: transparent; padding: 4px 8px; color: var(--muted); cursor: pointer; border-radius: var(--radius); }
.tabs-inline button[aria-selected='true'] { color: var(--accent); border-color: var(--accent); }
.select { background: var(--panel); border: 1px solid var(--line); color: var(--text); padding: 4px 6px; border-radius: var(--radius); }
.btn { border: 1px solid var(--line); background: transparent; color: var(--text); padding: 4px 10px; border-radius: var(--radius); cursor: pointer; }
.btn:disabled { opacity: .45; cursor: default; }
.btn-accent { border-color: var(--accent); color: var(--accent); }

.tree { padding: 4px 0; }
.tree-item { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; background: transparent; text-align: left; padding: 3px 10px; color: var(--text); cursor: pointer; white-space: nowrap; }
.tree-item.is-group { color: var(--muted); cursor: default; }
.tree-item.is-selected { background: color-mix(in srgb, var(--accent) 12%, transparent); outline: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); }
.twisty { width: 14px; border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; flex: none; }
.risk-dot { width: 7px; height: 7px; border-radius: 50%; margin-left: auto; flex: none; }
.sev-low { background: var(--ok); } .sev-medium { background: var(--strained); } .sev-high { background: var(--limit); } .sev-critical { background: var(--saturated); }

.steps { padding: 4px 0; }
.step-row { display: flex; align-items: flex-start; gap: 2px; padding: 1px 6px; }
.step { flex: 1; border: 0; background: transparent; text-align: left; color: var(--text); padding: 3px 6px; border-left: 2px solid transparent; cursor: pointer; line-height: 1.35; }
.step.is-current { border-left-color: var(--token); background: color-mix(in srgb, var(--token) 8%, transparent); }
.step.is-done { color: var(--muted); text-decoration: line-through; }
.step-path { color: var(--muted); margin-right: 6px; }

.piece { width: 190px; min-height: 64px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 7px 9px; transition: border-color .25s, box-shadow .25s, opacity .25s; position: relative; color: var(--text); font-family: var(--font); font-size: 12px; }
.piece-head { display: flex; gap: 6px; align-items: center; font-weight: 600; }
.piece-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.piece-kind { color: var(--muted); font-size: 10px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.piece-foot { display: flex; gap: 6px; align-items: center; margin-top: 5px; font-size: 10px; color: var(--muted); }
.piece-bar { height: 4px; background: var(--line); margin-top: 6px; border-radius: 2px; overflow: hidden; }
.piece-bar i { display: block; height: 100%; }
.is-focused { border-color: var(--accent); box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 45%, transparent); }
.is-highlighted { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); }
.is-dim { opacity: .35; }
.is-selected { outline: 2px solid var(--token); outline-offset: 2px; }
.is-active { animation: piece-pulse .9s ease-out 1; }
@keyframes piece-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
.change-added { border-color: var(--ok); } .change-modified { border-color: var(--strained); } .change-removed { border-style: dashed; border-color: var(--saturated); }
.scale-ok .piece-bar i { background: var(--ok); width: 25%; }
.scale-strained .piece-bar i { background: var(--strained); width: 55%; }
.scale-limit .piece-bar i { background: var(--limit); width: 80%; }
.scale-saturated .piece-bar i { background: var(--saturated); width: 100%; }
.scale-limit { border-color: var(--limit); } .scale-saturated { border-color: var(--saturated); }
.badge { border: 1px solid currentColor; border-radius: 8px; padding: 0 5px; font-size: 9px; }
.container { border: 1px dashed var(--accent); border-radius: var(--radius); background: color-mix(in srgb, var(--accent) 4%, transparent); width: 100%; height: 100%; color: var(--text); font-family: var(--font); font-size: 12px; }
.container-label { padding: 6px 10px; font-weight: 600; display: flex; gap: 6px; align-items: center; }
.group-box { border: 1px dashed var(--line); border-radius: calc(var(--radius) + 4px); width: 100%; height: 100%; }
.group-label { padding: 6px 10px; color: var(--muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; font-family: var(--font); }

.edge-line { stroke: var(--line); stroke-width: 1.5; fill: none; }
.edge-line.is-visited { stroke: color-mix(in srgb, var(--accent) 35%, var(--line)); }
.edge-line.is-active { stroke: var(--token); stroke-width: 2.5; }
.edge-line.kind-async { stroke-dasharray: 6 4; }
.edge-label { position: absolute; font-size: 10px; color: var(--muted); background: var(--bg); padding: 0 4px; pointer-events: none; white-space: nowrap; font-family: var(--font); }
.token { fill: var(--token); filter: drop-shadow(0 0 6px var(--token)); }
.token-label { fill: var(--token); font-size: 10px; font-family: var(--font); }

.callout { position: absolute; width: 280px; background: var(--panel); border: 1px solid var(--accent); border-radius: var(--radius); padding: 8px 10px; font-size: 11px; line-height: 1.4; color: var(--text); font-family: var(--font); pointer-events: all; }
.callout-path { color: var(--accent); margin-right: 6px; }
.callout-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }

.now { border: 1px solid var(--accent); background: var(--panel); padding: 8px 10px; border-radius: var(--radius); min-height: 64px; line-height: 1.4; }
.card-title { font-weight: 700; font-size: 13px; }
.muted { color: var(--muted); }
.h { color: var(--muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin: 10px 0 4px; }
.scale-row { display: grid; grid-template-columns: 96px 1fr; gap: 6px; padding: 5px 0; border-top: 1px solid var(--line); }
.status-ok { color: var(--ok); } .status-strained { color: var(--strained); } .status-limit { color: var(--limit); } .status-saturated { color: var(--saturated); }
.risk-item { display: flex; gap: 6px; align-items: flex-start; width: 100%; border: 0; background: transparent; color: var(--text); text-align: left; padding: 4px 10px; cursor: pointer; }
.risk-item .risk-dot { margin: 4px 0 0; }
.risk-item.is-selected { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.risk-card { border: 1px solid var(--accent); border-radius: var(--radius); padding: 8px 10px; line-height: 1.4; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; padding: 8px 10px; }
.chip { border: 1px solid var(--line); background: transparent; color: var(--muted); padding: 2px 8px; border-radius: 999px; cursor: pointer; font-size: 10px; }
.chip[aria-pressed='true'] { color: var(--accent); border-color: var(--accent); }

.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(460px, 70%); background: var(--panel); border-left: 1px solid var(--accent); padding: 10px 12px; z-index: 10; overflow: auto; }
.drawer pre { font-size: 11px; line-height: 1.5; white-space: pre; overflow: auto; }
.kw { color: var(--accent); }

.payload { border: 1px solid var(--line); border-radius: var(--radius); margin: 8px 10px; }
.payload-head { padding: 5px 8px; border-bottom: 1px solid var(--line); color: var(--muted); display: flex; justify-content: space-between; font-size: 10px; }
.payload pre { margin: 0; padding: 6px 8px; font-size: 11px; overflow-x: auto; }
.diff-line--added { color: var(--ok); } .diff-line--removed { color: var(--saturated); text-decoration: line-through; } .diff-line--same { color: var(--muted); }

.player { display: flex; gap: 8px; align-items: center; padding: 0 12px; height: 100%; }
.player button, .player select { border: 1px solid var(--line); background: transparent; padding: 3px 9px; border-radius: var(--radius); cursor: pointer; }
.player button:disabled { opacity: .4; cursor: default; }
.player input[type='range'] { flex: 1; accent-color: var(--accent); }
.player__counter { color: var(--muted); min-width: 150px; text-align: right; }
.canvas-loading, .canvas-error { display: grid; place-items: center; height: 100%; color: var(--muted); }
.canvas-error { color: var(--saturated); }
.react-flow__controls button { background: var(--panel); color: var(--text); border-color: var(--line); fill: var(--text); }
.react-flow__node { font-family: var(--font); }

@media (prefers-reduced-motion: reduce) {
  .is-active { animation: none; }
  .piece { transition: none; }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add workspace themes and token-based stylesheet

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Explorer state reducer and cursor resequencing

**Files:**
- Create: `apps/web/src/workspace/engine/explorerState.ts`, `apps/web/src/workspace/engine/resequence.ts`
- Test: `apps/web/test/workspace/explorerState.test.ts`, `apps/web/test/workspace/resequence.test.ts`, `apps/web/test/workspace/fixture.ts`

**Interfaces:**
- Consumes (`@rdi/scene/v2`): `Scene, Level, indexScene, ancestorsOf, findStep, descendantStepIds, stepAncestors, FlatStep`.
- Produces:
  ```ts
  type Mode = 'walkthrough' | 'risks' | 'changes'
  type ExplorerState = { sceneId: string; level: Level; localExpanded: string[]; openSteps: string[]; selectedNodeId: string | null;
                         mode: Mode; selectedRiskId: string | null; codeNodeId: string | null; scaleOverlay: boolean }
  type ExplorerAction = { type: 'loadScene'; sceneId: string; level: Level } | { type: 'setLevel'; level: Level }
    | { type: 'toggleExpand'; nodeId: string } | { type: 'toggleStep'; stepId: string } | { type: 'selectNode'; nodeId: string | null }
    | { type: 'setMode'; mode: Mode } | { type: 'selectRisk'; riskId: string | null } | { type: 'openCode'; nodeId: string }
    | { type: 'closeCode' } | { type: 'toggleScaleOverlay' }
  initialExplorerState(sceneId: string, level: Level): ExplorerState
  reduceExplorer(state: ExplorerState, action: ExplorerAction, scene: Scene): ExplorerState
  resequenceCursor(prev: FlatStep[], next: FlatStep[], cursor: number, steps: Step[]): number
  ```

- [ ] **Step 1: Test fixture for the web package**

`apps/web/test/workspace/fixture.ts` — the same scene as `packages/scene/test/v2/fixture.ts`, imported from the package so tests share it:
```ts
import { validateScene, type Scene } from '@rdi/scene/v2';

export const fixtureScene = (): Scene => {
  const result = validateScene({
    id: 'fx', title: 'Fixture', language: 'en',
    nodes: [
      { id: 'client', label: 'Client', role: 'actor', kind: 'browser', summary: 's', repo: 'web' },
      { id: 'api', label: 'API', role: 'compute', kind: 'REST', summary: 's', repo: 'svc', change: 'modified',
        scale: { low: { status: 'ok', note: 'fine' }, medium: { status: 'strained', note: 'busy' }, high: { status: 'saturated', note: 'queues' }, strategy: 'horizontal', advice: 'add instances' },
        code: { repo: 'svc', path: 'src/api.ts', startLine: 1, endLine: 3, language: 'typescript', snippet: 'export const handler = async () => {\n  return 1;\n};' } },
      { id: 'worker', label: 'Worker', role: 'compute', kind: 'jobs', summary: 's', repo: 'svc' },
      { id: 'reserve', label: 'reserve()', role: 'logic', kind: 'fn', summary: 's', parent: 'worker', complexity: { time: 'O(k)', space: 'O(1)' } },
      { id: 'lock', label: 'lock()', role: 'logic', kind: 'fn', summary: 's', parent: 'reserve' },
      { id: 'db', label: 'DB', role: 'storage', kind: 'pg', summary: 's', repo: 'svc' },
      { id: 'pay', label: 'Payments', role: 'external', kind: 'stripe', summary: 's' },
    ],
    edges: [
      { id: 'e1', from: 'client', to: 'api', kind: 'sync', label: 'POST' },
      { id: 'e2', from: 'api', to: 'worker', kind: 'async' },
      { id: 'e3', from: 'reserve', to: 'db', kind: 'write', label: 'reserve' },
      { id: 'e4', from: 'worker', to: 'pay', kind: 'calls' },
      { id: 'e5', from: 'lock', to: 'db', kind: 'read', label: 'lock' },
      { id: 'e6', from: 'reserve', to: 'lock', kind: 'calls' },
    ],
    steps: [
      { id: 's1', narration: 'call', focus: ['api'], travel: { edgeId: 'e1', payload: 'POST' }, payload: { format: 'json', after: '{ "a": 1 }' } },
      { id: 's2', narration: 'work', focus: ['worker'], travel: { edgeId: 'e2' }, expand: 'worker', substeps: [
        { id: 's2-1', narration: 'reserve', focus: ['reserve'], travel: { edgeId: 'e3' }, expand: 'reserve', substeps: [
          { id: 's2-1-1', narration: 'lock', focus: ['lock'], travel: { edgeId: 'e5' }, annotate: [{ nodeId: 'lock', text: 'one at a time' }] },
        ] },
        { id: 's2-2', narration: 'inner call', focus: ['lock'], travel: { edgeId: 'e6' } },
      ] },
      { id: 's3', narration: 'pay', focus: ['pay'], travel: { edgeId: 'e4', reverse: true } },
    ],
    risks: [
      { id: 'r1', category: 'performance', severity: 'high', title: 'contention', explanation: 'x', nodeIds: ['lock'], mitigation: 'partition' },
      { id: 'r2', category: 'security', severity: 'critical', title: 'amount', explanation: 'y', nodeIds: ['api'] },
    ],
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.scene;
};
```

- [ ] **Step 2: Write the failing tests**

`apps/web/test/workspace/explorerState.test.ts`:
```ts
import { initialExplorerState, reduceExplorer, type ExplorerState } from '../../src/workspace/engine/explorerState';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const start = (patch: Partial<ExplorerState> = {}): ExplorerState => ({ ...initialExplorerState('fx', 'architecture'), ...patch });
const run = (state: ExplorerState, ...actions: Parameters<typeof reduceExplorer>[1][]) => actions.reduce((s, a) => reduceExplorer(s, a, scene), state);

describe('reduceExplorer', () => {
  it('starts in walkthrough mode with nothing open', () => {
    expect(initialExplorerState('fx', 'components')).toEqual({
      sceneId: 'fx', level: 'components', localExpanded: [], openSteps: [], selectedNodeId: null,
      mode: 'walkthrough', selectedRiskId: null, codeNodeId: null, scaleOverlay: false,
    });
  });

  it('toggles local expansion only for nodes with children', () => {
    const s = run(start(), { type: 'toggleExpand', nodeId: 'worker' }, { type: 'toggleExpand', nodeId: 'db' });
    expect(s.localExpanded).toEqual(['worker']);
    expect(run(s, { type: 'toggleExpand', nodeId: 'worker' }).localExpanded).toEqual([]);
  });

  it('opening a step expands its node; closing removes it and its open descendants', () => {
    const opened = run(start(), { type: 'toggleStep', stepId: 's2' }, { type: 'toggleStep', stepId: 's2-1' });
    expect(opened.openSteps).toEqual(['s2', 's2-1']);
    expect(opened.localExpanded).toEqual(['worker', 'reserve']);
    const closed = run(opened, { type: 'toggleStep', stepId: 's2' });
    expect(closed.openSteps).toEqual([]);
    expect(closed.localExpanded).toEqual([]);
  });

  it('ignores toggling steps without sub-steps', () => {
    const s = start();
    expect(run(s, { type: 'toggleStep', stepId: 's1' })).toBe(s);
  });

  it('selecting a risk switches mode, leaves system level and expands ancestors of hidden pieces', () => {
    const s = run(start({ level: 'system' }), { type: 'selectRisk', riskId: 'r1' });
    expect(s).toMatchObject({ mode: 'risks', selectedRiskId: 'r1', level: 'architecture', selectedNodeId: 'lock' });
    expect(s.localExpanded.sort()).toEqual(['reserve', 'worker']);
    expect(run(s, { type: 'selectRisk', riskId: null }).selectedRiskId).toBeNull();
  });

  it('handles selection, mode, code drawer and overlay', () => {
    const s = run(start(), { type: 'selectNode', nodeId: 'api' }, { type: 'openCode', nodeId: 'api' }, { type: 'toggleScaleOverlay' }, { type: 'setMode', mode: 'changes' });
    expect(s).toMatchObject({ selectedNodeId: 'api', codeNodeId: 'api', scaleOverlay: true, mode: 'changes' });
    expect(run(s, { type: 'closeCode' }).codeNodeId).toBeNull();
  });

  it('loading a scene resets everything except the overlay', () => {
    const s = run(start({ scaleOverlay: true, openSteps: ['s2'], selectedNodeId: 'api' }), { type: 'loadScene', sceneId: 'other', level: 'detail' });
    expect(s).toEqual({ ...initialExplorerState('other', 'detail'), scaleOverlay: true });
  });

  it('changing level keeps local expansion', () => {
    const s = run(start({ localExpanded: ['worker'] }), { type: 'setLevel', level: 'detail' });
    expect(s).toMatchObject({ level: 'detail', localExpanded: ['worker'] });
  });
});
```

`apps/web/test/workspace/resequence.test.ts`:
```ts
import { flattenSteps } from '@rdi/scene/v2';
import { resequenceCursor } from '../../src/workspace/engine/resequence';
import { fixtureScene } from './fixture';

const { steps } = fixtureScene();
const flat = (open: string[]) => flattenSteps(steps, new Set(open));

describe('resequenceCursor', () => {
  it('keeps the same step when it is still in the sequence', () => {
    expect(resequenceCursor(flat([]), flat(['s2']), 2, steps)).toBe(4);
  });

  it('moves to the nearest open ancestor when the step disappears', () => {
    const before = flat(['s2', 's2-1']);
    expect(before[3]?.step.id).toBe('s2-1-1');
    expect(resequenceCursor(before, flat(['s2']), 3, steps)).toBe(2);
    expect(resequenceCursor(before, flat([]), 3, steps)).toBe(1);
  });

  it('falls back to 0 for empty or out-of-range input', () => {
    expect(resequenceCursor([], flat([]), 0, steps)).toBe(0);
    expect(resequenceCursor(flat([]), flat([]), 99, steps)).toBe(0);
    expect(resequenceCursor(flat([]), [], 1, steps)).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @rdi/web -- workspace/`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`apps/web/src/workspace/engine/explorerState.ts`:
```ts
import { ancestorsOf, descendantStepIds, findStep, indexScene, type Level, type Scene } from '@rdi/scene/v2';

export type Mode = 'walkthrough' | 'risks' | 'changes';

export type ExplorerState = {
  sceneId: string;
  level: Level;
  localExpanded: string[];
  openSteps: string[];
  selectedNodeId: string | null;
  mode: Mode;
  selectedRiskId: string | null;
  codeNodeId: string | null;
  scaleOverlay: boolean;
};

export type ExplorerAction =
  | { type: 'loadScene'; sceneId: string; level: Level }
  | { type: 'setLevel'; level: Level }
  | { type: 'toggleExpand'; nodeId: string }
  | { type: 'toggleStep'; stepId: string }
  | { type: 'selectNode'; nodeId: string | null }
  | { type: 'setMode'; mode: Mode }
  | { type: 'selectRisk'; riskId: string | null }
  | { type: 'openCode'; nodeId: string }
  | { type: 'closeCode' }
  | { type: 'toggleScaleOverlay' };

export const initialExplorerState = (sceneId: string, level: Level): ExplorerState => ({
  sceneId, level, localExpanded: [], openSteps: [], selectedNodeId: null, mode: 'walkthrough', selectedRiskId: null, codeNodeId: null, scaleOverlay: false,
});

const withItem = (list: string[], item: string) => (list.includes(item) ? list : [...list, item]);
const without = (list: string[], remove: Set<string>) => list.filter((item) => !remove.has(item));

const toggleStep = (state: ExplorerState, stepId: string, scene: Scene): ExplorerState => {
  const step = findStep(scene.steps, stepId);
  if (!step || step.substeps.length === 0) return state;
  if (!state.openSteps.includes(stepId)) {
    return {
      ...state,
      openSteps: [...state.openSteps, stepId],
      localExpanded: step.expand ? withItem(state.localExpanded, step.expand) : state.localExpanded,
    };
  }
  const closing = new Set([stepId, ...descendantStepIds(step)]);
  const collapsing = new Set([...closing].flatMap((id) => findStep(scene.steps, id)?.expand ?? []));
  return { ...state, openSteps: without(state.openSteps, closing), localExpanded: without(state.localExpanded, collapsing) };
};

const selectRisk = (state: ExplorerState, riskId: string | null, scene: Scene): ExplorerState => {
  if (riskId === null) return { ...state, selectedRiskId: null };
  const risk = scene.risks.find((r) => r.id === riskId);
  if (!risk) return state;
  const index = indexScene(scene);
  const expand = risk.nodeIds.flatMap((id) => ancestorsOf(index, id));
  return {
    ...state,
    mode: 'risks',
    selectedRiskId: riskId,
    selectedNodeId: risk.nodeIds[0] ?? null,
    level: state.level === 'system' ? 'architecture' : state.level,
    localExpanded: expand.reduce(withItem, state.localExpanded),
  };
};

export const reduceExplorer = (state: ExplorerState, action: ExplorerAction, scene: Scene): ExplorerState => {
  switch (action.type) {
    case 'loadScene':
      return { ...initialExplorerState(action.sceneId, action.level), scaleOverlay: state.scaleOverlay };
    case 'setLevel':
      return { ...state, level: action.level };
    case 'toggleExpand': {
      const index = indexScene(scene);
      if ((index.children.get(action.nodeId)?.length ?? 0) === 0) return state;
      return state.localExpanded.includes(action.nodeId)
        ? { ...state, localExpanded: without(state.localExpanded, new Set([action.nodeId])) }
        : { ...state, localExpanded: [...state.localExpanded, action.nodeId] };
    }
    case 'toggleStep':
      return toggleStep(state, action.stepId, scene);
    case 'selectNode':
      return { ...state, selectedNodeId: action.nodeId };
    case 'setMode':
      return { ...state, mode: action.mode };
    case 'selectRisk':
      return selectRisk(state, action.riskId, scene);
    case 'openCode':
      return { ...state, codeNodeId: action.nodeId };
    case 'closeCode':
      return { ...state, codeNodeId: null };
    case 'toggleScaleOverlay':
      return { ...state, scaleOverlay: !state.scaleOverlay };
  }
};
```

`apps/web/src/workspace/engine/resequence.ts`:
```ts
import { stepAncestors, type FlatStep, type Step } from '@rdi/scene/v2';

export const resequenceCursor = (prev: FlatStep[], next: FlatStep[], cursor: number, steps: Step[]): number => {
  const current = prev[cursor]?.step.id;
  if (!current || next.length === 0) return 0;
  const indexOf = (id: string) => next.findIndex((f) => f.step.id === id);
  const direct = indexOf(current);
  if (direct >= 0) return direct;
  const ancestor = stepAncestors(steps, current).map(indexOf).find((i) => i >= 0);
  return ancestor ?? 0;
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add explorer state reducer and cursor resequencing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Frame projection, step phase and risk helpers

**Files:**
- Create: `apps/web/src/workspace/engine/frame.ts`, `apps/web/src/workspace/engine/phase.ts`, `apps/web/src/workspace/engine/risks.ts`
- Test: `apps/web/test/workspace/frame.test.ts`, `apps/web/test/workspace/risks.test.ts`

**Interfaces:**
- Consumes: `Scene, SceneRisk, Severity, ScaleStatus, SceneNode, SceneIndex, VisibleModel, ProjectedEdges, FlatStep, descendantsOf` (package), `fixtureScene` (Task 7).
- Produces:
  ```ts
  // frame.ts
  type ActiveEdge = { key: string; reverse: boolean; label: string | null }
  type Frame = { flat: FlatStep | null; index: number; focused: Set<string>; highlighted: Set<string>; active: ActiveEdge | null;
                 visited: Set<string>; annotations: Map<string, string> }
  frameAt(model: VisibleModel, projected: ProjectedEdges, flat: FlatStep[], cursor: number): Frame
  // phase.ts
  TRAVEL_FRACTION = 0.55
  type Phase = { tokenProgress: number | null; activated: boolean }
  stepPhase(progress: number, hasTravel: boolean): Phase
  // risks.ts
  severityRank(s: Severity): number; statusRank(s: ScaleStatus): number
  risksByNode(scene: Scene): Map<string, SceneRisk[]>
  maxSeverity(risks: SceneRisk[]): Severity | undefined
  worstScale(node: SceneNode): ScaleStatus | undefined
  aggregateSeverity(index: SceneIndex, byNode: Map<string, SceneRisk[]>, ids: string[]): Severity | undefined   // ids + their descendants
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/workspace/frame.test.ts`:
```ts
import { computeVisible, flattenSteps, indexScene, projectEdges } from '@rdi/scene/v2';
import { frameAt } from '../../src/workspace/engine/frame';
import { stepPhase, TRAVEL_FRACTION } from '../../src/workspace/engine/phase';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const setup = (level: Parameters<typeof computeVisible>[2], open: string[], local: string[] = []) => {
  const model = computeVisible(scene, index, level, new Set(local));
  return { model, projected: projectEdges(scene, model), flat: flattenSteps(scene.steps, new Set(open)) };
};

describe('frameAt', () => {
  it('projects focus, active edge and visited edges', () => {
    const { model, projected, flat } = setup('architecture', []);
    const f = frameAt(model, projected, flat, 1);
    expect([...f.focused]).toEqual(['worker']);
    expect(f.active).toEqual({ key: 'api->worker', reverse: false, label: null });
    expect([...f.visited]).toEqual(['client->api']);
  });

  it('projects internal focus onto the visible ancestor and keeps annotations', () => {
    const { model, projected, flat } = setup('architecture', ['s2', 's2-1'], ['reserve']);
    const f = frameAt(model, projected, flat, 3);
    expect(f.flat?.step.id).toBe('s2-1-1');
    expect([...f.focused]).toEqual(['lock']);
    expect(f.active?.key).toBe('lock->db');
    expect(f.annotations.get('lock')).toBe('one at a time');
  });

  it('has no active edge when the travel edge collapses inside one piece', () => {
    const { model, projected, flat } = setup('architecture', ['s2']);
    const f = frameAt(model, projected, flat, 3);
    expect(f.flat?.step.id).toBe('s2-2');
    expect(f.active).toBeNull();
    expect([...f.focused]).toEqual(['worker']);
  });

  it('keeps the reverse flag and clamps the cursor', () => {
    const { model, projected, flat } = setup('architecture', []);
    expect(frameAt(model, projected, flat, 99).active).toEqual({ key: 'worker->pay', reverse: true, label: null });
  });

  it('returns an empty frame without steps', () => {
    const { model, projected } = setup('architecture', []);
    expect(frameAt(model, projected, [], 0)).toMatchObject({ flat: null, active: null, index: 0 });
  });
});

describe('stepPhase', () => {
  it('travels first, then activates', () => {
    expect(stepPhase(0, true)).toEqual({ tokenProgress: 0, activated: false });
    expect(stepPhase(TRAVEL_FRACTION / 2, true).tokenProgress).toBeCloseTo(0.5);
    expect(stepPhase(TRAVEL_FRACTION, true)).toEqual({ tokenProgress: null, activated: true });
    expect(stepPhase(0, false)).toEqual({ tokenProgress: null, activated: true });
  });
});
```

`apps/web/test/workspace/risks.test.ts`:
```ts
import { indexScene } from '@rdi/scene/v2';
import { aggregateSeverity, maxSeverity, risksByNode, worstScale } from '../../src/workspace/engine/risks';
import { fixtureScene } from './fixture';

const scene = fixtureScene();

describe('risk helpers', () => {
  it('indexes risks by node and ranks severity', () => {
    const byNode = risksByNode(scene);
    expect(byNode.get('lock')?.map((r) => r.id)).toEqual(['r1']);
    expect(maxSeverity([...byNode.get('lock')!, ...byNode.get('api')!])).toBe('critical');
    expect(maxSeverity([])).toBeUndefined();
  });

  it('aggregates severity over descendants', () => {
    const byNode = risksByNode(scene);
    const index = indexScene(scene);
    expect(aggregateSeverity(index, byNode, ['worker'])).toBe('high');
    expect(aggregateSeverity(index, byNode, ['db'])).toBeUndefined();
  });

  it('returns the worst scale status of a node', () => {
    expect(worstScale(scene.nodes.find((n) => n.id === 'api')!)).toBe('saturated');
    expect(worstScale(scene.nodes.find((n) => n.id === 'db')!)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- workspace/frame workspace/risks`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/workspace/engine/phase.ts`:
```ts
export const TRAVEL_FRACTION = 0.55;

export type Phase = { tokenProgress: number | null; activated: boolean };

export const stepPhase = (progress: number, hasTravel: boolean): Phase =>
  hasTravel && progress < TRAVEL_FRACTION
    ? { tokenProgress: Math.max(0, progress) / TRAVEL_FRACTION, activated: false }
    : { tokenProgress: null, activated: true };
```

`apps/web/src/workspace/engine/frame.ts`:
```ts
import type { FlatStep, ProjectedEdges, VisibleModel } from '@rdi/scene/v2';

export type ActiveEdge = { key: string; reverse: boolean; label: string | null };

export type Frame = {
  flat: FlatStep | null;
  index: number;
  focused: Set<string>;
  highlighted: Set<string>;
  active: ActiveEdge | null;
  visited: Set<string>;
  annotations: Map<string, string>;
};

const ANNOTATION_SEPARATOR = ' · ';

const emptyFrame = (): Frame => ({ flat: null, index: 0, focused: new Set(), highlighted: new Set(), active: null, visited: new Set(), annotations: new Map() });

export const frameAt = (model: VisibleModel, projected: ProjectedEdges, flat: FlatStep[], cursor: number): Frame => {
  if (flat.length === 0) return emptyFrame();
  const index = Math.min(Math.max(cursor, 0), flat.length - 1);
  const current = flat[index] as FlatStep;
  const project = (id: string) => model.representative.get(id) ?? id;
  const { step } = current;

  const annotations = new Map<string, string>();
  step.annotate.forEach(({ nodeId, text }) => {
    const target = project(nodeId);
    const existing = annotations.get(target);
    annotations.set(target, existing ? `${existing}${ANNOTATION_SEPARATOR}${text}` : text);
  });

  const key = step.travel ? projected.keyOf.get(step.travel.edgeId) : undefined;
  const visited = new Set(
    flat.slice(0, index).flatMap((f) => {
      const k = f.step.travel ? projected.keyOf.get(f.step.travel.edgeId) : undefined;
      return k ? [k] : [];
    }),
  );

  return {
    flat: current,
    index,
    focused: new Set(step.focus.map(project)),
    highlighted: new Set(step.highlight.map(project)),
    active: key && step.travel ? { key, reverse: step.travel.reverse, label: step.travel.payload ?? null } : null,
    visited,
    annotations,
  };
};
```

`apps/web/src/workspace/engine/risks.ts`:
```ts
import { descendantsOf, SCALE_STATUSES, SEVERITIES, type ScaleStatus, type Scene, type SceneIndex, type SceneNode, type SceneRisk, type Severity } from '@rdi/scene/v2';

export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s);
export const statusRank = (s: ScaleStatus): number => SCALE_STATUSES.indexOf(s);

export const risksByNode = (scene: Scene): Map<string, SceneRisk[]> => {
  const result = new Map<string, SceneRisk[]>();
  scene.risks.forEach((risk) => risk.nodeIds.forEach((id) => result.set(id, [...(result.get(id) ?? []), risk])));
  return result;
};

export const maxSeverity = (risks: SceneRisk[]): Severity | undefined =>
  risks.reduce<Severity | undefined>((max, r) => (max === undefined || severityRank(r.severity) > severityRank(max) ? r.severity : max), undefined);

export const worstScale = (node: SceneNode): ScaleStatus | undefined => {
  if (!node.scale) return undefined;
  return [node.scale.low.status, node.scale.medium.status, node.scale.high.status].reduce((a, b) => (statusRank(b) > statusRank(a) ? b : a));
};

export const aggregateSeverity = (index: SceneIndex, byNode: Map<string, SceneRisk[]>, ids: string[]): Severity | undefined =>
  maxSeverity(ids.flatMap((id) => [id, ...descendantsOf(index, id)]).flatMap((id) => byNode.get(id) ?? []));
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add frame projection, step phase and risk helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Floating-edge geometry and hierarchical layout

**Files:**
- Create: `apps/web/src/workspace/canvas/floating.ts`, `apps/web/src/workspace/canvas/layout.ts`
- Test: `apps/web/test/workspace/floating.test.ts`, `apps/web/test/workspace/layout.test.ts`

**Interfaces:**
- Consumes: `Scene, SceneIndex, VisibleModel, ProjectedEdge, topLevelGroups` (package).
- Produces:
  ```ts
  // floating.ts
  type Point = { x: number; y: number }; type Rect = { x: number; y: number; width: number; height: number }
  rectCenter(r: Rect): Point
  borderIntersection(r: Rect, toward: Point): Point
  floatingEdgePoints(source: Rect, target: Rect): { sx: number; sy: number; tx: number; ty: number }
  pointAlong(sx: number, sy: number, tx: number, ty: number, t: number): Point
  // layout.ts
  PIECE_WIDTH = 190; PIECE_HEIGHT = 64
  type BoxKind = 'group' | 'repoBox' | 'container' | 'piece'
  type LayoutBox = Rect & { parent: string | null; kind: BoxKind; label?: string }
  type SceneLayout = { boxes: Map<string, LayoutBox>; order: string[] }   // order = parents before children
  layoutSignature(sceneId: string, model: VisibleModel): string
  layoutScene(scene: Scene, index: SceneIndex, model: VisibleModel, edges: ProjectedEdge[]): Promise<SceneLayout>
  absoluteRect(layout: SceneLayout, id: string): Rect | null
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/workspace/floating.test.ts`:
```ts
import { borderIntersection, floatingEdgePoints, pointAlong } from '../../src/workspace/canvas/floating';

const box = (x: number, y: number) => ({ x, y, width: 100, height: 50 });

describe('floating edge geometry', () => {
  it('connects horizontal neighbours on their facing borders', () => {
    expect(floatingEdgePoints(box(0, 0), box(200, 0))).toEqual({ sx: 100, sy: 25, tx: 200, ty: 25 });
  });

  it('connects vertical neighbours on top and bottom borders', () => {
    expect(floatingEdgePoints(box(0, 0), box(0, 200))).toEqual({ sx: 50, sy: 50, tx: 50, ty: 200 });
  });

  it('exits through the correct border on diagonals', () => {
    const p = borderIntersection(box(0, 0), { x: 250, y: 125 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(45);
  });

  it('returns the center when the target point is the center', () => {
    expect(borderIntersection(box(0, 0), { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });

  it('interpolates along a segment', () => {
    expect(pointAlong(0, 0, 100, 50, 0.5)).toEqual({ x: 50, y: 25 });
  });
});
```

`apps/web/test/workspace/layout.test.ts`:
```ts
// @vitest-environment node
import { computeVisible, indexScene, projectEdges } from '@rdi/scene/v2';
import { absoluteRect, layoutScene, layoutSignature, PIECE_HEIGHT, PIECE_WIDTH } from '../../src/workspace/canvas/layout';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const run = async (level: Parameters<typeof computeVisible>[2]) => {
  const model = computeVisible(scene, index, level, new Set());
  return { model, layout: await layoutScene(scene, index, model, projectEdges(scene, model).edges) };
};

describe('layoutScene', () => {
  it('nests repo groups, containers and pieces with parents first', async () => {
    const { layout } = await run('components');
    expect(layout.boxes.get('group:svc')).toMatchObject({ kind: 'group', parent: null, label: 'svc' });
    expect(layout.boxes.get('worker')).toMatchObject({ kind: 'container', parent: 'group:svc' });
    expect(layout.boxes.get('reserve')).toMatchObject({ kind: 'piece', parent: 'worker', width: PIECE_WIDTH, height: PIECE_HEIGHT });
    expect(layout.boxes.get('pay')).toMatchObject({ kind: 'piece', parent: null });
    expect(layout.order.indexOf('group:svc')).toBeLessThan(layout.order.indexOf('worker'));
    expect(layout.order.indexOf('worker')).toBeLessThan(layout.order.indexOf('reserve'));
    expect(layout.boxes.get('worker')!.width).toBeGreaterThan(PIECE_WIDTH);
  });

  it('lays out left to right in absolute coordinates', async () => {
    const { layout } = await run('architecture');
    expect(absoluteRect(layout, 'client')!.x).toBeLessThan(absoluteRect(layout, 'api')!.x);
    expect(absoluteRect(layout, 'api')!.x).toBeLessThan(absoluteRect(layout, 'worker')!.x);
    expect(absoluteRect(layout, 'ghost')).toBeNull();
  });

  it('draws repo boxes at system level without groups', async () => {
    const { layout } = await run('system');
    expect(layout.boxes.get('repo:svc')).toMatchObject({ kind: 'repoBox', parent: null, label: 'svc' });
    expect([...layout.boxes.values()].some((b) => b.kind === 'group')).toBe(false);
  });

  it('produces a signature that changes with level and expansion', () => {
    const a = layoutSignature('fx', computeVisible(scene, index, 'architecture', new Set()));
    const b = layoutSignature('fx', computeVisible(scene, index, 'architecture', new Set(['worker'])));
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- workspace/floating workspace/layout`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement geometry**

`apps/web/src/workspace/canvas/floating.ts`:
```ts
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const rectCenter = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const borderIntersection = (r: Rect, toward: Point): Point => {
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : r.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : r.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
};

export const floatingEdgePoints = (source: Rect, target: Rect) => {
  const s = borderIntersection(source, rectCenter(target));
  const t = borderIntersection(target, rectCenter(source));
  return { sx: s.x, sy: s.y, tx: t.x, ty: t.y };
};

export const pointAlong = (sx: number, sy: number, tx: number, ty: number, t: number): Point => ({ x: sx + (tx - sx) * t, y: sy + (ty - sy) * t });
```

- [ ] **Step 4: Implement layout**

`apps/web/src/workspace/canvas/layout.ts`:
```ts
import { topLevelGroups, type ProjectedEdge, type Scene, type SceneIndex, type VisibleModel } from '@rdi/scene/v2';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Rect } from './floating';

export const PIECE_WIDTH = 190;
export const PIECE_HEIGHT = 64;
const REPO_PREFIX = 'repo:';

export type BoxKind = 'group' | 'repoBox' | 'container' | 'piece';
export type LayoutBox = Rect & { parent: string | null; kind: BoxKind; label?: string };
export type SceneLayout = { boxes: Map<string, LayoutBox>; order: string[] };

const elk = new ELK();

const ROOT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': '36',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
};
const COMPOUND_OPTIONS = { 'elk.padding': '[top=40,left=18,bottom=18,right=18]' };

export const layoutSignature = (sceneId: string, model: VisibleModel): string =>
  `${sceneId}|${model.level}|${[...model.expanded].sort().join(',')}`;

export const layoutScene = async (scene: Scene, index: SceneIndex, model: VisibleModel, edges: ProjectedEdge[]): Promise<SceneLayout> => {
  const kinds = new Map<string, { kind: BoxKind; label?: string }>();
  const leaf = (id: string, kind: BoxKind, label?: string): ElkNode => {
    kinds.set(id, { kind, label });
    return { id, width: PIECE_WIDTH, height: PIECE_HEIGHT };
  };
  const build = (id: string): ElkNode => {
    if (!model.expanded.has(id)) return leaf(id, 'piece');
    kinds.set(id, { kind: 'container' });
    const children = (index.children.get(id) ?? []).filter((c) => model.visible.has(c)).map(build);
    return { id, layoutOptions: COMPOUND_OPTIONS, children };
  };

  let rootChildren: ElkNode[];
  if (model.level === 'system') {
    rootChildren = [
      ...[...model.repoBoxes.keys()].map((box) => leaf(box, 'repoBox', box.slice(REPO_PREFIX.length))),
      ...index.topLevel.filter((id) => model.visible.has(id)).map(build),
    ];
  } else {
    const visibleTop = index.topLevel.filter((id) => model.visible.has(id));
    const groups = topLevelGroups(scene, visibleTop);
    const grouped = new Set(groups.flatMap((g) => g.nodeIds));
    rootChildren = [
      ...groups.map((g) => {
        kinds.set(g.id, { kind: 'group', label: g.label });
        return { id: g.id, layoutOptions: COMPOUND_OPTIONS, children: g.nodeIds.map(build) };
      }),
      ...visibleTop.filter((id) => !grouped.has(id)).map(build),
    ];
  }

  const result = await elk.layout({
    id: 'root',
    layoutOptions: ROOT_OPTIONS,
    children: rootChildren,
    edges: edges.map((e) => ({ id: e.key, sources: [e.from], targets: [e.to] })),
  });

  const boxes = new Map<string, LayoutBox>();
  const order: string[] = [];
  const walk = (node: ElkNode, parent: string | null) => {
    const meta = kinds.get(node.id);
    if (meta) {
      boxes.set(node.id, {
        x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? PIECE_WIDTH, height: node.height ?? PIECE_HEIGHT,
        parent, kind: meta.kind, ...(meta.label ? { label: meta.label } : {}),
      });
      order.push(node.id);
    }
    (node.children ?? []).forEach((child) => walk(child, meta ? node.id : parent));
  };
  (result.children ?? []).forEach((child) => walk(child, null));
  return { boxes, order };
};

export const absoluteRect = (layout: SceneLayout, id: string): Rect | null => {
  const box = layout.boxes.get(id);
  if (!box) return null;
  const parent = box.parent ? absoluteRect(layout, box.parent) : null;
  return { x: box.x + (parent?.x ?? 0), y: box.y + (parent?.y ?? 0), width: box.width, height: box.height };
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add floating-edge geometry and hierarchical ELK layout

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Canvas — mapper, pieces, containers, floating edges, callout

**Files:**
- Create: `apps/web/src/workspace/canvas/glyphs.ts`, `toFlow.ts`, `PieceNode.tsx`, `ContainerNode.tsx`, `GroupBox.tsx`, `FlowEdge.tsx`, `Callout.tsx`, `useSceneLayout.ts`, `Canvas.tsx`
- Test: `apps/web/test/workspace/toFlow.test.ts`, `apps/web/test/workspace/PieceNode.test.tsx`, `apps/web/test/workspace/useSceneLayout.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 7, 8, 9; `useI18n` (Task 5).
- Produces:
  ```ts
  // glyphs.ts
  ROLE_GLYPHS: Record<Role, string>; REPO_GLYPH = '▣'
  // toFlow.ts
  type PieceState = 'normal' | 'focused' | 'highlighted' | 'dim'
  type PieceData = { id: string; label: string; kindLabel: string; glyph: string; state: PieceState; active: boolean; selected: boolean;
                     change?: Change; scaleWorst?: ScaleStatus; severity?: Severity; hiddenChildren: number; annotation?: string }
  type ContainerData = Omit<PieceData, 'hiddenChildren' | 'scaleWorst' | 'annotation'>
  type GroupData = { label: string }
  type FlowEdgeData = { kind: EdgeKind; label?: string; active: boolean; visited: boolean; reverse: boolean; tokenProgress: number | null; tokenLabel: string | null }
  type ToFlowInput = { scene; index; model; projected; layout; frame; phase; mode: Mode; selectedNodeId: string | null; selectedRisk: SceneRisk | null; scaleOverlay: boolean; byNode: Map<string, SceneRisk[]> }
  toFlow(input: ToFlowInput): { nodes: Node[]; edges: Edge[] }   // node types 'piece' | 'container' | 'group-box'; edge type 'flow'
  // useSceneLayout.ts
  useSceneLayout(signature: string, compute: () => Promise<SceneLayout>): { layout: SceneLayout | null; error: string | null }
  // Canvas.tsx
  <Canvas scene index model projected frame phase explorer={ExplorerState} byNode onSelect(id) onToggleExpand(id) onOpenCode(id) onOpenStep(stepId) onSelectRisk(id) />
  ```
- DOM contract: piece/container roots `data-testid="node-<id>"` with state classes; group root `data-testid="group-<id>"`; token `<g data-testid="edge-token">`; callout `data-testid="callout"` with buttons `callout-open`, `callout-code`, `callout-risks`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/workspace/toFlow.test.ts`:
```ts
import { computeVisible, flattenSteps, indexScene, projectEdges } from '@rdi/scene/v2';
import { layoutScene } from '../../src/workspace/canvas/layout';
import { toFlow, type ContainerData, type FlowEdgeData, type PieceData } from '../../src/workspace/canvas/toFlow';
import { frameAt } from '../../src/workspace/engine/frame';
import { stepPhase } from '../../src/workspace/engine/phase';
import { risksByNode } from '../../src/workspace/engine/risks';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const byNode = risksByNode(scene);

const build = async (opts: { level?: Parameters<typeof computeVisible>[2]; cursor?: number; progress?: number; mode?: 'walkthrough' | 'risks' | 'changes'; riskId?: string; overlay?: boolean; selected?: string | null } = {}) => {
  const model = computeVisible(scene, index, opts.level ?? 'architecture', new Set());
  const projected = projectEdges(scene, model);
  const layout = await layoutScene(scene, index, model, projected.edges);
  const frame = frameAt(model, projected, flattenSteps(scene.steps, new Set()), opts.cursor ?? 0);
  return toFlow({
    scene, index, model, projected, layout, frame, phase: stepPhase(opts.progress ?? 0, frame.active !== null),
    mode: opts.mode ?? 'walkthrough', selectedNodeId: opts.selected ?? null,
    selectedRisk: scene.risks.find((r) => r.id === opts.riskId) ?? null, scaleOverlay: opts.overlay ?? false, byNode,
  });
};
const data = (nodes: Awaited<ReturnType<typeof build>>['nodes'], id: string) => nodes.find((n) => n.id === id)!.data as PieceData;

describe('toFlow', () => {
  it('emits groups before children with parent links and node types', async () => {
    const { nodes } = await build({ level: 'components' });
    const ids = nodes.map((n) => n.id);
    expect(ids.indexOf('group:svc')).toBeLessThan(ids.indexOf('worker'));
    expect(nodes.find((n) => n.id === 'worker')).toMatchObject({ type: 'container', parentId: 'group:svc', extent: 'parent' });
    expect(nodes.find((n) => n.id === 'reserve')).toMatchObject({ type: 'piece', parentId: 'worker' });
    expect(nodes.find((n) => n.id === 'group:svc')!.type).toBe('group-box');
  });

  it('marks focus, dimming, activation and the travelling token', async () => {
    const travelling = await build({ cursor: 0, progress: 0.2 });
    expect(data(travelling.nodes, 'api')).toMatchObject({ state: 'focused', active: false });
    expect(data(travelling.nodes, 'db').state).toBe('dim');
    const edge = travelling.edges.find((e) => e.id === 'client->api')!.data as FlowEdgeData;
    expect(edge).toMatchObject({ active: true, tokenLabel: 'POST' });
    expect(edge.tokenProgress).toBeCloseTo(0.2 / 0.55);
    const arrived = await build({ cursor: 0, progress: 0.9 });
    expect(data(arrived.nodes, 'api').active).toBe(true);
    expect((arrived.edges.find((e) => e.id === 'client->api')!.data as FlowEdgeData).tokenProgress).toBeNull();
  });

  it('aggregates risk severity and hidden children on collapsed pieces', async () => {
    const { nodes } = await build();
    expect(data(nodes, 'worker')).toMatchObject({ severity: 'high', hiddenChildren: 2 });
    expect(data(nodes, 'api').severity).toBe('critical');
  });

  it('highlights risk pieces in risks mode and changed pieces in changes mode', async () => {
    const risks = await build({ mode: 'risks', riskId: 'r1' });
    expect(data(risks.nodes, 'worker').state).toBe('focused');
    expect(data(risks.nodes, 'api').state).toBe('dim');
    const changes = await build({ mode: 'changes' });
    expect(data(changes.nodes, 'api')).toMatchObject({ state: 'normal', change: 'modified' });
    expect(data(changes.nodes, 'db').state).toBe('dim');
  });

  it('exposes scale only with the overlay and marks selection through representatives', async () => {
    expect(data((await build()).nodes, 'api').scaleWorst).toBeUndefined();
    const withOverlay = await build({ overlay: true, selected: 'lock' });
    expect(data(withOverlay.nodes, 'api').scaleWorst).toBe('saturated');
    expect(data(withOverlay.nodes, 'worker').selected).toBe(true);
  });

  it('renders repo boxes at system level', async () => {
    const { nodes, edges } = await build({ level: 'system' });
    expect(data(nodes, 'repo:svc')).toMatchObject({ glyph: '▣', label: 'svc', hiddenChildren: 3 });
    expect(edges.map((e) => e.id)).toEqual(['repo:web->repo:svc', 'repo:svc->pay']);
    expect((nodes.find((n) => n.id === 'repo:svc')!.data as ContainerData).severity).toBe('critical');
  });
});
```

`apps/web/test/workspace/PieceNode.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { PieceNode } from '../../src/workspace/canvas/PieceNode';
import type { PieceData } from '../../src/workspace/canvas/toFlow';

const base: PieceData = { id: 'api', label: 'Orders API', kindLabel: 'REST API', glyph: '⚙', state: 'normal', active: false, selected: false, hiddenChildren: 0 };
const renderPiece = (data: PieceData) =>
  render(
    <I18nProvider initialLanguage="en">
      <ReactFlowProvider>
        <PieceNode {...({ id: data.id, data } as unknown as NodeProps)} />
      </ReactFlowProvider>
    </I18nProvider>,
  );

describe('PieceNode', () => {
  it('renders label, kind and state classes', () => {
    renderPiece({ ...base, state: 'focused', active: true, selected: true });
    const el = screen.getByTestId('node-api');
    expect(el).toHaveClass('piece', 'is-focused', 'is-active', 'is-selected');
    expect(el).toHaveTextContent('Orders API');
    expect(el).toHaveTextContent('REST API');
  });

  it('shows change badge, risk dot, hidden children, scale bar and annotation', () => {
    renderPiece({ ...base, change: 'added', severity: 'critical', hiddenChildren: 3, scaleWorst: 'saturated', annotation: 'one at a time' });
    const el = screen.getByTestId('node-api');
    expect(el).toHaveClass('change-added', 'scale-saturated');
    expect(el.querySelector('.risk-dot.sev-critical')).not.toBeNull();
    expect(el).toHaveTextContent('3 inside');
    expect(el).toHaveTextContent('added');
    expect(el.querySelector('.piece-bar')).not.toBeNull();
    expect(screen.getByText('one at a time')).toBeInTheDocument();
  });
});
```

`apps/web/test/workspace/useSceneLayout.test.ts`:
```ts
import { renderHook, waitFor } from '@testing-library/react';
import { useSceneLayout } from '../../src/workspace/canvas/useSceneLayout';

describe('useSceneLayout', () => {
  it('resolves the layout for the current signature', async () => {
    const layout = { boxes: new Map(), order: [] };
    const { result } = renderHook(() => useSceneLayout('a', () => Promise.resolve(layout)));
    expect(result.current).toEqual({ layout: null, error: null });
    await waitFor(() => expect(result.current.layout).toBe(layout));
  });

  it('surfaces failures', async () => {
    const { result } = renderHook(() => useSceneLayout('b', () => Promise.reject(new Error('elk exploded'))));
    await waitFor(() => expect(result.current).toEqual({ layout: null, error: 'elk exploded' }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- workspace/toFlow workspace/PieceNode workspace/useSceneLayout`
Expected: FAIL — modules not found.

- [ ] **Step 3: Glyphs and mapper**

`apps/web/src/workspace/canvas/glyphs.ts`:
```ts
import type { Role } from '@rdi/scene/v2';

export const ROLE_GLYPHS: Record<Role, string> = { actor: '🖥', compute: '⚙', storage: '🛢', channel: '☰', external: '☁', logic: 'ƒ', data: '{}' };
export const REPO_GLYPH = '▣';
```

`apps/web/src/workspace/canvas/toFlow.ts`:
```ts
import {
  descendantsOf, type Change, type EdgeKind, type ProjectedEdges, type ScaleStatus, type Scene, type SceneIndex, type SceneRisk, type Severity, type VisibleModel,
} from '@rdi/scene/v2';
import type { Edge, Node } from '@xyflow/react';
import type { Mode } from '../engine/explorerState';
import type { Frame } from '../engine/frame';
import type { Phase } from '../engine/phase';
import { aggregateSeverity, statusRank, worstScale } from '../engine/risks';
import { REPO_GLYPH, ROLE_GLYPHS } from './glyphs';
import type { SceneLayout } from './layout';

export type PieceState = 'normal' | 'focused' | 'highlighted' | 'dim';

export type PieceData = {
  id: string; label: string; kindLabel: string; glyph: string; state: PieceState; active: boolean; selected: boolean;
  change?: Change; scaleWorst?: ScaleStatus; severity?: Severity; hiddenChildren: number; annotation?: string;
};
export type ContainerData = Omit<PieceData, 'hiddenChildren' | 'scaleWorst' | 'annotation'>;
export type GroupData = { label: string };
export type FlowEdgeData = { kind: EdgeKind; label?: string; active: boolean; visited: boolean; reverse: boolean; tokenProgress: number | null; tokenLabel: string | null };

export type ToFlowInput = {
  scene: Scene; index: SceneIndex; model: VisibleModel; projected: ProjectedEdges; layout: SceneLayout; frame: Frame; phase: Phase;
  mode: Mode; selectedNodeId: string | null; selectedRisk: SceneRisk | null; scaleOverlay: boolean; byNode: Map<string, SceneRisk[]>;
};

const membersOf = (model: VisibleModel, id: string) => model.repoBoxes.get(id) ?? [id];

const pieceState = (id: string, input: ToFlowInput, covered: string[]): PieceState => {
  const { mode, selectedRisk, frame, model } = input;
  if (mode === 'risks' && selectedRisk) {
    const reps = new Set(selectedRisk.nodeIds.map((n) => model.representative.get(n)));
    return reps.has(id) ? 'focused' : 'dim';
  }
  if (mode === 'changes') return covered.some((n) => input.index.byId.get(n)?.change) ? 'normal' : 'dim';
  if (frame.focused.has(id)) return 'focused';
  if (frame.highlighted.has(id)) return 'highlighted';
  return frame.focused.size > 0 ? 'dim' : 'normal';
};

const worstOf = (statuses: (ScaleStatus | undefined)[]): ScaleStatus | undefined =>
  statuses.filter((s): s is ScaleStatus => s !== undefined).reduce<ScaleStatus | undefined>((a, b) => (a === undefined || statusRank(b) > statusRank(a) ? b : a), undefined);

export const toFlow = (input: ToFlowInput): { nodes: Node[]; edges: Edge[] } => {
  const { index, model, projected, layout, frame, phase, mode, selectedNodeId, scaleOverlay, byNode } = input;
  const selected = selectedNodeId ? model.representative.get(selectedNodeId) ?? selectedNodeId : null;

  const nodes: Node[] = layout.order.map((id) => {
    const box = layout.boxes.get(id)!;
    const position = { x: box.x, y: box.y };
    const parent = box.parent ? { parentId: box.parent, extent: 'parent' as const } : {};
    const size = { width: box.width, height: box.height };
    if (box.kind === 'group') {
      return { id, type: 'group-box', position, data: { label: box.label ?? id } satisfies GroupData, style: size, selectable: false, draggable: false, ...parent };
    }
    const members = membersOf(model, id);
    const covered = members.flatMap((m) => [m, ...descendantsOf(index, m)]);
    const node = index.byId.get(id);
    const common = {
      id,
      label: box.kind === 'repoBox' ? box.label ?? id : node?.label ?? id,
      kindLabel: box.kind === 'repoBox' ? members.map((m) => index.byId.get(m)?.label ?? m).join(' · ') : node?.kind ?? '',
      glyph: box.kind === 'repoBox' ? REPO_GLYPH : node ? ROLE_GLYPHS[node.role] : REPO_GLYPH,
      state: pieceState(id, input, covered),
      active: mode === 'walkthrough' && phase.activated && frame.focused.has(id),
      selected: selected === id,
      change: covered.map((n) => index.byId.get(n)?.change).find((c) => c !== undefined),
      severity: aggregateSeverity(index, byNode, members),
    };
    if (box.kind === 'container') {
      return { id, type: 'container', position, data: common satisfies ContainerData, style: size, draggable: false, ...parent };
    }
    const data: PieceData = {
      ...common,
      hiddenChildren: box.kind === 'repoBox' ? members.length : descendantsOf(index, id).length,
      scaleWorst: scaleOverlay ? worstOf(members.map((m) => { const n = index.byId.get(m); return n ? worstScale(n) : undefined; })) : undefined,
      annotation: frame.annotations.get(id),
    };
    return { id, type: 'piece', position, data, draggable: false, ...parent };
  });

  const edges: Edge[] = projected.edges.map((e) => {
    const active = mode === 'walkthrough' && frame.active?.key === e.key;
    const data: FlowEdgeData = {
      kind: e.kind, label: e.label, active, visited: frame.visited.has(e.key), reverse: active ? frame.active!.reverse : false,
      tokenProgress: active ? phase.tokenProgress : null, tokenLabel: active ? frame.active!.label : null,
    };
    return { id: e.key, source: e.from, target: e.to, type: 'flow', data };
  });

  return { nodes, edges };
};
```

- [ ] **Step 4: Node, container, group, edge and callout components**

`apps/web/src/workspace/canvas/PieceNode.tsx`:
```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useI18n } from '../../i18n/I18nProvider';
import type { PieceData } from './toFlow';

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const, top: '50%', left: '50%' };

export const pieceClasses = (d: { state: string; active: boolean; selected: boolean; change?: string }, base: string) =>
  [base, `is-${d.state}`, d.active && 'is-active', d.selected && 'is-selected', d.change && `change-${d.change}`].filter(Boolean).join(' ');

export const PieceNode = ({ data }: NodeProps) => {
  const d = data as PieceData;
  const { t } = useI18n();
  const classes = [pieceClasses(d, 'piece'), d.scaleWorst && `scale-${d.scaleWorst}`].filter(Boolean).join(' ');
  return (
    <div className={classes} data-testid={`node-${d.id}`}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <div className="piece-head">
        <span aria-hidden>{d.glyph}</span>
        <span className="piece-label">{d.label}</span>
        {d.severity && <span className={`risk-dot sev-${d.severity}`} />}
      </div>
      <div className="piece-kind">{d.kindLabel}</div>
      {(d.hiddenChildren > 0 || d.change) && (
        <div className="piece-foot">
          {d.hiddenChildren > 0 && <span>▸ {t('piece.inside', { count: d.hiddenChildren })}</span>}
          {d.change && <span className="badge">{t(`change.${d.change}`)}</span>}
        </div>
      )}
      {d.scaleWorst && <div className="piece-bar"><i /></div>}
      {d.annotation && <div className="callout" style={{ position: 'absolute', top: -34, left: 0, width: 'auto', padding: '2px 8px' }}>{d.annotation}</div>}
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
    </div>
  );
};
```

`apps/web/src/workspace/canvas/ContainerNode.tsx`:
```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { pieceClasses } from './PieceNode';
import type { ContainerData } from './toFlow';

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const, top: '50%', left: '50%' };

export const ContainerNode = ({ data }: NodeProps) => {
  const d = data as ContainerData;
  return (
    <div className={pieceClasses(d, 'container')} data-testid={`node-${d.id}`}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <div className="container-label">
        <span aria-hidden>{d.glyph}</span>
        <span>{d.label}</span>
        <span className="muted">{d.kindLabel}</span>
        {d.severity && <span className={`risk-dot sev-${d.severity}`} />}
      </div>
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
    </div>
  );
};
```

`apps/web/src/workspace/canvas/GroupBox.tsx`:
```tsx
import type { NodeProps } from '@xyflow/react';
import type { GroupData } from './toFlow';

export const GroupBox = ({ id, data }: NodeProps) => (
  <div className="group-box" data-testid={`group-${id}`}>
    <div className="group-label">{(data as GroupData).label}</div>
  </div>
);
```

`apps/web/src/workspace/canvas/FlowEdge.tsx`:
```tsx
import { EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import { floatingEdgePoints, pointAlong, type Rect } from './floating';
import type { FlowEdgeData } from './toFlow';

const ARROW = 8;
const TOKEN_RADIUS = 6;

const rectOf = (node: InternalNode): Rect => ({
  x: node.internals.positionAbsolute.x,
  y: node.internals.positionAbsolute.y,
  width: node.measured.width ?? 0,
  height: node.measured.height ?? 0,
});

export const FlowEdge = ({ id, source, target, data }: EdgeProps) => {
  const edge = data as FlowEdgeData;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty } = floatingEdgePoints(rectOf(sourceNode), rectOf(targetNode));
  const markerId = `arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const token = edge.tokenProgress === null ? null : pointAlong(sx, sy, tx, ty, edge.reverse ? 1 - edge.tokenProgress : edge.tokenProgress);
  const classes = ['edge-line', `kind-${edge.kind}`, edge.active && 'is-active', edge.visited && 'is-visited'].filter(Boolean).join(' ');

  return (
    <>
      <defs>
        <marker id={markerId} viewBox={`0 0 ${ARROW} ${ARROW}`} refX={ARROW} refY={ARROW / 2} markerWidth={ARROW} markerHeight={ARROW} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d={`M0,0 L${ARROW},${ARROW / 2} L0,${ARROW} z`} style={{ fill: edge.active ? 'var(--token)' : 'var(--line)' }} />
        </marker>
      </defs>
      <path className={classes} d={`M ${sx} ${sy} L ${tx} ${ty}`} markerEnd={`url(#${markerId})`} />
      {token && (
        <g data-testid="edge-token" transform={`translate(${token.x}, ${token.y})`}>
          <circle className="token" r={TOKEN_RADIUS} />
          {edge.tokenLabel && <text className="token-label" y={-12} textAnchor="middle">{edge.tokenLabel}</text>}
        </g>
      )}
      {edge.label && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, 4px) translate(${(sx + tx) / 2}px, ${(sy + ty) / 2}px)` }}>{edge.label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
```

`apps/web/src/workspace/canvas/Callout.tsx`:
```tsx
import { useI18n } from '../../i18n/I18nProvider';

type CalloutProps = {
  x: number; y: number; path: string; narration: string;
  canOpen: boolean; canViewCode: boolean; riskCount: number;
  onOpen: () => void; onViewCode: () => void; onRisks: () => void;
};

export const Callout = ({ x, y, path, narration, canOpen, canViewCode, riskCount, onOpen, onViewCode, onRisks }: CalloutProps) => {
  const { t } = useI18n();
  return (
    <div className="callout" data-testid="callout" style={{ transform: `translate(${x}px, ${y}px)` }}>
      <span className="callout-path">{path}</span>
      {narration}
      {(canOpen || canViewCode || riskCount > 0) && (
        <div className="callout-actions">
          {canOpen && <button type="button" className="btn" data-testid="callout-open" onClick={onOpen}>▸ {t('callout.openDetail')}</button>}
          {canViewCode && <button type="button" className="btn" data-testid="callout-code" onClick={onViewCode}>⟨/⟩ {t('callout.viewCode')}</button>}
          {riskCount > 0 && <button type="button" className="btn" data-testid="callout-risks" onClick={onRisks}>⚠ {t('callout.risks', { count: riskCount })}</button>}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 5: Layout hook and canvas**

`apps/web/src/workspace/canvas/useSceneLayout.ts`:
```ts
import { useEffect, useState } from 'react';
import type { SceneLayout } from './layout';

type Settled = { signature: string; layout: SceneLayout | null; error: string | null };

export const useSceneLayout = (signature: string, compute: () => Promise<SceneLayout>) => {
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    let cancelled = false;
    compute().then(
      (layout) => { if (!cancelled) setSettled({ signature, layout, error: null }); },
      (error: unknown) => { if (!cancelled) setSettled({ signature, layout: null, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { cancelled = true; };
    // compute is recreated every render; the signature is the cache key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return settled?.signature === signature ? { layout: settled.layout, error: settled.error } : { layout: null, error: null };
};
```

`apps/web/src/workspace/canvas/Canvas.tsx`:
```tsx
import type { ProjectedEdges, Scene, SceneIndex, SceneRisk, VisibleModel } from '@rdi/scene/v2';
import { Background, Controls, ReactFlow, ReactFlowProvider, ViewportPortal, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { ExplorerState } from '../engine/explorerState';
import type { Frame } from '../engine/frame';
import type { Phase } from '../engine/phase';
import { Callout } from './Callout';
import { ContainerNode } from './ContainerNode';
import { FlowEdge } from './FlowEdge';
import { GroupBox } from './GroupBox';
import { absoluteRect, layoutScene, layoutSignature } from './layout';
import { PieceNode } from './PieceNode';
import { toFlow } from './toFlow';
import { useSceneLayout } from './useSceneLayout';

const nodeTypes = { piece: PieceNode, container: ContainerNode, 'group-box': GroupBox };
const edgeTypes = { flow: FlowEdge };
const CALLOUT_GAP = 12;

type CanvasProps = {
  scene: Scene; index: SceneIndex; model: VisibleModel; projected: ProjectedEdges; frame: Frame; phase: Phase;
  explorer: ExplorerState; byNode: Map<string, SceneRisk[]>;
  onSelect: (id: string) => void; onToggleExpand: (id: string) => void; onOpenCode: (id: string) => void;
  onOpenStep: (stepId: string) => void; onSelectRisk: (riskId: string) => void;
};

export const Canvas = (props: CanvasProps) => {
  const { scene, index, model, projected, frame, phase, explorer, byNode } = props;
  const { t } = useI18n();
  const signature = layoutSignature(scene.id, model);
  const { layout, error } = useSceneLayout(signature, () => layoutScene(scene, index, model, projected.edges));
  const selectedRisk = scene.risks.find((r) => r.id === explorer.selectedRiskId) ?? null;

  const flow = useMemo(
    () => (layout ? toFlow({ scene, index, model, projected, layout, frame, phase, mode: explorer.mode, selectedNodeId: explorer.selectedNodeId, selectedRisk, scaleOverlay: explorer.scaleOverlay, byNode }) : null),
    [layout, scene, index, model, projected, frame, phase, explorer.mode, explorer.selectedNodeId, selectedRisk, explorer.scaleOverlay, byNode],
  );

  if (error) return <div className="canvas-error">{t('canvas.error', { error })}</div>;
  if (!flow || !layout) return <div className="canvas-loading">{t('canvas.loading')}</div>;

  const step = frame.flat?.step;
  const focusId = step ? [...frame.focused][0] : undefined;
  const focusRect = focusId ? absoluteRect(layout, focusId) : null;
  const focusNode = step?.focus[0] ? index.byId.get(step.focus[0]) : undefined;
  const handleClick: NodeMouseHandler = (_e, node) => { if (node.type !== 'group-box') props.onSelect(node.id); };
  const handleDoubleClick: NodeMouseHandler = (_e, node) => props.onToggleExpand(node.id);

  return (
    <ReactFlowProvider>
      <ReactFlow
        key={signature}
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleClick}
        onNodeDoubleClick={handleDoubleClick}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
      >
        <Background gap={22} color="transparent" />
        <Controls showInteractive={false} />
        {step && frame.flat && focusRect && explorer.mode === 'walkthrough' && (
          <ViewportPortal>
            <Callout
              x={focusRect.x}
              y={focusRect.y + focusRect.height + CALLOUT_GAP}
              path={frame.flat.path}
              narration={step.narration}
              canOpen={step.substeps.length > 0 && !explorer.openSteps.includes(step.id)}
              canViewCode={Boolean(focusNode?.code)}
              riskCount={focusNode ? byNode.get(focusNode.id)?.length ?? 0 : 0}
              onOpen={() => props.onOpenStep(step.id)}
              onViewCode={() => focusNode && props.onOpenCode(focusNode.id)}
              onRisks={() => { const r = focusNode && byNode.get(focusNode.id)?.[0]; if (r) props.onSelectRisk(r.id); }}
            />
          </ViewportPortal>
        )}
      </ReactFlow>
    </ReactFlowProvider>
  );
};
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS. (If the linter is not configured, the `eslint-disable` comment is inert.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): add v2 canvas with containers, floating edges and callout

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Explorer column — tree, walkthrough tree, risks panel, payload

**Files:**
- Create: `apps/web/src/workspace/panels/explorerTree.ts`, `ExplorerPanel.tsx`, `WalkthroughTree.tsx`, `RisksPanel.tsx`, `PayloadDiff.tsx`
- Test: `apps/web/test/workspace/explorerTree.test.ts`, `apps/web/test/workspace/WalkthroughTree.test.tsx`, `apps/web/test/workspace/RisksPanel.test.tsx`

**Interfaces:**
- Consumes: package hierarchy/walkthrough; `ROLE_GLYPHS`, `REPO_GLYPH`; `aggregateSeverity`, `severityRank`; `useI18n`; `ExplorerState`, `Mode`.
- Produces:
  ```ts
  type TreeItem = { id: string; nodeId: string | null; label: string; glyph: string; depth: number; expandable: boolean; expanded: boolean; severity?: Severity }
  buildExplorerTree(scene: Scene, index: SceneIndex, model: VisibleModel, byNode: Map<string, SceneRisk[]>): TreeItem[]
  <WalkthroughTree steps numbering flat cursor openSteps onSeek(index) onToggle(stepId) />   // testids step-<id>, step-toggle-<id>
  <RisksPanel scene selectedRiskId onSelect(riskId) />                                         // testids risk-<id>, risk-filter-<category>
  <PayloadDiff payload? />                                                                    // testid payload-panel
  <ExplorerPanel scene index model explorer flat cursor numbering byNode onSelectNode onToggleExpand onSeek onToggleStep onSelectRisk onSetMode />
                                                                                              // testids tree-item-<id>, tree-toggle-<id>, activity-<mode>
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/workspace/explorerTree.test.ts`:
```ts
import { computeVisible, indexScene } from '@rdi/scene/v2';
import { buildExplorerTree } from '../../src/workspace/panels/explorerTree';
import { risksByNode } from '../../src/workspace/engine/risks';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const tree = (level: Parameters<typeof computeVisible>[2], local: string[] = []) =>
  buildExplorerTree(scene, index, computeVisible(scene, index, level, new Set(local)), risksByNode(scene)).map(
    (i) => `${'  '.repeat(i.depth)}${i.expandable ? (i.expanded ? '▾' : '▸') : '·'} ${i.id}`,
  );

describe('buildExplorerTree', () => {
  it('architecture: repo groups with top-level pieces, collapsed parents expandable', () => {
    expect(tree('architecture')).toEqual(['▾ group:web', '  · client', '▾ group:svc', '  · api', '  ▸ worker', '  · db', '· pay']);
  });

  it('components and local expansion reveal nested pieces', () => {
    expect(tree('components')).toEqual(['▾ group:web', '  · client', '▾ group:svc', '  · api', '  ▾ worker', '    ▸ reserve', '  · db', '· pay']);
    expect(tree('architecture', ['reserve'])).toContain('      · lock');
  });

  it('system: repo boxes listing their members', () => {
    expect(tree('system')).toEqual(['▾ repo:web', '  · client', '▾ repo:svc', '  · api', '  · worker', '  · db', '· pay']);
  });

  it('carries node ids and aggregated severity', () => {
    const items = buildExplorerTree(scene, index, computeVisible(scene, index, 'architecture', new Set()), risksByNode(scene));
    expect(items.find((i) => i.id === 'worker')).toMatchObject({ nodeId: 'worker', severity: 'high', glyph: '⚙' });
    expect(items.find((i) => i.id === 'group:svc')).toMatchObject({ nodeId: null, glyph: '▣' });
  });
});
```

`apps/web/test/workspace/WalkthroughTree.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { flattenSteps, numberSteps } from '@rdi/scene/v2';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { WalkthroughTree } from '../../src/workspace/panels/WalkthroughTree';
import { fixtureScene } from './fixture';

const { steps } = fixtureScene();
const renderTree = (open: string[], cursor: number, handlers = { onSeek: vi.fn(), onToggle: vi.fn() }) => {
  render(
    <I18nProvider initialLanguage="en">
      <WalkthroughTree steps={steps} numbering={numberSteps(steps)} flat={flattenSteps(steps, new Set(open))} cursor={cursor} openSteps={open} {...handlers} />
    </I18nProvider>,
  );
  return handlers;
};

describe('WalkthroughTree', () => {
  it('marks done and current steps and hides closed sub-steps', () => {
    renderTree([], 1);
    expect(screen.getByTestId('step-s1')).toHaveClass('is-done');
    expect(screen.getByTestId('step-s2')).toHaveClass('is-current');
    expect(screen.queryByTestId('step-s2-1')).toBeNull();
    expect(screen.getByTestId('step-toggle-s2')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows open sub-steps with their numbering and seeks on click', () => {
    const { onSeek, onToggle } = renderTree(['s2'], 0);
    expect(screen.getByTestId('step-s2-1')).toHaveTextContent('2.1');
    fireEvent.click(screen.getByTestId('step-s2-2'));
    expect(onSeek).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByTestId('step-toggle-s2'));
    expect(onToggle).toHaveBeenCalledWith('s2');
  });

  it('explains empty walkthroughs', () => {
    render(<I18nProvider initialLanguage="en"><WalkthroughTree steps={[]} numbering={new Map()} flat={[]} cursor={0} openSteps={[]} onSeek={vi.fn()} onToggle={vi.fn()} /></I18nProvider>);
    expect(screen.getByText('This scene has no walkthrough.')).toBeInTheDocument();
  });
});
```

`apps/web/test/workspace/RisksPanel.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { RisksPanel } from '../../src/workspace/panels/RisksPanel';
import { fixtureScene } from './fixture';

const scene = fixtureScene();

describe('RisksPanel', () => {
  it('groups by category, filters and selects', () => {
    const onSelect = vi.fn();
    render(<I18nProvider initialLanguage="en"><RisksPanel scene={scene} selectedRiskId="r2" onSelect={onSelect} /></I18nProvider>);
    expect(screen.getByText('Performance & scale')).toBeInTheDocument();
    expect(screen.getByTestId('risk-r2')).toHaveClass('is-selected');
    fireEvent.click(screen.getByTestId('risk-r1'));
    expect(onSelect).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByTestId('risk-filter-security'));
    expect(screen.queryByTestId('risk-r1')).toBeNull();
    expect(screen.getByTestId('risk-r2')).toBeInTheDocument();
  });

  it('explains scenes without risks', () => {
    render(<I18nProvider initialLanguage="en"><RisksPanel scene={{ ...scene, risks: [] }} selectedRiskId={null} onSelect={vi.fn()} /></I18nProvider>);
    expect(screen.getByText('No risks recorded for this scene.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- workspace/explorerTree workspace/WalkthroughTree workspace/RisksPanel`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the tree builder**

`apps/web/src/workspace/panels/explorerTree.ts`:
```ts
import { topLevelGroups, type Scene, type SceneIndex, type SceneRisk, type Severity, type VisibleModel } from '@rdi/scene/v2';
import { REPO_GLYPH, ROLE_GLYPHS } from '../canvas/glyphs';
import { aggregateSeverity } from '../engine/risks';

export type TreeItem = { id: string; nodeId: string | null; label: string; glyph: string; depth: number; expandable: boolean; expanded: boolean; severity?: Severity };

const REPO_PREFIX = 'repo:';

export const buildExplorerTree = (scene: Scene, index: SceneIndex, model: VisibleModel, byNode: Map<string, SceneRisk[]>): TreeItem[] => {
  const items: TreeItem[] = [];
  const nodeItem = (id: string, depth: number, allowExpand: boolean) => {
    const node = index.byId.get(id)!;
    const hasChildren = (index.children.get(id)?.length ?? 0) > 0;
    const expanded = model.expanded.has(id);
    items.push({ id, nodeId: id, label: node.label, glyph: ROLE_GLYPHS[node.role], depth, expandable: allowExpand && hasChildren, expanded, severity: aggregateSeverity(index, byNode, [id]) });
    if (expanded) (index.children.get(id) ?? []).filter((c) => model.visible.has(c)).forEach((c) => nodeItem(c, depth + 1, allowExpand));
  };
  const groupItem = (id: string, label: string) => items.push({ id, nodeId: null, label, glyph: REPO_GLYPH, depth: 0, expandable: true, expanded: true });

  if (model.level === 'system') {
    model.repoBoxes.forEach((members, box) => {
      groupItem(box, box.slice(REPO_PREFIX.length));
      members.forEach((m) => nodeItem(m, 1, false));
    });
    index.topLevel.filter((id) => model.visible.has(id)).forEach((id) => nodeItem(id, 0, false));
    return items;
  }

  const visibleTop = index.topLevel.filter((id) => model.visible.has(id));
  const groups = topLevelGroups(scene, visibleTop);
  const grouped = new Set(groups.flatMap((g) => g.nodeIds));
  groups.forEach((g) => {
    groupItem(g.id, g.label);
    g.nodeIds.forEach((id) => nodeItem(id, 1, true));
  });
  visibleTop.filter((id) => !grouped.has(id)).forEach((id) => nodeItem(id, 0, true));
  return items;
};
```

- [ ] **Step 4: Implement the panels**

`apps/web/src/workspace/panels/WalkthroughTree.tsx`:
```tsx
import type { FlatStep, Step } from '@rdi/scene/v2';
import { useI18n } from '../../i18n/I18nProvider';

type WalkthroughTreeProps = {
  steps: Step[]; numbering: Map<string, string>; flat: FlatStep[]; cursor: number; openSteps: string[];
  onSeek: (index: number) => void; onToggle: (stepId: string) => void;
};

export const WalkthroughTree = ({ steps, numbering, flat, cursor, openSteps, onSeek, onToggle }: WalkthroughTreeProps) => {
  const { t } = useI18n();
  if (steps.length === 0) return <p className="muted" style={{ padding: '8px 10px' }}>{t('walkthrough.empty')}</p>;
  const positionOf = new Map(flat.map((f, i) => [f.step.id, i]));
  const currentId = flat[cursor]?.step.id;

  const renderSteps = (list: Step[], depth: number) =>
    list.map((step) => {
      const position = positionOf.get(step.id);
      const open = openSteps.includes(step.id);
      const classes = ['step', step.id === currentId && 'is-current', position !== undefined && position < cursor && 'is-done'].filter(Boolean).join(' ');
      return (
        <div key={step.id}>
          <div className="step-row" style={{ paddingLeft: 6 + depth * 14 }}>
            {step.substeps.length > 0 ? (
              <button type="button" className="twisty" data-testid={`step-toggle-${step.id}`} aria-expanded={open} aria-label={open ? t('explorer.collapse') : t('explorer.expand')} onClick={() => onToggle(step.id)}>
                {open ? '▾' : '▸'}
              </button>
            ) : (
              <span className="twisty" />
            )}
            <button type="button" className={classes} data-testid={`step-${step.id}`} aria-current={step.id === currentId ? 'step' : undefined} onClick={() => position !== undefined && onSeek(position)}>
              <span className="step-path">{numbering.get(step.id)}</span>
              {step.narration}
            </button>
          </div>
          {open && renderSteps(step.substeps, depth + 1)}
        </div>
      );
    });

  return <div className="steps">{renderSteps(steps, 0)}</div>;
};
```

`apps/web/src/workspace/panels/RisksPanel.tsx`:
```tsx
import { RISK_CATEGORIES, type RiskCategory, type Scene } from '@rdi/scene/v2';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { severityRank } from '../engine/risks';

type RisksPanelProps = { scene: Scene; selectedRiskId: string | null; onSelect: (riskId: string) => void };

export const RisksPanel = ({ scene, selectedRiskId, onSelect }: RisksPanelProps) => {
  const { t } = useI18n();
  const [filter, setFilter] = useState<RiskCategory | null>(null);
  if (scene.risks.length === 0) return <p className="muted" style={{ padding: '8px 10px' }}>{t('risks.empty')}</p>;
  const present = RISK_CATEGORIES.filter((c) => scene.risks.some((r) => r.category === c));
  const shown = present.filter((c) => filter === null || c === filter);

  return (
    <div>
      <div className="chips">
        {present.map((c) => (
          <button key={c} type="button" className="chip" data-testid={`risk-filter-${c}`} aria-pressed={filter === c} onClick={() => setFilter(filter === c ? null : c)}>
            {t(`category.${c}`)}
          </button>
        ))}
      </div>
      {shown.map((category) => (
        <div key={category}>
          <div className="sec-title">{t(`category.${category}`)}</div>
          {scene.risks
            .filter((r) => r.category === category)
            .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
            .map((risk) => (
              <button key={risk.id} type="button" className={risk.id === selectedRiskId ? 'risk-item is-selected' : 'risk-item'} data-testid={`risk-${risk.id}`} onClick={() => onSelect(risk.id)}>
                <span className={`risk-dot sev-${risk.severity}`} />
                <span>
                  <span className="muted">{t(`severity.${risk.severity}`)} · </span>
                  {risk.title}
                </span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
};
```

`apps/web/src/workspace/panels/PayloadDiff.tsx`:
```tsx
import type { Payload } from '@rdi/scene/v2';
import { diffLines } from 'diff';
import { useI18n } from '../../i18n/I18nProvider';

type Line = { text: string; kind: 'added' | 'removed' | 'same' };

const toLines = (before: string, after: string): Line[] =>
  diffLines(before, after).flatMap((part) => {
    const kind: Line['kind'] = part.added ? 'added' : part.removed ? 'removed' : 'same';
    return part.value.replace(/\n$/, '').split('\n').map((text) => ({ text, kind }));
  });

const PREFIX: Record<Line['kind'], string> = { added: '+ ', removed: '- ', same: '  ' };

export const PayloadDiff = ({ payload }: { payload?: Payload }) => {
  const { t } = useI18n();
  if (!payload) return null;
  return (
    <aside className="payload" data-testid="payload-panel">
      <header className="payload-head">
        <span>{t('payload.title')}</span>
        <span>{payload.format.toUpperCase()}</span>
      </header>
      <pre>
        {toLines(payload.before ?? '', payload.after ?? '').map((line, i) => (
          <div key={i} className={`diff-line--${line.kind}`}>{PREFIX[line.kind]}{line.text}</div>
        ))}
      </pre>
    </aside>
  );
};
```

`apps/web/src/workspace/panels/ExplorerPanel.tsx`:
```tsx
import type { FlatStep, Scene, SceneIndex, SceneRisk, VisibleModel } from '@rdi/scene/v2';
import { useI18n } from '../../i18n/I18nProvider';
import type { ExplorerState, Mode } from '../engine/explorerState';
import { buildExplorerTree } from './explorerTree';
import { PayloadDiff } from './PayloadDiff';
import { RisksPanel } from './RisksPanel';
import { WalkthroughTree } from './WalkthroughTree';

type ExplorerPanelProps = {
  scene: Scene; index: SceneIndex; model: VisibleModel; explorer: ExplorerState; flat: FlatStep[]; cursor: number;
  numbering: Map<string, string>; byNode: Map<string, SceneRisk[]>;
  onSelectNode: (id: string) => void; onToggleExpand: (id: string) => void; onSeek: (index: number) => void;
  onToggleStep: (id: string) => void; onSelectRisk: (id: string) => void; onSetMode: (mode: Mode) => void;
};

const ACTIVITY: { mode: Mode; glyph: string }[] = [
  { mode: 'walkthrough', glyph: '▤' },
  { mode: 'risks', glyph: '⚠' },
  { mode: 'changes', glyph: '±' },
];

export const ExplorerPanel = (p: ExplorerPanelProps) => {
  const { t } = useI18n();
  const items = buildExplorerTree(p.scene, p.index, p.model, p.byNode);
  const selectedRep = p.explorer.selectedNodeId ? p.model.representative.get(p.explorer.selectedNodeId) : null;

  return (
    <>
      <nav className="ws-activity" aria-label={t('explorer.title')}>
        {ACTIVITY.map(({ mode, glyph }) => (
          <button key={mode} type="button" data-testid={`activity-${mode}`} aria-pressed={p.explorer.mode === mode} title={t(`mode.${mode}`)} onClick={() => p.onSetMode(mode)}>
            {glyph}
          </button>
        ))}
      </nav>
      <aside className="ws-explorer">
        <div className="sec-title">{t('explorer.title')} · {t(`level.${p.explorer.level}`)}</div>
        <div className="tree">
          {items.map((item) => {
            const selected = item.nodeId !== null && (item.nodeId === p.explorer.selectedNodeId || item.id === selectedRep);
            const classes = ['tree-item', item.nodeId === null && 'is-group', selected && 'is-selected'].filter(Boolean).join(' ');
            return (
              <div key={item.id} className={classes} style={{ paddingLeft: 10 + item.depth * 14 }} data-testid={`tree-item-${item.id}`} onClick={() => item.nodeId && p.onSelectNode(item.nodeId)} role="treeitem" aria-selected={selected}>
                {item.expandable && item.nodeId ? (
                  <button type="button" className="twisty" data-testid={`tree-toggle-${item.id}`} aria-expanded={item.expanded} aria-label={item.expanded ? t('explorer.collapse') : t('explorer.expand')} onClick={(e) => { e.stopPropagation(); p.onToggleExpand(item.id); }}>
                    {item.expanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="twisty">{item.nodeId === null ? '▾' : ''}</span>
                )}
                <span aria-hidden>{item.glyph}</span>
                <span>{item.label}</span>
                {item.severity && <span className={`risk-dot sev-${item.severity}`} />}
              </div>
            );
          })}
        </div>
        {p.explorer.mode === 'risks' ? (
          <>
            <div className="sec-title">{t('explorer.risks')}</div>
            <RisksPanel scene={p.scene} selectedRiskId={p.explorer.selectedRiskId} onSelect={p.onSelectRisk} />
          </>
        ) : (
          <>
            <div className="sec-title">{t('explorer.walkthrough')}</div>
            <WalkthroughTree steps={p.scene.steps} numbering={p.numbering} flat={p.flat} cursor={p.cursor} openSteps={p.explorer.openSteps} onSeek={p.onSeek} onToggle={p.onToggleStep} />
            <PayloadDiff payload={p.flat[p.cursor]?.step.payload} />
          </>
        )}
      </aside>
    </>
  );
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add explorer column with tree, walkthrough and risks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Inspector — Now box, component card, risk detail, code drawer

**Files:**
- Create: `apps/web/src/workspace/panels/ComponentCard.tsx`, `Inspector.tsx`, `CodeDrawer.tsx`
- Test: `apps/web/test/workspace/ComponentCard.test.tsx`, `apps/web/test/workspace/CodeDrawer.test.tsx`

**Interfaces:**
- Consumes: `SceneNode, SceneRisk, Frame`, `useI18n`, `severityRank`.
- Produces:
  ```tsx
  <ComponentCard node={SceneNode | null} risks={SceneRisk[]} canOpenInside={boolean} onOpenInside() onViewCode() onSelectRisk(id) />
      // testids card, scale-row-low|medium|high, card-risk-<id>, open-inside, view-code
  <Inspector frame scene selectedNode risksForNode selectedRisk canOpenInside onOpenInside onViewCode onSelectRisk />
      // testids now, risk-detail
  <CodeDrawer node={SceneNode} onClose() />   // testids code-drawer, code-close
  highlightCode(snippet: string): (string | { kw: string })[]
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/workspace/ComponentCard.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { ComponentCard } from '../../src/workspace/panels/ComponentCard';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const api = scene.nodes.find((n) => n.id === 'api')!;
const reserve = scene.nodes.find((n) => n.id === 'reserve')!;
const renderCard = (props: Partial<Parameters<typeof ComponentCard>[0]> = {}) => {
  const handlers = { onOpenInside: vi.fn(), onViewCode: vi.fn(), onSelectRisk: vi.fn() };
  render(<I18nProvider initialLanguage="en"><ComponentCard node={api} risks={scene.risks.filter((r) => r.nodeIds.includes('api'))} canOpenInside={false} {...handlers} {...props} /></I18nProvider>);
  return handlers;
};

describe('ComponentCard', () => {
  it('shows the three scale rows with status and strategy', () => {
    renderCard();
    expect(screen.getByTestId('scale-row-low')).toHaveTextContent('comfortable');
    expect(screen.getByTestId('scale-row-high')).toHaveTextContent('saturated');
    expect(screen.getByTestId('scale-row-high')).toHaveTextContent('queues');
    expect(screen.getByTestId('scale-row-high').querySelector('.status-saturated')).not.toBeNull();
    expect(screen.getByTestId('card')).toHaveTextContent('Scales horizontally');
    expect(screen.getByTestId('card')).toHaveTextContent('add instances');
  });

  it('lists risks and exposes the optional code button', () => {
    const { onSelectRisk, onViewCode } = renderCard();
    fireEvent.click(screen.getByTestId('card-risk-r2'));
    expect(onSelectRisk).toHaveBeenCalledWith('r2');
    fireEvent.click(screen.getByTestId('view-code'));
    expect(onViewCode).toHaveBeenCalled();
  });

  it('shows complexity, hides scale and code when absent, and offers open inside', () => {
    const { onOpenInside } = renderCard({ node: reserve, risks: [], canOpenInside: true });
    expect(screen.getByTestId('card')).toHaveTextContent('O(k)');
    expect(screen.queryByTestId('scale-row-low')).toBeNull();
    expect(screen.queryByTestId('view-code')).toBeNull();
    expect(screen.getByText('No known risks.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-inside'));
    expect(onOpenInside).toHaveBeenCalled();
  });

  it('asks for a selection when there is no node', () => {
    renderCard({ node: null });
    expect(screen.getByText('Select a piece on the canvas or in the explorer.')).toBeInTheDocument();
  });
});
```

`apps/web/test/workspace/CodeDrawer.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { CodeDrawer, highlightCode } from '../../src/workspace/panels/CodeDrawer';
import { fixtureScene } from './fixture';

const api = fixtureScene().nodes.find((n) => n.id === 'api')!;

describe('CodeDrawer', () => {
  it('shows location and snippet and closes', () => {
    const onClose = vi.fn();
    render(<I18nProvider initialLanguage="en"><CodeDrawer node={api} onClose={onClose} /></I18nProvider>);
    expect(screen.getByTestId('code-drawer')).toHaveTextContent('svc/src/api.ts:1-3');
    expect(screen.getByTestId('code-drawer')).toHaveTextContent('return 1;');
    fireEvent.click(screen.getByTestId('code-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('explains when there is no snippet yet', () => {
    render(<I18nProvider initialLanguage="en"><CodeDrawer node={{ ...api, code: { ...api.code!, snippet: undefined } }} onClose={vi.fn()} /></I18nProvider>);
    expect(screen.getByText('Code will be available after the repository is indexed.')).toBeInTheDocument();
  });

  it('highlights keywords', () => {
    expect(highlightCode('const x = await y')).toEqual([{ kw: 'const' }, ' x = ', { kw: 'await' }, ' y']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- workspace/ComponentCard workspace/CodeDrawer`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/workspace/panels/ComponentCard.tsx`:
```tsx
import type { SceneNode, SceneRisk } from '@rdi/scene/v2';
import { useI18n } from '../../i18n/I18nProvider';
import { severityRank } from '../engine/risks';

const STATUS_GLYPH = { ok: '✓', strained: '●', limit: '▲', saturated: '✕' } as const;
const ROWS = ['low', 'medium', 'high'] as const;
const STRATEGY_KEY = { horizontal: 'strategy.horizontal', vertical: 'strategy.vertical', none: 'strategy.none', external: 'strategy.external', 'n/a': 'strategy.na' } as const;

type ComponentCardProps = {
  node: SceneNode | null; risks: SceneRisk[]; canOpenInside: boolean;
  onOpenInside: () => void; onViewCode: () => void; onSelectRisk: (id: string) => void;
};

export const ComponentCard = ({ node, risks, canOpenInside, onOpenInside, onViewCode, onSelectRisk }: ComponentCardProps) => {
  const { t } = useI18n();
  if (!node) return <p className="muted" data-testid="card">{t('card.none')}</p>;
  return (
    <section data-testid="card">
      <div className="h">{t('card.title')}</div>
      <div className="card-title">{node.label}</div>
      <div className="muted">{node.role} · {node.kind}</div>
      <p style={{ margin: '6px 0' }}>{node.summary}</p>
      {node.details && <details><summary className="muted">{t('card.details')}</summary><p>{node.details}</p></details>}
      {node.complexity && (
        <div>
          <div className="h">{t('card.complexity')}</div>
          {t('card.time')} <b className="status-ok">{node.complexity.time}</b>
          {node.complexity.space && <> · {t('card.space')} <b className="status-ok">{node.complexity.space}</b></>}
          {node.complexity.note && <div className="muted">{node.complexity.note}</div>}
        </div>
      )}
      {node.scale && (
        <div>
          <div className="h">{t('card.atScale')}</div>
          {ROWS.map((row) => {
            const { status, note } = node.scale![row];
            return (
              <div key={row} className="scale-row" data-testid={`scale-row-${row}`}>
                <span className={`status-${status}`}>{STATUS_GLYPH[status]} {t(`card.${row}`)}<br /><span className="muted">{t(`status.${status}`)}</span></span>
                <span>{note}</span>
              </div>
            );
          })}
          <div className="scale-row">
            <span className="muted">{t(STRATEGY_KEY[node.scale.strategy])}</span>
            <span>{node.scale.advice}</span>
          </div>
        </div>
      )}
      <div className="h">{t('card.risks')}</div>
      {risks.length === 0 ? (
        <p className="muted">{t('card.noRisks')}</p>
      ) : (
        [...risks].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)).map((risk) => (
          <button key={risk.id} type="button" className="risk-item" style={{ padding: '3px 0' }} data-testid={`card-risk-${risk.id}`} onClick={() => onSelectRisk(risk.id)}>
            <span className={`risk-dot sev-${risk.severity}`} />
            <span><span className="muted">{t(`category.${risk.category}`)} · </span>{risk.title}</span>
          </button>
        ))
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {canOpenInside && <button type="button" className="btn btn-accent" data-testid="open-inside" onClick={onOpenInside}>▸ {t('card.openInside')}</button>}
        {node.code && <button type="button" className="btn" data-testid="view-code" onClick={onViewCode}>⟨/⟩ {t('card.viewCode')}</button>}
      </div>
    </section>
  );
};
```

`apps/web/src/workspace/panels/CodeDrawer.tsx`:
```tsx
import type { SceneNode } from '@rdi/scene/v2';
import { useI18n } from '../../i18n/I18nProvider';

const KEYWORDS = /\b(async|await|const|let|var|function|return|if|else|for|while|of|in|new|throw|try|catch|class|export|import|from|def|self|None|True|False|SELECT|UPDATE|INSERT|WHERE|FROM|SET|FOR)\b/g;

export const highlightCode = (snippet: string): (string | { kw: string })[] => {
  const parts: (string | { kw: string })[] = [];
  let last = 0;
  for (const match of snippet.matchAll(KEYWORDS)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(snippet.slice(last, at));
    parts.push({ kw: match[0] });
    last = at + match[0].length;
  }
  if (last < snippet.length) parts.push(snippet.slice(last));
  return parts;
};

export const CodeDrawer = ({ node, onClose }: { node: SceneNode; onClose: () => void }) => {
  const { t } = useI18n();
  const code = node.code;
  if (!code) return null;
  return (
    <aside className="drawer" data-testid="code-drawer">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="kw">⟨/⟩ {t('code.title')} · {node.label}</span>
        <button type="button" className="btn" data-testid="code-close" onClick={onClose}>{t('code.close')}</button>
      </div>
      <div className="muted" style={{ marginTop: 4 }}>{code.repo}/{code.path}:{code.startLine}-{code.endLine}</div>
      {code.snippet ? (
        <pre>{highlightCode(code.snippet).map((part, i) => (typeof part === 'string' ? part : <span key={i} className="kw">{part.kw}</span>))}</pre>
      ) : (
        <p className="muted">{t('code.unavailable')}</p>
      )}
    </aside>
  );
};
```

`apps/web/src/workspace/panels/Inspector.tsx`:
```tsx
import type { SceneNode, SceneRisk } from '@rdi/scene/v2';
import { useI18n } from '../../i18n/I18nProvider';
import type { Frame } from '../engine/frame';
import { ComponentCard } from './ComponentCard';

type InspectorProps = {
  frame: Frame; selectedNode: SceneNode | null; risksForNode: SceneRisk[]; selectedRisk: SceneRisk | null; riskNodeLabels: string[];
  canOpenInside: boolean; onOpenInside: () => void; onViewCode: () => void; onSelectRisk: (id: string) => void;
};

export const Inspector = (p: InspectorProps) => {
  const { t } = useI18n();
  return (
    <aside className="ws-inspector">
      <div>
        <div className="h" style={{ marginTop: 0 }}>{t('now.title')}</div>
        <div className="now" data-testid="now">
          {p.frame.flat ? (
            <>
              <b>{t('now.step', { path: p.frame.flat.path })}</b>
              <br />
              {p.frame.flat.step.narration}
            </>
          ) : (
            <span className="muted">{t('now.idle')}</span>
          )}
        </div>
      </div>
      {p.selectedRisk && (
        <div className="risk-card" data-testid="risk-detail">
          <div><span className={`risk-dot sev-${p.selectedRisk.severity}`} style={{ display: 'inline-block', marginRight: 6 }} /><b>{p.selectedRisk.title}</b></div>
          <div className="muted">{t(`category.${p.selectedRisk.category}`)} · {t(`severity.${p.selectedRisk.severity}`)}</div>
          <p>{p.selectedRisk.explanation}</p>
          {p.selectedRisk.mitigation && <p><span className="muted">{t('risks.mitigation')}: </span>{p.selectedRisk.mitigation}</p>}
          <div className="muted">{t('risks.affects')}: {p.riskNodeLabels.join(', ')}</div>
        </div>
      )}
      <ComponentCard node={p.selectedNode} risks={p.risksForNode} canOpenInside={p.canOpenInside} onOpenInside={p.onOpenInside} onViewCode={p.onViewCode} onSelectRisk={p.onSelectRisk} />
    </aside>
  );
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add inspector with scale rows, risk detail and code drawer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Top bar, footer and logo

**Files:**
- Create: `apps/web/src/workspace/panels/Logo.tsx`, `TopBar.tsx`, `Footer.tsx`
- Test: `apps/web/test/workspace/TopBar.test.tsx`, `apps/web/test/workspace/Footer.test.tsx`

**Interfaces:**
- Consumes: `LEVELS, Level, Scene`, `THEMES, ThemeId`, `UI_LANGUAGES, UiLanguage, primarySubtag`, `useI18n`, `PlayerState, PlayerAction` (`src/engine/player.ts`), `Mode`.
- Produces:
  ```tsx
  availableModes(scene: Scene): Mode[]   // walkthrough if steps; risks if risks; changes if any node.change
  hasScale(scene: Scene): boolean
  <TopBar scenes scene level mode scaleOverlay theme onSceneChange(id) onLevel(l) onMode(m) onToggleOverlay() onTheme(t) />
      // testids scene-select, level-<level>, mode-<mode>, scale-overlay, theme-select, language-select, regenerate
  <Footer state stepCount path dispatch />   // testids player-prev, player-toggle, player-next, player-scrub, player-counter, player-speed
  <Logo size? />
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/workspace/TopBar.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { sampleScenes } from '@rdi/scene/v2';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { availableModes, hasScale, TopBar } from '../../src/workspace/panels/TopBar';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const renderBar = (props: Partial<Parameters<typeof TopBar>[0]> = {}, language: 'en' | 'es' | 'pt' = 'en') => {
  const handlers = { onSceneChange: vi.fn(), onLevel: vi.fn(), onMode: vi.fn(), onToggleOverlay: vi.fn(), onTheme: vi.fn() };
  render(
    <I18nProvider initialLanguage={language}>
      <TopBar scenes={sampleScenes} scene={scene} level="architecture" mode="walkthrough" scaleOverlay={false} theme="mission" {...handlers} {...props} />
    </I18nProvider>,
  );
  return handlers;
};

describe('TopBar', () => {
  it('derives modes and scale availability from content', () => {
    expect(availableModes(scene)).toEqual(['walkthrough', 'risks', 'changes']);
    expect(availableModes({ ...scene, steps: [], risks: [], nodes: scene.nodes.map((n) => ({ ...n, change: undefined })) })).toEqual([]);
    expect(hasScale(scene)).toBe(true);
    expect(hasScale({ ...scene, nodes: scene.nodes.map((n) => ({ ...n, scale: undefined })) })).toBe(false);
  });

  it('switches level, mode, overlay and theme', () => {
    const h = renderBar();
    expect(screen.getByTestId('level-architecture')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('level-detail'));
    fireEvent.click(screen.getByTestId('mode-risks'));
    fireEvent.click(screen.getByTestId('scale-overlay'));
    fireEvent.change(screen.getByTestId('theme-select'), { target: { value: 'paper' } });
    expect(h.onLevel).toHaveBeenCalledWith('detail');
    expect(h.onMode).toHaveBeenCalledWith('risks');
    expect(h.onToggleOverlay).toHaveBeenCalled();
    expect(h.onTheme).toHaveBeenCalledWith('paper');
  });

  it('hides modes and overlay the scene does not support', () => {
    renderBar({ scene: { ...scene, risks: [], nodes: scene.nodes.map((n) => ({ ...n, scale: undefined, change: undefined })) } });
    expect(screen.queryByTestId('mode-risks')).toBeNull();
    expect(screen.queryByTestId('mode-changes')).toBeNull();
    expect(screen.queryByTestId('scale-overlay')).toBeNull();
  });

  it('switches UI language and offers regeneration only when the primary subtag differs', () => {
    renderBar({ scene: { ...scene, language: 'pt-BR' } }, 'pt');
    expect(screen.queryByTestId('regenerate')).toBeNull();
    fireEvent.change(screen.getByTestId('language-select'), { target: { value: 'es' } });
    expect(screen.getByTestId('level-architecture')).toHaveTextContent('Arquitectura');
    expect(screen.getByTestId('regenerate')).toBeDisabled();
    expect(screen.getByTestId('regenerate')).toHaveTextContent('Regenerar en Español');
  });
});
```

`apps/web/test/workspace/Footer.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { initialPlayerState } from '../../src/engine/player';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { Footer } from '../../src/workspace/panels/Footer';

const renderFooter = (stepCount: number, path: string | null, stepIndex = 0) => {
  const dispatch = vi.fn();
  render(<I18nProvider initialLanguage="en"><Footer state={{ ...initialPlayerState, stepIndex }} stepCount={stepCount} path={path} dispatch={dispatch} /></I18nProvider>);
  return dispatch;
};

describe('Footer', () => {
  it('shows the hierarchical path and dispatches player actions', () => {
    const dispatch = renderFooter(6, '3.1', 3);
    expect(screen.getByTestId('player-counter')).toHaveTextContent('Step 3.1 · 4 / 6');
    fireEvent.click(screen.getByTestId('player-toggle'));
    fireEvent.click(screen.getByTestId('player-next'));
    fireEvent.change(screen.getByTestId('player-scrub'), { target: { value: '5' } });
    expect(dispatch.mock.calls.map(([a]) => a)).toEqual([{ type: 'play' }, { type: 'next' }, { type: 'seek', stepIndex: 5 }]);
  });

  it('is disabled without steps', () => {
    renderFooter(0, null);
    expect(screen.getByTestId('player-toggle')).toBeDisabled();
    expect(screen.getByTestId('player-scrub')).toBeDisabled();
    expect(screen.getByTestId('player-counter')).toHaveTextContent('No steps');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @rdi/web -- workspace/TopBar workspace/Footer`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/workspace/panels/Logo.tsx`:
```tsx
export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size * (30 / 36)} viewBox="0 0 36 30" aria-hidden>
    <path d="M6 22 L18 8 L30 22" style={{ stroke: 'var(--accent)' }} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <circle cx="6" cy="22" r="4.5" style={{ fill: 'var(--accent)' }} />
    <circle cx="18" cy="8" r="4.5" style={{ fill: 'var(--token)' }} />
    <circle cx="30" cy="22" r="4.5" style={{ fill: 'var(--accent)' }} />
  </svg>
);
```

`apps/web/src/workspace/panels/TopBar.tsx`:
```tsx
import { LEVELS, type Level, type Scene } from '@rdi/scene/v2';
import { useI18n } from '../../i18n/I18nProvider';
import { primarySubtag, UI_LANGUAGES, type UiLanguage } from '../../i18n/messages';
import { THEMES, type ThemeId } from '../../theme/themes';
import type { Mode } from '../engine/explorerState';
import { Logo } from './Logo';

export const availableModes = (scene: Scene): Mode[] => [
  ...(scene.steps.length > 0 ? (['walkthrough'] as const) : []),
  ...(scene.risks.length > 0 ? (['risks'] as const) : []),
  ...(scene.nodes.some((n) => n.change) ? (['changes'] as const) : []),
];

export const hasScale = (scene: Scene): boolean => scene.nodes.some((n) => n.scale);

type TopBarProps = {
  scenes: Scene[]; scene: Scene; level: Level; mode: Mode; scaleOverlay: boolean; theme: ThemeId;
  onSceneChange: (id: string) => void; onLevel: (level: Level) => void; onMode: (mode: Mode) => void;
  onToggleOverlay: () => void; onTheme: (theme: ThemeId) => void;
};

export const TopBar = (p: TopBarProps) => {
  const { t, language, setLanguage } = useI18n();
  const regenerate = primarySubtag(p.scene.language) !== language;
  return (
    <header className="ws-top">
      <Logo />
      <select className="select" data-testid="scene-select" aria-label={t('scene.label')} value={p.scene.id} onChange={(e) => p.onSceneChange(e.target.value)}>
        {p.scenes.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.language})</option>)}
      </select>
      <div className="seg" role="group" aria-label={t('level.label')}>
        {LEVELS.map((level) => (
          <button key={level} type="button" data-testid={`level-${level}`} aria-pressed={p.level === level} onClick={() => p.onLevel(level)}>
            {t(`level.${level}`)}
          </button>
        ))}
      </div>
      <div className="tabs-inline" role="tablist">
        {availableModes(p.scene).map((mode) => (
          <button key={mode} type="button" role="tab" data-testid={`mode-${mode}`} aria-selected={p.mode === mode} onClick={() => p.onMode(mode)}>
            {t(`mode.${mode}`)}
          </button>
        ))}
      </div>
      {hasScale(p.scene) && (
        <button type="button" className={p.scaleOverlay ? 'btn btn-accent' : 'btn'} data-testid="scale-overlay" aria-pressed={p.scaleOverlay} onClick={p.onToggleOverlay}>
          {t('overlay.scale')}
        </button>
      )}
      <span className="ws-spacer" />
      {regenerate && (
        <button type="button" className="btn" data-testid="regenerate" disabled title={t('scene.regenerateSoon')}>
          {t('scene.regenerate', { language: t(`language.${language}`) })}
        </button>
      )}
      <select className="select" data-testid="language-select" aria-label={t('language.label')} value={language} onChange={(e) => setLanguage(e.target.value as UiLanguage)}>
        {UI_LANGUAGES.map((l) => <option key={l} value={l}>{t(`language.${l}`)}</option>)}
      </select>
      <select className="select" data-testid="theme-select" aria-label={t('theme.label')} value={p.theme} onChange={(e) => p.onTheme(e.target.value as ThemeId)}>
        {THEMES.map((th) => <option key={th} value={th}>◐ {t(`theme.${th}`)}</option>)}
      </select>
    </header>
  );
};
```

`apps/web/src/workspace/panels/Footer.tsx`:
```tsx
import type { Dispatch } from 'react';
import type { PlayerAction, PlayerState } from '../../engine/player';
import { useI18n } from '../../i18n/I18nProvider';

const SPEEDS = [0.5, 1, 2];

type FooterProps = { state: PlayerState; stepCount: number; path: string | null; dispatch: Dispatch<PlayerAction> };

export const Footer = ({ state, stepCount, path, dispatch }: FooterProps) => {
  const { t } = useI18n();
  const disabled = stepCount === 0;
  return (
    <footer className="ws-footer">
      <div className="player">
        <button type="button" data-testid="player-prev" aria-label={t('player.prev')} disabled={disabled} onClick={() => dispatch({ type: 'prev' })}>⏮</button>
        <button type="button" data-testid="player-toggle" aria-label={state.playing ? t('player.pause') : t('player.play')} disabled={disabled} onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}>
          {state.playing ? '⏸' : '▶'}
        </button>
        <button type="button" data-testid="player-next" aria-label={t('player.next')} disabled={disabled} onClick={() => dispatch({ type: 'next' })}>⏭</button>
        <input type="range" data-testid="player-scrub" aria-label={t('player.step')} min={0} max={Math.max(stepCount - 1, 0)} value={state.stepIndex} disabled={disabled} onChange={(e) => dispatch({ type: 'seek', stepIndex: Number(e.target.value) })} />
        <span className="player__counter" data-testid="player-counter">
          {disabled ? t('player.noSteps') : t('player.progress', { path: path ?? '', index: state.stepIndex + 1, total: stepCount })}
        </span>
        <select data-testid="player-speed" aria-label={t('player.speed')} value={state.speed} onChange={(e) => dispatch({ type: 'setSpeed', speed: Number(e.target.value) })}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
    </footer>
  );
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add workspace top bar, footer and logo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Workspace assembly, app switch, v1 web removal, E2E

**Files:**
- Create: `apps/web/src/workspace/Workspace.tsx`, `apps/web/e2e/workspace.spec.ts`
- Modify: `apps/web/src/main.tsx`
- Delete: `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/canvas/` (all), `apps/web/src/engine/frame.ts`, `apps/web/src/engine/navigation.ts`, `apps/web/src/panels/` (all), `apps/web/test/{frame,navigation,layout,toFlow,SceneNode,SceneGroup,SceneTabs,NarrationPanel,PayloadPanel,PlayerControls,LoadPanel,useSceneLayout}.test.*`, `apps/web/e2e/canvas.spec.ts`

**Interfaces:**
- Consumes: everything above; `reducePlayer`, `initialPlayerState` (`src/engine/player.ts`), `usePlaybackClock`.
- Produces: `<Workspace />` (default export not required); `THEME_STORAGE_KEY` persistence.

- [ ] **Step 1: Write the failing E2E spec**

`apps/web/e2e/workspace.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
  await page.goto('/');
  await page.getByTestId('scene-select').selectOption('checkout-en');
  await expect(page.getByTestId('node-worker')).toBeVisible();
});

test('levels change both the explorer and the canvas', async ({ page }) => {
  await expect(page.getByTestId('tree-item-group:orders-api')).toBeVisible();
  await expect(page.getByTestId('node-reserve-stock')).toHaveCount(0);
  await page.getByTestId('level-components').click();
  await expect(page.getByTestId('node-reserve-stock')).toBeVisible();
  await page.getByTestId('level-detail').click();
  await expect(page.getByTestId('node-lock-rows')).toBeVisible();
  await page.getByTestId('level-system').click();
  await expect(page.getByTestId('node-repo:orders-api')).toBeVisible();
  await expect(page.getByTestId('tree-item-repo:orders-api')).toBeVisible();
});

test('walkthrough plays in order and pieces activate', async ({ page }) => {
  await page.getByTestId('player-next').click();
  await expect(page.getByTestId('player-counter')).toHaveText('Step 2 · 2 / 5');
  await expect(page.getByTestId('node-orders-queue')).toHaveClass(/is-focused/);
  await expect(page.getByTestId('edge-token')).toBeVisible();
  await expect(page.getByTestId('now')).toContainText('The API validates');
  await page.getByTestId('player-speed').selectOption('2');
  await page.getByTestId('player-toggle').click();
  await expect(page.getByTestId('player-counter')).toHaveText('Step 3 · 3 / 5', { timeout: 5000 });
  await expect(page.getByTestId('node-worker')).toHaveClass(/is-active|is-focused/);
});

test('opening a step reveals internal pieces and sub-steps', async ({ page }) => {
  await page.getByTestId('step-toggle-s3').click();
  await expect(page.getByTestId('step-s3-1')).toBeVisible();
  await expect(page.getByTestId('node-reserve-stock')).toBeVisible();
  await page.getByTestId('step-s3-1').click();
  await expect(page.getByTestId('player-counter')).toContainText('Step 3.1');
  await page.getByTestId('step-toggle-s3').click();
  await expect(page.getByTestId('node-reserve-stock')).toHaveCount(0);
  await expect(page.getByTestId('player-counter')).toContainText('Step 3 ·');
});

test('the component card shows scale rows and code stays optional', async ({ page }) => {
  await page.getByTestId('node-inventory').click();
  await expect(page.getByTestId('scale-row-high')).toContainText('saturated');
  await expect(page.getByTestId('card')).toContainText('Does not scale');
  await expect(page.getByTestId('code-drawer')).toHaveCount(0);
  await page.getByTestId('level-components').click();
  await page.getByTestId('node-reserve-stock').click();
  await page.getByTestId('view-code').click();
  await expect(page.getByTestId('code-drawer')).toContainText('src/worker/reserve.ts:8-14');
  await page.getByTestId('code-close').click();
  await expect(page.getByTestId('code-drawer')).toHaveCount(0);
});

test('selecting a risk on an internal piece expands its parents', async ({ page }) => {
  await page.getByTestId('level-system').click();
  await page.getByTestId('mode-risks').click();
  await page.getByTestId('risk-r-lock').click();
  await expect(page.getByTestId('level-architecture')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('node-lock-rows')).toHaveClass(/is-focused/);
  await expect(page.getByTestId('risk-detail')).toContainText('Lock contention');
});

test('theme and language are configurable', async ({ page }) => {
  await page.getByTestId('theme-select').selectOption('paper');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await page.getByTestId('language-select').selectOption('es');
  await expect(page.getByTestId('level-architecture')).toHaveText('Arquitectura');
  await expect(page.getByTestId('regenerate')).toBeVisible();
  await page.getByTestId('scene-select').selectOption('checkout-es');
  await expect(page.getByTestId('regenerate')).toHaveCount(0);
});

test('repo groups are labelled and edges connect pieces', async ({ page }) => {
  await expect(page.getByTestId('group-group:orders-api')).toContainText('orders-api');
  await expect(page.locator('.edge-line').first()).toBeVisible();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run e2e -w @rdi/web -- workspace.spec.ts`
Expected: FAIL — `scene-select` not found (the v1 app is still mounted).

- [ ] **Step 3: Assemble the workspace**

`apps/web/src/workspace/Workspace.tsx`:
```tsx
import {
  computeVisible, flattenSteps, indexScene, numberSteps, projectEdges, sampleRegistry, sampleScenes, type Level, type Scene,
} from '@rdi/scene/v2';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { initialPlayerState, reducePlayer, type PlayerAction } from '../engine/player';
import { usePlaybackClock } from '../engine/usePlaybackClock';
import { useI18n } from '../i18n/I18nProvider';
import { applyTheme, resolveTheme, THEME_STORAGE_KEY, type ThemeId } from '../theme/themes';
import { Canvas } from './canvas/Canvas';
import { initialExplorerState, reduceExplorer, type ExplorerAction } from './engine/explorerState';
import { frameAt } from './engine/frame';
import { stepPhase } from './engine/phase';
import { resequenceCursor } from './engine/resequence';
import { risksByNode } from './engine/risks';
import { CodeDrawer } from './panels/CodeDrawer';
import { ExplorerPanel } from './panels/ExplorerPanel';
import { Footer } from './panels/Footer';
import { Inspector } from './panels/Inspector';
import { TopBar } from './panels/TopBar';
import './workspace.css';

const DEFAULT_LEVEL: Level = 'architecture';
const sceneFor = (language: string): Scene => sampleRegistry[`checkout-${language}`] ?? sampleRegistry['checkout-en'] ?? (sampleScenes[0] as Scene);

export const Workspace = () => {
  const { language } = useI18n();
  const [explorer, dispatchRaw] = useReducer(
    (state: ReturnType<typeof initialExplorerState>, action: ExplorerAction) => reduceExplorer(state, action, sampleRegistry[state.sceneId] ?? sceneFor(language)),
    undefined,
    () => initialExplorerState(sceneFor(language).id, DEFAULT_LEVEL),
  );
  const scene = sampleRegistry[explorer.sceneId] ?? sceneFor(language);
  const [player, dispatchPlayerRaw] = useReducer((s: typeof initialPlayerState, a: PlayerAction & { count: number }) => reducePlayer(s, a, a.count), initialPlayerState);
  const [theme, setTheme] = useState<ThemeId>(() => resolveTheme(localStorage.getItem(THEME_STORAGE_KEY)));

  useEffect(() => { applyTheme(document.documentElement, theme); localStorage.setItem(THEME_STORAGE_KEY, theme); }, [theme]);

  const index = useMemo(() => indexScene(scene), [scene]);
  const localSet = useMemo(() => new Set(explorer.localExpanded), [explorer.localExpanded]);
  const model = useMemo(() => computeVisible(scene, index, explorer.level, localSet), [scene, index, explorer.level, localSet]);
  const projected = useMemo(() => projectEdges(scene, model), [scene, model]);
  const openSet = useMemo(() => new Set(explorer.openSteps), [explorer.openSteps]);
  const flat = useMemo(() => flattenSteps(scene.steps, openSet), [scene, openSet]);
  const numbering = useMemo(() => numberSteps(scene.steps), [scene]);
  const byNode = useMemo(() => risksByNode(scene), [scene]);

  const dispatchPlayer = useCallback((action: PlayerAction) => dispatchPlayerRaw({ ...action, count: flat.length }), [flat.length]);
  usePlaybackClock(player.playing, (deltaMs) => dispatchPlayer({ type: 'tick', deltaMs }));

  const previousFlat = useRef(flat);
  useEffect(() => {
    if (previousFlat.current === flat) return;
    const next = resequenceCursor(previousFlat.current, flat, player.stepIndex, scene.steps);
    previousFlat.current = flat;
    if (next !== player.stepIndex) dispatchPlayer({ type: 'seek', stepIndex: next });
  }, [flat, player.stepIndex, scene.steps, dispatchPlayer]);

  const frame = useMemo(() => frameAt(model, projected, flat, player.stepIndex), [model, projected, flat, player.stepIndex]);
  const phase = stepPhase(player.progress, frame.active !== null);

  const selectedNode = explorer.selectedNodeId ? index.byId.get(explorer.selectedNodeId) ?? null : null;
  const selectedRisk = scene.risks.find((r) => r.id === explorer.selectedRiskId) ?? null;
  const codeNode = explorer.codeNodeId ? index.byId.get(explorer.codeNodeId) : undefined;
  const canOpenInside = Boolean(selectedNode && (index.children.get(selectedNode.id)?.length ?? 0) > 0 && !model.expanded.has(selectedNode.id));

  const loadScene = (id: string) => {
    previousFlat.current = [];
    dispatchRaw({ type: 'loadScene', sceneId: id, level: explorer.level });
    dispatchPlayer({ type: 'reset' });
  };

  return (
    <div className="ws">
      <TopBar
        scenes={sampleScenes} scene={scene} level={explorer.level} mode={explorer.mode} scaleOverlay={explorer.scaleOverlay} theme={theme}
        onSceneChange={loadScene} onLevel={(level) => dispatchRaw({ type: 'setLevel', level })} onMode={(mode) => dispatchRaw({ type: 'setMode', mode })}
        onToggleOverlay={() => dispatchRaw({ type: 'toggleScaleOverlay' })} onTheme={setTheme}
      />
      <div className="ws-body">
        <ExplorerPanel
          scene={scene} index={index} model={model} explorer={explorer} flat={flat} cursor={frame.index} numbering={numbering} byNode={byNode}
          onSelectNode={(id) => dispatchRaw({ type: 'selectNode', nodeId: id })} onToggleExpand={(id) => dispatchRaw({ type: 'toggleExpand', nodeId: id })}
          onSeek={(i) => dispatchPlayer({ type: 'seek', stepIndex: i })} onToggleStep={(id) => dispatchRaw({ type: 'toggleStep', stepId: id })}
          onSelectRisk={(id) => dispatchRaw({ type: 'selectRisk', riskId: id })} onSetMode={(mode) => dispatchRaw({ type: 'setMode', mode })}
        />
        <main className="ws-canvas">
          <Canvas
            scene={scene} index={index} model={model} projected={projected} frame={frame} phase={phase} explorer={explorer} byNode={byNode}
            onSelect={(id) => dispatchRaw({ type: 'selectNode', nodeId: id })} onToggleExpand={(id) => dispatchRaw({ type: 'toggleExpand', nodeId: id })}
            onOpenCode={(id) => dispatchRaw({ type: 'openCode', nodeId: id })} onOpenStep={(id) => dispatchRaw({ type: 'toggleStep', stepId: id })}
            onSelectRisk={(id) => dispatchRaw({ type: 'selectRisk', riskId: id })}
          />
          {codeNode && <CodeDrawer node={codeNode} onClose={() => dispatchRaw({ type: 'closeCode' })} />}
        </main>
        <Inspector
          frame={frame} selectedNode={selectedNode} risksForNode={selectedNode ? byNode.get(selectedNode.id) ?? [] : []}
          selectedRisk={selectedRisk} riskNodeLabels={selectedRisk ? selectedRisk.nodeIds.map((id) => index.byId.get(id)?.label ?? id) : []}
          canOpenInside={canOpenInside} onOpenInside={() => selectedNode && dispatchRaw({ type: 'toggleExpand', nodeId: selectedNode.id })}
          onViewCode={() => selectedNode && dispatchRaw({ type: 'openCode', nodeId: selectedNode.id })} onSelectRisk={(id) => dispatchRaw({ type: 'selectRisk', riskId: id })}
        />
      </div>
      <Footer state={player} stepCount={flat.length} path={frame.flat?.path ?? null} dispatch={dispatchPlayer} />
    </div>
  );
};
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n/I18nProvider';
import { Workspace } from './workspace/Workspace';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Remove the v1 web code and its tests**

Run:
```bash
cd apps/web
git rm -q src/App.tsx src/styles.css src/engine/frame.ts src/engine/navigation.ts e2e/canvas.spec.ts
git rm -rq src/canvas src/panels
git rm -q test/frame.test.ts test/navigation.test.ts test/layout.test.ts test/toFlow.test.ts test/SceneNode.test.tsx test/SceneGroup.test.tsx test/SceneTabs.test.tsx test/NarrationPanel.test.tsx test/PayloadPanel.test.tsx test/PlayerControls.test.tsx test/LoadPanel.test.tsx test/useSceneLayout.test.ts
cd ../..
grep -rn "from '\.\./canvas\|from '\./canvas\|panels/\(Narration\|Payload\|Load\|SceneTabs\)" apps/web/src || echo "no dangling imports"
```
Expected: `no dangling imports`.

- [ ] **Step 5: Run the whole web suite, typecheck and E2E**

Run:
```bash
npm test -w @rdi/web && npm run typecheck -w @rdi/web
npm run e2e -w @rdi/web
```
Expected: unit tests PASS; typecheck clean; `7 passed`. If an E2E assertion fails, fix the implementation unless the assertion contradicts the spec (ledger a ruling if so).

- [ ] **Step 6: Visual check**

Run `npm run dev -w @rdi/web`, open http://localhost:5177, and verify by eye: Mission control look, edges touch piece borders with arrowheads, the white token moves hop by hop and the receiving piece pulses, callout under the focused piece, explorer tree changes per level, theme switch restyles everything. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): switch app to the v2 exploration workspace

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Promote Scene v2 to the package root

**Files:**
- Delete: `packages/scene/src/schema.ts`, `packages/scene/src/validate.ts`, `packages/scene/src/samples/` (v1), `packages/scene/test/validate.test.ts`, `packages/scene/test/samples.test.ts`
- Move: `packages/scene/src/v2/*` → `packages/scene/src/`, `packages/scene/test/v2/*` → `packages/scene/test/`
- Modify: `packages/scene/src/simulate.ts`, `packages/scene/test/simulate.test.ts`, `packages/scene/src/index.ts`, `packages/scene/package.json`, every `@rdi/scene/v2` import in `apps/web`

**Interfaces:**
- Produces: `@rdi/scene` exports the v2 API (everything previously under `@rdi/scene/v2`) plus the simulator with a decoupled signature:
  ```ts
  type SimGraph = { nodes: { id: string }[]; edges: { id: string; from: string; to: string }[] }
  type LoadConfig = { rps: number; nodes: Record<string, { capacity: number; latencyMs: number }>; queues?: Record<string, { consumers: number; maxDepth?: number }> }
  simulateLoad(graph: SimGraph, load: LoadConfig | undefined, rps: number, elapsedSeconds?: number): LoadResult
  ```

- [ ] **Step 1: Update the simulator test first (RED)**

In `packages/scene/test/simulate.test.ts`, replace the `scene()` helper and its import so the test builds a plain graph and load config, and every `simulateLoad(s, …)` call passes `(s, s.load, …)`:
```ts
import { describe, expect, it } from 'vitest';
import { simulateLoad, type LoadConfig, type SimGraph } from '../src/index';

type Fixture = SimGraph & { load: LoadConfig };

const scene = (): Fixture => ({
  nodes: [{ id: 'client' }, { id: 'api' }, { id: 'queue' }, { id: 'worker' }, { id: 'db' }],
  edges: [
    { id: 'c-a', from: 'client', to: 'api' },
    { id: 'a-q', from: 'api', to: 'queue' },
    { id: 'q-w', from: 'queue', to: 'worker' },
    { id: 'a-d', from: 'api', to: 'db' },
  ],
  load: {
    rps: 40,
    nodes: { api: { capacity: 100, latencyMs: 20 }, queue: { capacity: 30, latencyMs: 5 }, worker: { capacity: 50, latencyMs: 100 }, db: { capacity: 200, latencyMs: 5 } },
    queues: { queue: { consumers: 2, maxDepth: 1000 } },
  },
});
```
Then mechanically rewrite each call: `simulateLoad(scene(), 40)` → `simulateLoad(scene(), scene().load, 40)`; inside tests that mutate `s`: `simulateLoad(s, 10)` → `simulateLoad(s, s.load, 10)`; `s.nodes.push({ id: 'cron', type: 'client', label: 'Cron', meta: {} })` → `s.nodes.push({ id: 'cron' })`; `s.edges.push({ id: 'cr-a', from: 'cron', to: 'api', kind: 'sync' })` → `s.edges.push({ id: 'cr-a', from: 'cron', to: 'api' })`; same for `w-a`. Expected numbers are unchanged.

Run: `npm test -w @rdi/scene -- simulate`
Expected: FAIL — `LoadConfig`/`SimGraph` are not exported and `simulateLoad` has the old signature.

- [ ] **Step 2: Decouple the simulator**

In `packages/scene/src/simulate.ts`:
- Replace `import type { Scene } from './schema';` with:
```ts
export type SimGraph = { nodes: { id: string }[]; edges: { id: string; from: string; to: string }[] };
export type LoadConfig = {
  rps: number;
  nodes: Record<string, { capacity: number; latencyMs: number }>;
  queues?: Record<string, { consumers: number; maxDepth?: number }>;
};
```
- Change `findBackEdges = (scene: Scene)` → `findBackEdges = (scene: SimGraph)`, `topologicalOrder = (scene: Scene, edges: Scene['edges'])` → `(scene: SimGraph, edges: SimGraph['edges'])`, and `new Map<string, Scene['edges']>()` → `new Map<string, SimGraph['edges']>()`.
- Change the exported signature to `export const simulateLoad = (scene: SimGraph, load: LoadConfig | undefined, rps: number, elapsedSeconds = DEFAULT_ELAPSED_SECONDS): LoadResult => {` and replace `scene.load?.nodes[id]` with `load?.nodes[id]` and `scene.load?.queues?.[id]` with `load?.queues?.[id]`.

- [ ] **Step 3: Promote v2 and delete v1**

Run:
```bash
cd packages/scene
git rm -q src/schema.ts src/validate.ts test/validate.test.ts test/samples.test.ts
git rm -rq src/samples
git mv src/v2/schema.ts src/schema.ts
git mv src/v2/validate.ts src/validate.ts
git mv src/v2/hierarchy.ts src/hierarchy.ts
git mv src/v2/walkthrough.ts src/walkthrough.ts
git mv src/v2/samples src/samples
git mv test/v2/validate.test.ts test/validate.test.ts
git mv test/v2/hierarchy.test.ts test/hierarchy.test.ts
git mv test/v2/walkthrough.test.ts test/walkthrough.test.ts
git mv test/v2/samples.test.ts test/samples.test.ts
git mv test/v2/fixture.ts test/fixture.ts
git rm -q src/v2/index.ts
cd ../..
sed -i '' "s#'../../src/v2/index'#'../src/index'#" packages/scene/test/*.ts
grep -rln "@rdi/scene/v2" apps/web | xargs sed -i '' "s#@rdi/scene/v2#@rdi/scene#g"
```

`packages/scene/src/index.ts`:
```ts
export * from './schema';
export * from './validate';
export * from './hierarchy';
export * from './walkthrough';
export * from './samples';
export * from './simulate';
```

In `packages/scene/package.json` set `"exports": { ".": "./src/index.ts" }`.

- [ ] **Step 4: Run everything**

Run:
```bash
grep -rn "v2" packages/scene/src packages/scene/test apps/web/src apps/web/test | grep -v "node_modules" || echo "no v2 references"
npm test && npm run typecheck && npm run e2e -w @rdi/web
```
Expected: `no v2 references` (plan-file mentions excluded); all unit tests PASS; typecheck clean; E2E `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(scene): promote scene v2 to the package root and decouple the simulator

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| §1 Scene v2 format + validation rules | 1 |
| §1 simulator kept for plan 3 | 15 |
| §2 Levels, local expansion, edge projection, focus/risk projection | 2, 7, 8 |
| §3 Layout: top bar, VS Code explorer, canvas, inspector, footer | 9, 10, 11, 12, 13, 14 |
| §4 Sequential walkthrough, token, activation, callout, sub-steps, payload | 3, 7, 8, 10, 11, 14 |
| §5 Component card with at-scale rows, strategy, risks, optional code, scale overlay | 8, 10, 12 |
| §6 Risks mode | 7, 10, 11, 12 |
| §7 Themes and language (regenerate prompt disabled until plan 3) | 5, 6, 13, 14 |
| §8 Generic samples (checkout es/en, IoT) | 4 |
| Testing section (unit, component, E2E) | every task + 14 |
