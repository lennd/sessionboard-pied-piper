# Repository Designer

A local desktop companion for Claude Code. It draws the map of a repository and
shows, without reading code, which pieces a change touches, what depends on them
and what could break.

Everything runs on this computer. The agent is the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)
driving the Claude Code binary bundled with it, so every token goes through your
own Claude login. Scenes, conversations and solutions are JSON files inside
`<repo>/.rdi/` (self-ignored by git); the list of opened folders and your
preferences live in `~/.rdi/`.

## What it does

- **Map** — one click asks Claude to draw the architecture of the folder
  (pieces, flows, walkthrough, risks, scale). The map is cached per commit.
- **Sessions** — the sessions you run with `claude` in that folder appear in
  the workspace as a live timeline (prompts, edits with diffs, commands, tests).
  Their edits are overlaid on the map in *changes* mode with zero tokens.
  "Explain this change" asks Claude for a proper impact scene with risks.
- **Chat** — analyze or plan over the repository; plans become versioned
  Solutions.
- **Run here** — a Solution can be implemented by Claude Code from the app:
  edits are applied directly, other commands ask for your approval, progress
  is reported back through a local MCP server (`/mcp/<repoId>`), and the run
  shows up in the Sessions timeline like any other session.

## Development

```bash
npm install
npm run dev             # core on http://127.0.0.1:4040 + web on http://localhost:5177
RDI_FAKE_AGENT=true npm run dev   # scripted agent, no Claude calls
npm test && npm run typecheck
```

Open http://localhost:5177, add the path of a folder and draw its map.

### Desktop app

```bash
npm run desktop:dev     # Electron window over the dev servers
npm run desktop:build   # packaged app in apps/desktop/release/
```

### Layout

| Workspace | Purpose |
| --- | --- |
| `apps/core` | Fastify core: repositories, JSON storage, Agent SDK runner, session observer, impact overlay, runs, MCP |
| `apps/web` | React workspace (canvas, walkthrough, risks, scale) and shell |
| `apps/desktop` | Electron shell that spawns the core and loads the web app |
| `packages/scene` | Scene schema, validation, hierarchy, walkthrough, load simulator |

Configuration is read from the environment (see `.env.example`): `RDI_PORT`,
`RDI_HOME`, `RDI_CLAUDE_HOME`, `RDI_FAKE_AGENT`, `AGENT_MODEL`,
`AGENT_MAX_TURNS`, `AGENT_MAX_BUDGET_USD`, `CLAUDE_EXECUTABLE`.

Design notes: `docs/superpowers/specs/2026-10-13-rdi-desktop-design.md`.
