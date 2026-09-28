# Exploration Experience v2 — Explorer, Levels, Sequential Flow, Scale, Risks, Themes

Extends: `docs/superpowers/specs/2026-09-28-repository-designer-ide-design.md` (section 2, "Scene format & animation"). Where this document and section 2 disagree, this document wins. Companion spec: `2026-09-28-app-shell-design.md` (login, tenant, repositories, preferences, UI language).

## Context

Plan 1 shipped a Scene format and canvas with four separate scene kinds (flow, algorithm, load, diff-impact) and web-backend-specific node types. After trying it, the user asked for:

- Explanations **on each part**, in context — not only in a side list.
- A section with **risks and weak points**: performance, security, algorithmic complexity, algorithms, reliability.
- Code **only if the user asks** to go into a component.
- **Generic for any kind of system** (web, mobile, embedded, data pipelines, ML, CLI, games…).
- Keep the **grouping by repository**.
- Every step can be **opened into sub-steps**, recursively, revealing detail only when needed.
- A much friendlier, more advanced UI; the feature seen at **different levels** (system, architecture, component, detail).
- A left sidebar that **feels like navigating a directory in VS Code**, with component icons, different at each level.
- A center that is **animated and sequential**: see things flow and components activate, one step at a time.
- In the right panel, for each component, **what could go wrong at low, medium and high data volume**, and whether it scales.
- Configurable **themes** and **language**.

Visual direction chosen in the brainstorming companion: **"Mission control"** (dark, technical, monospace), with a theme switcher. Validated mockups: `.superpowers/brainstorm/68801-1790614588/content/flow-scale-card-v4.html` (exploration) and `app-shell-v1-1.html` (shell).

## Decisions

| Topic | Decision |
|---|---|
| Visual direction | Mission control layout; themes switch tokens only (colors, fonts, radii) |
| Themes | `mission` (default), `studio`, `paper` (light), `contrast` (high contrast, WCAG AAA) |
| Levels | Global selector: **System → Architecture → Components → Detail**, mapped onto the node hierarchy; any single piece can also be opened deeper without changing the global level |
| Opening a step | Expands a node **in place**, revealing internal pieces; sub-steps walk them. Replaces "zoom into another scene". Unlimited nesting |
| Generic node model | Abstract **roles** drive visuals + free-text **kind** written by the agent |
| Center canvas | **One request, sequential**: the token travels hop by hop, the receiving piece activates, then the next hop starts. No volume switcher on the canvas |
| Volume / scale | Shown in the **component card**: per piece, a low / medium / high row with a status and the likely problem, plus how it scales |
| Risk categories | `performance`, `security`, `complexity`, `reliability` |
| Scene kinds | Removed. Modes come from content: walkthrough (steps), risks (risks), changes (any node with `change`) |
| Grouping | Automatic by node `repo`; explicit `groups` optional |
| Code | Only via "View code" (never shown by default) |
| Explanation language | Each scene records the `language` it was written in; UI offers "Regenerate in <language>" when it differs from the user's explanation language |

## 1. Scene format v2

```ts
Scene {
  id, title, summary?,
  language: string,                                    // BCP-47 of all prose in the scene, e.g. "es", "en", "pt-BR"
  nodes: [{
    id, label,
    role: 'actor' | 'compute' | 'storage' | 'channel' | 'external' | 'logic' | 'data',
    kind: string,                                      // free text: "Kafka topic", "React hook", "GPU kernel", "cron job"
    summary: string,                                   // 1–2 sentences, shown in context
    details?: string,
    parent?: nodeId,                                   // internal piece of another node
    repo?: string,                                     // automatic grouping (top-level nodes)
    complexity?: { time: string, space?: string, note?: string },   // role 'logic'
    scale?: {                                          // what could go wrong as data volume grows
      low:    { status: ScaleStatus, note: string },
      medium: { status: ScaleStatus, note: string },
      high:   { status: ScaleStatus, note: string },
      strategy: 'horizontal' | 'vertical' | 'none' | 'external' | 'n/a',
      advice?: string,                                 // what it needs in order to scale
    },
    code?: { repo: string, path: string, startLine: number, endLine: number, language: string, snippet?: string },
    change?: 'added' | 'modified' | 'removed',
    graphRef?: string,
  }]
  edges: [{ id, from, to, kind: 'sync' | 'async' | 'read' | 'write' | 'calls', label? }]
  groups?: [{ id, label, nodeIds }]
  steps: Step[]
  risks?: Risk[]
}

ScaleStatus = 'ok' | 'strained' | 'limit' | 'saturated'      // UI: holgado / exigido / al límite / saturado

Step {
  id, narration,
  focus: nodeId[], travel?: { edgeId, reverse?: boolean, payload? }, highlight?: nodeId[], annotate?: [{ nodeId, text }],
  payload?: { format: 'json' | 'sql' | 'text', before?, after? },
  expand?: nodeId, substeps?: Step[],
}

Risk {
  id, category: 'performance' | 'security' | 'complexity' | 'reliability',
  severity: 'low' | 'medium' | 'high' | 'critical',
  title, explanation, nodeIds: nodeId[], mitigation?,
}
```

Validation (errors stay `"<dotted.path>: <message>"`, fed back to the agent):
- Ids unique per kind (nodes, edges, groups, steps, risks); group ids must not collide with node ids.
- `parent` exists, no parent cycles. `expand` references a node with children; `substeps` only on steps with `expand`.
- Step references (`focus`, `travel.edgeId`, `highlight`, `annotate`) exist. A sub-step may reference descendants of its `expand` node.
- `risks[].nodeIds` exist; `complexity` only on `logic` nodes; `code.startLine <= code.endLine`.
- `language` is a non-empty BCP-47-looking tag.

The plan-1 `load` config and `simulateLoad` are not part of v2's UI. The simulator stays in `packages/scene` so plan 3's agent can derive `scale` rows from capacities when it has them.

## 2. Levels and visibility

- **Depth** of a node = number of ancestors. Levels map to what is visible:
  - **System** — each repo group collapses into one box (label = repo); nodes without `repo` stay as they are. Edges are drawn between the boxes.
  - **Architecture** — depth-0 nodes inside their repo groups.
  - **Components** — every depth-0 node with children is expanded (depth ≤ 1 visible).
  - **Detail** — everything expanded.
- **Local expansion**: "Open inside" on a piece (card, explorer or step) expands that piece only; the global level is unchanged.
- An edge is drawn between the **nearest visible ancestors** of its endpoints; duplicates are merged; edges collapsing onto one node are hidden.
- Step `focus` / `travel` / risk `nodeIds` pointing at hidden nodes are **projected** onto their nearest visible ancestor, so the walkthrough and risks work at every level.
- ELK re-lays out the visible hierarchy (groups → expanded nodes → children) when the level or local expansion changes.

## 3. Layout

Three columns plus a top bar and a footer, as in the v4 mockup:

- **Top bar**: scene title · level selector (System / Architecture / Components / Detail) · mode tabs (Walkthrough, Risks, Changes — only those the scene supports) · theme switcher.
- **Left — Explorer (VS Code style)**:
  - Activity bar with icons: Explorer, Walkthrough, Risks, Changes.
  - **Explorer tree** of the visible hierarchy at the current level, with role icons (actor 🖥, compute ⚙, storage 🛢, channel ☰, external ☁, logic ƒ, data {}), a max-risk-severity dot, and ▸/▾ to expand locally. Selecting an item selects the piece on the canvas.
  - Collapsible sections below: **Walkthrough** (step tree, done steps struck through, current highlighted) and **Risks** (count + list).
- **Center — Canvas**: repo groups, pieces, SVG edges with arrowheads that start/end exactly on piece borders, edge labels off the line. Animated sequential walkthrough (section 4). Click a piece → select it.
- **Right — Inspector**: **Now** box (what is happening in the current step, in plain language) and the **component card** (section 5).
- **Footer**: ⏮ ▶ ⏭, speed 0.5× / 1× / 2×, progress, "step 3.1 / 7 · level".

## 4. Sequential walkthrough

- Playback walks open steps depth-first (closed steps' sub-steps are skipped). Default: top-level only.
- For each step with `travel`: the token (white) moves along the edge (≈700 ms at 1×; reverse when `reverse`), the active edge turns white with a white arrowhead, then the receiving piece **activates** (glow + short pulse) for the step's dwell time; then the next step begins. Steps without `travel` just activate their `focus`.
- The **Now** box and a callout anchored next to the focused piece show the step narration; the callout has actions "▸ open detail" (if `expand`), "⟨/⟩ view code" (if the piece has `code`), "⚠ N risks".
- Opening a step (tree ▸, callout or explorer) expands its node, relayouts, and its sub-steps join the sequence.
- Payload examples (`payload.before/after`) show in the left panel under the walkthrough as an animated line diff.

## 5. Component card (right panel)

For the selected piece: label, `role · kind`, summary, details (collapsible), complexity (logic pieces), and:
- **At scale · likely problems**: three rows — LOW / MEDIUM / HIGH — each with a status glyph and color (`ok` ✓ green, `strained` ● yellow, `limit` ▲ orange, `saturated` ✕ red) and the note; below, the scaling strategy ("scales horizontally", "does not scale", "external provider") and `advice`.
- **Risks** touching the piece (category, severity, title; click → Risks mode focused on it).
- **"⟨/⟩ View code (optional)"** button → code drawer (repo/path:lines + snippet with basic highlighting; "available after indexing" when no snippet).
- On the canvas, each piece's border and load bar take the color of its **worst** scale status when the Risks/scale overlay is on (toggle in the top bar), so hotspots are visible at a glance.

## 6. Risks mode

List grouped by category, ordered by severity, filterable. Selecting a risk highlights its pieces (others dim), expands ancestors of hidden ones, and shows explanation + mitigation in the inspector.

## 7. Themes and language

- Themes are CSS custom-property sets (`--bg`, `--panel`, `--line`, `--text`, `--muted`, `--accent`, scale colors, `--font`, `--radius`) applied on the app root; the four themes above. The effective theme comes from user preference → org default → `mission` (app-shell spec).
- Prose inside a scene is in `scene.language`. When it differs from the user's effective explanation language, the top bar shows "Regenerate in <language>" (wired to the agent in plan 3; disabled until then). UI chrome strings come from the UI i18n catalogs (app-shell spec).

## 8. Samples

Replace the Cvent/speaker samples (Sessionboard-specific) with:
1. **Checkout & order processing** (web store): checkout → api → orders queue → worker (internal: reserveStock / charge / emit) → inventory, payments; risks in all four categories; `scale` on every piece (worker: horizontal; inventory: none — row locks); a few `change` markers. Written in `es` with an `en` twin to exercise language.
2. **IoT telemetry ingestion** (non-web): devices → MQTT broker → stream processor (internal: windowed aggregation, dedupe) → time-series store → alerting; risks, scale, sub-steps.

## Testing

- Unit: v2 validation; level → visible set; edge projection/merging; step/risk projection to visible ancestors; playback order over an open step tree; scale-status color mapping; theme resolution.
- Component: explorer tree per level, walkthrough tree, component card (scale rows, risks, code button), risks panel, code drawer, theme switcher.
- E2E: switch levels and see the explorer and canvas change; play the walkthrough and see pieces activate in order; open a step to reveal internal pieces; select a piece and read its scale rows; click a risk on an internal piece → parent expands; "View code" opens the drawer; switch theme.

## Out of scope

Real code fetching (plan 2/3), agent generation and regeneration in another language (plan 3), editing scenes in the UI, volume simulation on the canvas.
