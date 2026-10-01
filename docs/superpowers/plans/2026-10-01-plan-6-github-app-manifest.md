# Plan 6 — One-click GitHub App and multiple accounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a user connect real repositories without hand-registering a GitHub App. A "Create GitHub App" button uses GitHub's **App Manifest flow** (form POST to GitHub, then `POST /app-manifests/{code}/conversions`) to create the App on the user's account or an organization, store its credentials, and continue straight to the installation. One organization in the product can connect **several GitHub accounts** (personal + orgs), and the worker clones with whichever App is configured.

**Architecture:** A `github_app` singleton table holds manifest-created credentials (local/dev only: the flow and DB-stored credentials are refused in production, where env vars remain the only source). A `resolveGithubApp(deps)` helper returns the active App (env first, then DB; cached) as `{ config, client }`, and every GitHub call site uses it instead of `deps.config.github` / `deps.github`. Installations are listed per product org (many), and available repos carry the installation they come from. The worker resolves the GitHub client per job the same way.

**Tech Stack:** GitHub REST (`/app-manifests/{code}/conversions`, installations API), Fastify, Postgres, React.

**Spec:** phase-1 spec §3 (GitHub App, installation tokens) and app-shell spec §3 (Repositories: connect GitHub). User decision 2026-10-01: manifest button; repos in a personal account and in organizations.

## Global Constraints

- The manifest flow is available only when `NODE_ENV !== 'production'` **and** no App is configured through env. DB-stored credentials are ignored in production.
- The manifest `state` is random, single-use (Redis `GETDEL`), bound to the user and product org, and expires in 1 hour.
- The App is created **public** (installable on other accounts and organizations) with read-only permissions: `contents: read`, `metadata: read`, `pull_requests: read`. It subscribes to `push`. Its webhook is inactive when `PUBLIC_API_URL` is a localhost URL.
- Callback and setup URLs go through the web origin (`APP_URL`), so the session cookie is sent: `${APP_URL}/api/github/manifest/callback` and `${APP_URL}/api/github/setup`.
- Secrets never reach logs or API responses. Tests stub GitHub with an injected `fetch` (`AppDeps.fetch`).
- Comments in English; UI strings via `t()` (en/es/pt); commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A forged, reused or expired manifest `state` never stores credentials.
2. Once an App exists (env or DB), the manifest flow is refused (no silent replacement).
3. Repos from two installations in one product org each clone with their own installation token.
4. A production deployment never uses DB-stored credentials or offers the button.

---

### Task 1: Manifest helpers in `@rdi/providers`

**Files:** `packages/providers/src/manifest.ts`, `src/index.ts`; test `packages/providers/test/manifest.test.ts`.

**Produces:**
```ts
type ManifestInput = { name: string; appUrl: string; publicApiUrl: string }
buildAppManifest(input): Record<string, unknown>   // name, url, hook_attributes {url, active}, redirect_url, setup_url, setup_on_update, public, default_permissions, default_events
manifestPostUrl(owner: { type: 'user' } | { type: 'org'; login: string }, state): string
type ManifestApp = { appId: string; slug: string; name: string; htmlUrl: string; ownerLogin: string; privateKey: string; webhookSecret: string; clientId: string; clientSecret: string }
exchangeManifestCode(code: string, fetchImpl?: typeof fetch, apiUrl?: string): Promise<ManifestApp>
isLocalUrl(url: string): boolean
```

- [ ] **Test (RED)**
```ts
import { describe, expect, it, vi } from 'vitest';
import { buildAppManifest, exchangeManifestCode, isLocalUrl, manifestPostUrl } from '../src/index';

describe('buildAppManifest', () => {
  it('creates a public read-only app whose URLs go through the web origin', () => {
    const manifest = buildAppManifest({ name: 'Repository Designer abcd', appUrl: 'http://localhost:5177', publicApiUrl: 'http://localhost:4040' });
    expect(manifest).toEqual({
      name: 'Repository Designer abcd',
      url: 'http://localhost:5177',
      hook_attributes: { url: 'http://localhost:4040/api/github/webhook', active: false },
      redirect_url: 'http://localhost:5177/api/github/manifest/callback',
      setup_url: 'http://localhost:5177/api/github/setup',
      setup_on_update: true,
      public: true,
      default_permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' },
      default_events: ['push'],
    });
    expect((buildAppManifest({ name: 'x', appUrl: 'https://app.example.com', publicApiUrl: 'https://api.example.com' }).hook_attributes as { active: boolean }).active).toBe(true);
  });

  it('posts to the user or organization settings page with the state', () => {
    expect(manifestPostUrl({ type: 'user' }, 's 1')).toBe('https://github.com/settings/apps/new?state=s%201');
    expect(manifestPostUrl({ type: 'org', login: 'lennd' }, 's')).toBe('https://github.com/organizations/lennd/settings/apps/new?state=s');
  });

  it('recognizes local URLs', () => {
    expect(isLocalUrl('http://localhost:4040')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:4040')).toBe(true);
    expect(isLocalUrl('https://api.example.com')).toBe(false);
  });
});

describe('exchangeManifestCode', () => {
  it('converts the temporary code into app credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 123, slug: 'repository-designer-abcd', name: 'Repository Designer abcd', html_url: 'https://github.com/apps/repository-designer-abcd',
      owner: { login: 'hugo' }, pem: '-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----\n', webhook_secret: 'whs', client_id: 'Iv1', client_secret: 'cs',
    }), { status: 201 }));
    const app = await exchangeManifestCode('code123', fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/app-manifests/code123/conversions', expect.objectContaining({ method: 'POST' }));
    expect(app).toEqual({ appId: '123', slug: 'repository-designer-abcd', name: 'Repository Designer abcd', htmlUrl: 'https://github.com/apps/repository-designer-abcd', ownerLogin: 'hugo', privateKey: expect.stringContaining('BEGIN RSA'), webhookSecret: 'whs', clientId: 'Iv1', clientSecret: 'cs' });
  });

  it('fails clearly when GitHub rejects the code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
    await expect(exchangeManifestCode('bad', fetchMock as unknown as typeof fetch)).rejects.toThrow('GitHub API 404: Not Found');
  });
});
```

- [ ] **Implement**
```ts
const DEFAULT_API = 'https://api.github.com';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export type ManifestInput = { name: string; appUrl: string; publicApiUrl: string };
export type ManifestOwner = { type: 'user' } | { type: 'org'; login: string };
export type ManifestApp = { appId: string; slug: string; name: string; htmlUrl: string; ownerLogin: string; privateKey: string; webhookSecret: string; clientId: string; clientSecret: string };

export const isLocalUrl = (url: string): boolean => {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const buildAppManifest = ({ name, appUrl, publicApiUrl }: ManifestInput): Record<string, unknown> => ({
  name,
  url: appUrl,
  hook_attributes: { url: `${publicApiUrl}/api/github/webhook`, active: !isLocalUrl(publicApiUrl) },
  redirect_url: `${appUrl}/api/github/manifest/callback`,
  setup_url: `${appUrl}/api/github/setup`,
  setup_on_update: true,
  public: true,
  default_permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' },
  default_events: ['push'],
});

export const manifestPostUrl = (owner: ManifestOwner, state: string): string =>
  `${owner.type === 'org' ? `https://github.com/organizations/${encodeURIComponent(owner.login)}` : 'https://github.com'}/settings/apps/new?state=${encodeURIComponent(state)}`;

export const exchangeManifestCode = async (code: string, fetchImpl: typeof fetch = fetch, apiUrl = DEFAULT_API): Promise<ManifestApp> => {
  const response = await fetchImpl(`${apiUrl}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'repository-designer' },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { message?: string; owner?: { login?: string } };
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.message ?? 'request failed'}`);
  return {
    appId: String(body.id), slug: String(body.slug), name: String(body.name), htmlUrl: String(body.html_url), ownerLogin: String(body.owner?.login ?? ''),
    privateKey: String(body.pem), webhookSecret: String(body.webhook_secret), clientId: String(body.client_id), clientSecret: String(body.client_secret),
  };
};
```
Export from `index.ts`. Commit `feat(providers): add GitHub App manifest helpers`.

---

### Task 2: App credentials storage and runtime resolution (API)

**Files:** `apps/api/src/db/migrations/005_github_app.sql`, `apps/api/src/db/queries/githubApp.ts`, `apps/api/src/github/app.ts`; `http/deps.ts` (+ `fetch?: typeof fetch`); test `apps/api/test/githubApp.integration.test.ts`.

**Produces:**
```ts
// queries
saveGithubApp(db, app: ManifestApp & { stateSecret: string }): Promise<void>      // insert single row; throws if one exists
loadGithubAppRow(db): Promise<(ManifestApp & { stateSecret: string }) | null>
// runtime
type ActiveGithubApp = { source: 'env' | 'manifest'; config: { appId; privateKey; slug; webhookSecret; stateSecret }; client: GitHubClient; htmlUrl: string | null; ownerLogin: string | null }
resolveGithubApp(deps): Promise<ActiveGithubApp | null>   // env (deps.config.github + deps.github) first; then DB unless production; cached per deps after first DB hit
forgetGithubApp(deps): void                               // drop the cache after saving
manifestAvailable(deps): Promise<boolean>                 // !production && no active app
```

Migration:
```sql
create table github_app (
  id smallint primary key default 1 check (id = 1),
  app_id text not null,
  slug text not null,
  name text not null,
  html_url text not null,
  owner_login text not null,
  private_key text not null,
  webhook_secret text not null,
  client_id text not null,
  client_secret text not null,
  state_secret text not null,
  created_at timestamptz not null default now()
);
```

- [ ] **Test (RED):** with `createTestContext()` (no env App):
  - `resolveGithubApp` → `null`, `manifestAvailable` → `true`;
  - after `saveGithubApp(...)` + `forgetGithubApp` → `source: 'manifest'`, `config.slug` equals the saved slug, `client.installUrl('s')` → `https://github.com/apps/<slug>/installations/new?state=s`, `manifestAvailable` → `false`;
  - a second `saveGithubApp` rejects;
  - with `deps.config.nodeEnv = 'production'` the DB row is ignored (`null`) and `manifestAvailable` is `false`;
  - with an env App (`createTestContext({ github: …, githubClient: … })`) → `source: 'env'`.
- [ ] **Implement** (`github/app.ts`): cache in a `WeakMap<AppDeps, ActiveGithubApp | null>`; build the client with `createGitHubClient({ appId, privateKey, slug }, deps.fetch ?? fetch)`.
- Commit `feat(api): store manifest-created GitHub App credentials`.

---

### Task 3: Manifest routes and many installations per org

**Files:** `routes/github.ts`, `routes/repos.ts`, `routes/agent.ts` (prFiles), `db/queries/github.ts` (+ `listInstallationsForOrg`), `apps/api/test/github.integration.test.ts`, `apps/api/test/githubManifest.integration.test.ts`.

**Routes:**
- `GET /api/orgs/:orgId/github/manifest?owner=user|org&org=<login>&name=<name>` (repos.manage) → `{ action: manifestPostUrl(...), manifest: JSON.stringify(buildAppManifest(...)) }` · 409 `github_already_configured` · 404 when not available (production). The state is `randomBytes(24).toString('base64url')` stored at `rdi:gh-manifest:<state>` → `{ orgId, userId }` with 1-hour TTL.
- `GET /api/github/manifest/callback?code&state` (auth) → `GETDEL` the state (400 `invalid_state` when missing or owned by another user), membership + `repos.manage` re-check, 409 if an App already exists, `exchangeManifestCode(code, deps.fetch)`, `saveGithubApp({...app, stateSecret: randomBytes(32).toString('base64url')})`, `forgetGithubApp`, then **302 to the installation page** `client.installUrl(signState(stateSecret, `${orgId}:${userId}`))`.
- `install-url`, `setup` and `webhook` use `resolveGithubApp(deps)`.
- `GET /orgs/:orgId/integrations` → `{ github: { configured, source, appSlug, appUrl, manifestAvailable, installations: [{ accountLogin }] }, demo: { available } }`.
- `available-repos` merges repos from **every** installation of the org (each with `installationRowId`, `account`), demo repos only when no installation exists; `POST /repos` stores the chosen repo's own installation.

- [ ] **Tests (RED):** new `githubManifest.integration.test.ts` with a fake `fetch` (routes by URL: `/app-manifests/` → credentials; `/access_tokens` → token; `/installation/repositories` → repos by token; `/app/installations/<id>` → account):
  - manifest endpoint returns the org POST URL and a manifest with the callback URLs; refuses a member without `repos.manage` (403) and when an App exists (409);
  - callback with an unknown state → 400 and no row; with a valid state → 302 to `https://github.com/apps/<slug>/installations/new?state=…` and the row exists; reusing the state → 400;
  - after two `setup` callbacks (installations 11 and 22, accounts `hugo` and `lennd`) integrations list both, available repos list repos of both with their account, and adding one repo from each stores the right `installation_id` rows.
  Update `github.integration.test.ts` for the new `integrations` shape (`installations` array).
- [ ] **Implement**, then commit `feat(api): create the GitHub App from a manifest and connect several accounts`.

---

### Task 4: Worker uses the active App per job

**Files:** `apps/worker/src/sources.ts`, `apps/worker/src/github.ts` (new: `loadWorkerGithub(pool, envConfig, production)`), `server.ts`, test `apps/worker/test/sources.integration.test.ts`.

- `createSourceResolver({ fixturesDir, github: () => Promise<GitHubClient | null> })`; the server passes a loader that returns the env client, else (not production) builds one from the `github_app` row (cached until the row changes).
- [ ] **Test (RED):** insert a `github_app` row and two installations/repos; with a fake `fetch` the resolver returns `https://x-access-token:<token for installation>@github.com/<repo>.git` for each repo using its own installation id; with no App it throws `GitHub App is not configured`.
- Commit `feat(worker): clone with the manifest-created GitHub App`.

---

### Task 5: Web — Create GitHub App and connected accounts

**Files:** `apps/web/src/shell/settings/RepositoriesPage.tsx`, `apps/web/src/i18n/shellMessages.ts`, test `apps/web/test/shell/repositories.test.tsx`.

- When `github.manifestAvailable` and the user can manage: a card **"Create GitHub App"** with an App name (default `Repository Designer <4 random chars>`), owner choice (my account / an organization + login) and a button that fetches `/orgs/:orgId/github/manifest` and submits a hidden `<form method="post" action={action}>` with a `manifest` field (`form.submit()`).
- When configured: list connected accounts (`github-account-<login>`), keep **"Connect GitHub account"** visible to add more, and show the account next to each available repo (`acme/api · GitHub (acme)`).
- Keys (en/es/pt): `repos.createApp`, `repos.createAppHelp`, `repos.appName`, `repos.owner.user`, `repos.owner.org`, `repos.orgLogin`, `repos.connectAnother`, `repos.connectedAccounts`, `repos.source.githubAccount`, `errors.github_already_configured`.
- [ ] **Tests (RED):** manifest card submits a form to the returned action with the manifest JSON (spy on `HTMLFormElement.prototype.submit`); org owner sends `owner=org&org=lennd`; configured state lists two accounts and the connect button stays enabled.
- Commit `feat(web): create the GitHub App in one click and connect several accounts`.

---

### Task 6: Verification and docs

- Full suite: `npm test && npm run typecheck`, integration for api/graph/worker, E2E (existing 23 must stay green; the demo-repo flow is unchanged when no App exists).
- README: "Connect your GitHub repositories" — Settings → Repositories → Create GitHub App → confirm on GitHub → install on your account and/or organizations → pick repos. Note: webhooks are inactive on localhost (use Re-index); org installs may need an org admin's approval.
- Fix `turbo.json` so `npm run dev` passes the app env (`"globalPassThroughEnv"` for the variables the apps read, per the installed Turborepo docs) — ledger the exact key used.
- Commit `docs: explain connecting GitHub repositories`.
