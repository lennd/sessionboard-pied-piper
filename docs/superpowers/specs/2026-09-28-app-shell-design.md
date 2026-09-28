# App Shell — Accounts, Tenant, Repositories, Preferences, UI Language

Extends: `docs/superpowers/specs/2026-09-28-repository-designer-ide-design.md` (SaaS product, `org_id` everywhere). Companion spec: `2026-09-28-scene-v2-progressive-disclosure-design.md`. Validated mockup: `.superpowers/brainstorm/68801-1790614588/content/app-shell-v1-1.html`.

## Context

The product needs the SaaS surfaces around the exploration experience: sign-in, the organization (tenant) and its members, connecting and monitoring repositories, and personal preferences — including a configurable language and theme. The user chose **own accounts with email + password**; GitHub is used only to connect repositories (GitHub App), not to sign in.

## Decisions

| Topic | Decision |
|---|---|
| Sign-in | Email + password accounts owned by the product; GitHub only for repository access |
| Tenant | One tenant = one organization; a user can belong to several; roles `owner`, `admin`, `member` |
| Joining | "Create organization" (creator becomes owner) or accept an email invitation |
| Languages | UI and explanations configurable separately; supported: `es`, `en`, `pt` (Portuguese, Brazilian) |
| Settings precedence | user preference → organization default → system default (`en` UI / `en` explanations / `mission` theme / `architecture` level) |
| Visual style | Mission control, same theme tokens as the exploration experience |

## 1. Accounts and sessions

- Sign up: email, name, password (min 12 chars, checked against a small common-password list); email verification link before first sign-in.
- Password hashing: **argon2id**. Password reset by single-use, 30-minute token sent by email.
- Sessions: opaque random session id in an `HttpOnly; Secure; SameSite=Lax` cookie, stored server-side (Postgres `sessions`, 30-day sliding expiry, revocable). Sign-out revokes the session.
- Protection: per-IP and per-email rate limit on sign-in, sign-up and reset (Redis); generic error messages ("email or password is incorrect"); state-changing requests require the session cookie plus a CSRF token header.
- Email delivery through a provider interface; local dev writes emails to the console/log.

## 2. Organizations and members

- Create organization → user becomes `owner`. Org fields: `name`, `slug`, `default_ui_language`, `default_explanation_language`, `default_theme`.
- Members page: list with role; `owner`/`admin` can invite by email (7-day token), resend or revoke invitations, change roles, remove members. At least one owner must remain.
- Org switcher in the top bar when the user belongs to several orgs; the current org is part of every API route (`/orgs/:orgId/...`) and every query is filtered by it.
- Permissions: `owner` — everything, including deleting the org and transferring ownership; `admin` — members, repositories, org settings; `member` — explore, preferences.

## 3. Repositories

- **Connect GitHub**: owner/admin installs the GitHub App on their GitHub organization and picks repositories (read-only). The installation is linked to the tenant.
- Repositories page: table with repository, branch (default branch, editable), detected languages, indexing status, last sync, actions (re-index, remove); header shows the connected GitHub org and "N of 10 repos" (phase-1 limit); "Manage on GitHub ↗".
- Indexing status per repository with stage breakdown: clone → parse → detect → summarize → link across repos, each `pending | running | done | error` with progress and error message (e.g. "repo > 500k LOC"). Statuses are produced by the indexing pipeline (plan 2); this shell renders them and exposes "retry".
- Removing a repository deletes its graph data and clones.

## 4. Preferences (per user)

- UI language, explanation language, theme, initial exploration level — each with an "Use organization default" option.
- Changing UI language applies immediately without reload. Changing explanation language affects new scenes; existing scenes show "Regenerate in <language>".

## 5. Organization settings (General)

Name, default UI language, default explanation language, default theme. Visible to all; editable by owner/admin.

## 6. UI internationalization

- All UI strings go through message catalogs (`es`, `en`, `pt`), keyed by stable ids; missing keys fall back to `en` and are reported in dev.
- Dates, numbers and relative times ("4 min ago") formatted with `Intl` in the active locale.
- Language picker also on the sign-in page (stored locally until signed in).
- Scene prose is not translated by the UI — it is generated in the explanation language (exploration spec §7).

## 7. Screens

1. **Sign in** — product pitch on the left; email, password, "Sign in", "Forgot password?", "Create organization", "I have an invitation", language picker.
2. **Sign up / accept invitation / verify email / reset password** — single-column forms in the same style.
3. **Settings → General** (org), **Members**, **Repositories**, **Usage & limits** (read-only counters: repos, indexed pieces, agent budget — agent numbers arrive in plan 3), **Preferences** (user), **Security** (change password, active sessions with revoke).
4. **Empty state** after creating an org: guided "Connect GitHub → pick repos → first map".

## Data (Postgres)

`users(id, email unique, name, password_hash, email_verified_at, ui_language?, explanation_language?, theme?, initial_level?, created_at)`, `sessions(id, user_id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip)`, `orgs(id, name, slug unique, default_ui_language, default_explanation_language, default_theme, created_at)`, `memberships(org_id, user_id, role)`, `invitations(id, org_id, email, role, token_hash, expires_at, accepted_at, revoked_at)`, `email_tokens(id, user_id, kind: verify|reset, token_hash, expires_at, used_at)`, `github_installations(id, org_id, installation_id, account_login)`, `repos(id, org_id, installation_id, full_name, default_branch, languages, status, stages jsonb, last_synced_at)`. Every tenant table carries `org_id`; tokens are stored hashed.

## Testing

- Unit: password policy, token lifetimes, settings precedence resolution, role permission matrix, i18n fallback.
- Integration (real Postgres/Redis): sign-up → verify → sign-in → session cookie → sign-out; reset flow; invitation accept; last-owner guard; rate limit; tenant isolation (a member of org A gets 404 on org B routes); CSRF rejection.
- E2E: create org, invite member (email captured from dev mailbox), switch language to Español and see UI strings change, change theme, repositories page renders stage statuses from seeded data.

## Out of scope

SSO/SAML, social login, billing, 2FA (hardening phase), the GitHub App installation callback internals and the indexing pipeline itself (plan 2).
