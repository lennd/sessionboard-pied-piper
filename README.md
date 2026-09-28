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
