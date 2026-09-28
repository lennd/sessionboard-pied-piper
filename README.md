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
