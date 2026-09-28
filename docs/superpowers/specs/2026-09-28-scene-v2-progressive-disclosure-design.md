# Scene v2 — In-context Explanations, Risks, Code on Demand, Progressive Disclosure

Extends: `docs/superpowers/specs/2026-09-28-repository-designer-ide-design.md` (section 2, "Scene format & animation"). Where this document and section 2 disagree, this document wins.

## Context

Plan 1 shipped a Scene format and canvas with four separate scene kinds (flow, algorithm, load, diff-impact) and web-backend-specific node types. Feedback from the user after trying it:

- Explanations must appear **on each part**, in context, not only in the side list.
- A dedicated section must show **risks and weak points**: performance, security, algorithmic complexity, algorithms, reliability.
- Code is shown **only if the user asks** to go into a component.
- It must stay **generic for any kind of system** (web, mobile, embedded, data pipelines, ML, CLI, games…).
- Keep the **grouping by repository** — the user likes it.
- Every step can be **opened into sub-steps**, recursively, revealing complexity and detail only when needed.

## Decisions

| Topic | Decision |
|---|---|
| Opening a step | Expands a node **in place** on the same canvas, revealing its internal pieces; sub-steps walk those pieces. Replaces the separate "zoom into another scene" mechanism. Unlimited nesting. |
| Generic node model | Small set of abstract **roles** that drive visuals + free-text **kind** written by the agent |
| Risk categories | `performance` (performance & scale), `security`, `complexity` (algorithmic complexity), `reliability` (reliability & consistency) |
| Scene kinds | Removed. A scene enables modes from its content: walkthrough (steps), risks (risks), load (load config), changes (any node with `change`) |
| Grouping | Automatic by node `repo`; explicit `groups` optional for other boundaries |
| Code | Only via "View code"; snippet from the scene until indexing exists (plan 2), then fetched from the repo |

## 1. Scene format v2

```ts
Scene {
  id, title, summary?                                  // one-paragraph overview
  nodes: [{
    id, label,
    role: 'actor' | 'compute' | 'storage' | 'channel' | 'external' | 'logic' | 'data',
    kind: string,                                      // free text: "Kafka topic", "React hook", "GPU kernel", "cron job"
    summary: string,                                   // 1–2 sentences, shown in context
    details?: string,                                  // longer explanation, shown in the detail card
    parent?: nodeId,                                   // internal piece of another node (hidden until the parent is expanded)
    repo?: string,                                     // drives automatic grouping (top-level nodes only)
    complexity?: { time: string, space?: string, note?: string },   // for role 'logic'
    code?: { repo: string, path: string, startLine: number, endLine: number, language: string, snippet?: string },
    change?: 'added' | 'modified' | 'removed',
    graphRef?: string,
  }]
  edges: [{ id, from, to, kind: 'sync' | 'async' | 'read' | 'write' | 'calls', label? }]   // may connect internal pieces
  groups?: [{ id, label, nodeIds }]                    // optional explicit boundaries; default = group top-level nodes by repo
  steps: Step[]
  risks?: Risk[]
  load?: { rps, nodes: Record<id, { capacity, latencyMs }>, queues?: Record<id, { consumers, maxDepth? }> }
}

Step {
  id, narration,
  focus: nodeId[], travel?: { edgeId, payload? }, highlight?: nodeId[], annotate?: [{ nodeId, text }],
  payload?: { format: 'json' | 'sql' | 'text', before?, after? },
  expand?: nodeId,                                     // opening this step expands that node
  substeps?: Step[],                                   // recursive
}

Risk {
  id, category: 'performance' | 'security' | 'complexity' | 'reliability',
  severity: 'low' | 'medium' | 'high' | 'critical',
  title, explanation, nodeIds: nodeId[], mitigation?,
}
```

Validation rules (errors stay `"<dotted.path>: <message>"` so they can be fed back to the agent):
- Node, edge, group, step and risk ids unique within their kind; group ids must not collide with node ids.
- `parent` must reference an existing node; no parent cycles.
- `expand` must reference a node that has children; `substeps` only allowed on a step with `expand`.
- Sub-step `focus`/`travel`/`highlight`/`annotate` may reference the expanded node's descendants or any node visible at that depth.
- `risks[].nodeIds` must exist; `complexity` only on `logic` nodes.
- `load` keys must exist; `queues` keys must be `channel` nodes.
- `code.startLine <= code.endLine`.

## 2. Visibility and layout

- **Expanded set** = nodes whose steps are currently open (plus nodes opened from a detail card or a risk).
- A node is **visible** when every ancestor is expanded. An expanded node renders as a compound container holding its visible children.
- Every edge is **drawn between the nearest visible ancestors** of its endpoints; edges collapsing to the same pair are merged; edges whose endpoints collapse to the same node are hidden.
- Top-level nodes are grouped by `repo` (group label = repo name) unless explicit `groups` are given. Nodes without `repo` stay ungrouped.
- ELK lays out the visible hierarchy (groups → expanded nodes → children) whenever the expanded set changes.

## 3. Walkthrough with progressive disclosure

- The left panel "Walkthrough" tab shows the step tree. A step with `substeps` shows ▸; opening it adds its `expand` node to the expanded set and reveals `3.1, 3.2…`.
- **Playback order** = depth-first over open steps only (a closed step's sub-steps are skipped). Default: only top-level steps.
- Collapsing a step collapses its node (and any descendants opened by its sub-steps) and moves the cursor to that step if it was inside.
- The current step's **callout** (narration + focused piece summary) is anchored next to the first focused node on the canvas.

## 4. Detail card, risks and code

- **Detail card** (click or hover on any piece): label, kind, role, summary, details, complexity, the risks touching it, and actions **"Open inside"** (has children) and **"View code"** (has `code`).
- **Risks tab**: grouped by category, ordered by severity, filterable by category and severity. Clicking a risk highlights its nodes (others dim), expands ancestors of hidden ones, and shows explanation + mitigation. Each node shows a badge with the maximum severity of its risks.
- **Code drawer**: opened only from "View code"; shows `repo/path:start-end` and the snippet with basic syntax highlighting; if there is no snippet, shows the location and a "code available after indexing" note.

## 5. Modes

The canvas toolbar shows only the modes the scene supports: **Walkthrough**, **Risks**, **Load** (RPS slider, estimates label — unchanged model), **Changes** (dims unchanged nodes). The load simulator runs on top-level visible nodes.

## 6. Samples

Replace the Cvent/speaker samples (Sessionboard-specific) with:
1. **"Checkout & order processing"** — web store: client, API, payment provider, order queue, worker, inventory DB, email; sub-steps down to the stock reservation algorithm (logic nodes with complexity); risks in all four categories; load config; a few `change` markers.
2. **"IoT telemetry ingestion"** — non-web: devices, MQTT broker, stream processor with windowed aggregation (logic sub-pieces), time-series store, alerting; risks and sub-steps.

## Testing

- Unit: v2 validation (hierarchy, expand/substeps, risks, code), visibility + edge re-routing, playback order over an open step tree, risk → nodes-to-expand.
- Component: detail card, risks panel (grouping, filtering, selection), code drawer, step tree.
- E2E: open a step → internal pieces appear and sub-steps play; click a risk on an internal piece → parent expands and piece is highlighted; "View code" opens the drawer; load and changes modes still work; repo groups labeled.

## Out of scope

Real code fetching (plan 2/3), agent generation (plan 3), editing scenes by hand in the UI.
