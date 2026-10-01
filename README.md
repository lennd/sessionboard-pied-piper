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

The API applies database migrations on start. With `RDI_DEV_ROUTES=true` (never in production) it also serves
`/api/dev/mailbox?to=<email>` so you can read verification, reset and invitation emails locally.

### Indexing

`npm run dev` also starts `apps/worker`, which consumes the `index-repo` BullMQ queue. Without GitHub App settings
(`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_STATE_SECRET`) the
Repositories screen offers the bundled demo repositories under `fixtures/repos`. The indexed graph lives in Neo4j
(browser at http://localhost:7477) and the workspace opens an automatically generated **System map**.

### Agent

The chat in the workspace (✦ in the activity bar) talks to Claude through the Anthropic API. Set `ANTHROPIC_API_KEY`
(or `AGENT_ENABLED=true` with an `ant auth login` profile) before `npm run dev`; `AGENT_MODEL` defaults to
`claude-opus-5` and `AGENT_MONTHLY_TOKEN_BUDGET` to 2,000,000 tokens per organization. For offline development and the
E2E suite, `RDI_FAKE_LLM=true` uses a deterministic scripted agent (never in production).

### Solutions and Claude Code

Describe a change in the chat ("I want …") and the agent saves a versioned **Solution** (current vs proposed scene, task
plan, risks) under Settings → Solutions. Open it to see the plan next to the canvas and press **Execute in Claude Code**:
the dialog creates a personal access token and gives you the two commands to connect the remote MCP server
(`POST /mcp`, Streamable HTTP, `Authorization: Bearer rdi_…`) and start Claude Code on the solution. Claude Code reads it
with `get_solution`, queries the graph with `query_graph`, saves new versions with `update_solution` and reports
`report_task_progress`; the Solution page updates live. Set `PUBLIC_API_URL` when the API is not on `http://localhost:4040`.

### Connect your GitHub repositories

In Settings → Repositories press **Create GitHub App** (shown on local/dev servers when no App is configured). Choose your
account or an organization, confirm on GitHub, and you are taken straight to the installation page: install it on your
account and/or on organizations. GitHub then asks you to authorize the App once, so the server can check that the
installation really belongs to you. If an organization admin must approve the install, the page says so; once approved,
press **Connect another account** and save on GitHub to finish. Press **Connect another account** to add more installations; repositories from every connected account are listed and indexed with their own installation
token. On localhost the App's webhook is inactive, so use **Re-index** after pushing. Production deployments configure
the App with `GITHUB_APP_*` environment variables instead; stored manifest credentials are ignored there.
