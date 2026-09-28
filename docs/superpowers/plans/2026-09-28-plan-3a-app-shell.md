# Plan 3a — App Shell (accounts, tenant, members, preferences, Aurora UI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working SaaS shell around the exploration workspace: email+password accounts (verify, reset, sessions, CSRF, rate limits), organizations with members, roles and invitations, per-user preferences with org defaults (UI language, explanation language, theme, initial level), a repositories screen that renders indexing stages (fed by plan 3b), and all public/settings screens in the Aurora style with the workspace mounted at `/orgs/:orgId/explore`.

**Architecture:** `apps/api` gains Postgres migrations, a thin SQL data-access layer (`src/db/queries/*`), auth primitives (`src/auth/*`), a dev mailer, and Fastify route modules under `/api` that receive an `AppDeps` bag (pool, redis, mailer, config). `apps/web` gains `src/shell` (API client, session/preferences hooks, Aurora components, pages, router) and wraps the existing `Workspace` in an authenticated route; the workspace's theme and language become controlled by user preferences.

**Tech Stack:** Fastify 5 + @fastify/cookie 11, pg, ioredis, zod 4, @node-rs/argon2 2; React 19 + react-router-dom 7 + @tanstack/react-query 5; Vitest (unit + integration against docker Postgres/Redis), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-app-shell-design.md` (plus the Aurora section §0). GitHub App installation and indexing are plan 3b; the "Connect GitHub" button is rendered disabled here.

## Global Constraints

- Code/comments/commits in English; every UI string through `t()` (catalogs en/es/pt, fallback en).
- Passwords: argon2id, min 12 chars, small common-password list. Tokens are stored **hashed** (sha256). Session cookie `rdi_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`, 30-day sliding expiry. Mutating authenticated requests require header `x-csrf-token` equal to the session's CSRF token.
- Error responses are `{ "error": { "code": "<code>" } }`; UI maps codes to `errors.<code>` strings. Sign-in failures are generic (`invalid_credentials`).
- Rate limits (Redis fixed window): sign-in 10/15 min per IP and per email; sign-up 5/h per IP; forgot 5/h per email; resend 3/h per email. `RATE_LIMITS=off` disables them only outside production (used by E2E).
- Tenancy: every org route is `/api/orgs/:orgId/...`, requires membership, and answers **404** to non-members. Roles `owner | admin | member`; at least one owner must remain.
- Dev-only routes (`/api/dev/*`: mailbox, demo session, repo seeding) exist only when `RDI_DEV_ROUTES=true` and `NODE_ENV !== 'production'`.
- Settings precedence: user preference → organization default → system default (`en` UI / `en` explanations / `mission` theme / `architecture` level).
- Aurora for every shell screen; Mission control stays inside the workspace. All animations honour `prefers-reduced-motion`.
- Ports: web 5177 (proxies `/api` → 4040), api 4040, Postgres 5548 (dbs `rdi`, `rdi_test`, `rdi_e2e`), Redis 6391 (db 0 dev, 1 integration tests, 2 E2E).
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Session token or CSRF missing/forged on a mutating request** — 401 without session, 403 `csrf` with a wrong header; GET still works. Pinned in Task 5.
2. **Account enumeration via sign-in/forgot/resend** — same `invalid_credentials` for unknown email and wrong password; forgot/resend always 200. Pinned in Task 6.
3. **Cross-tenant access** (member of org A calling org B routes, or guessing invitation/user ids) — always 404, never 403 or data. Pinned in Task 8.
4. **Removing or demoting the last owner** (including leaving the org yourself) — 409 `last_owner`. Pinned in Task 8.
5. **Password reset reuse and session survival** — a reset token works once; resetting or changing the password signs out other sessions. Pinned in Tasks 6 and 7.

---

## File Structure

```
apps/api/
  package.json, vitest.config.ts, vitest.integration.config.ts
  src/config.ts                       + nodeEnv, appUrl, devRoutes, cookieSecure, rateLimitPrefix, rateLimitsEnabled, dbEnsure
  src/checks.ts                       createPgPool(url, max?)
  src/domain/constants.ts             UI_LANGUAGES, THEME_IDS, LEVEL_IDS, REPO_LIMIT, SESSION_TTL_DAYS
  src/domain/roles.ts                 Role, Action, can()
  src/db/ensureDatabase.ts, src/db/migrate.ts, src/db/migrations/001_accounts.sql
  src/db/queries/{users,sessions,emailTokens,orgs,invitations,repos}.ts
  src/auth/{password,tokens,rateLimit}.ts
  src/mail/mailer.ts
  src/http/{deps,auth,payloads}.ts
  src/routes/{auth,me,orgs,invitations,dev}.ts
  src/app.ts, src/server.ts
  test/setup/{env,globalSetup}.ts, test/helpers.ts
  test/*.test.ts (unit), test/*.integration.test.ts
apps/web/
  package.json, vite.config.ts (proxy), playwright.config.ts
  src/i18n/shellMessages.ts, src/i18n/messages.ts (merge)
  src/shell/{api,session,preferences,errors}.ts
  src/shell/aurora.css
  src/shell/components/{AuroraBackground,AnimatedLogo,MiniFlow,Field,Buttons,LanguagePills,Segmented,Splash}.tsx
  src/shell/layouts/AuthLayout.tsx
  src/shell/pages/{Login,Signup,CheckEmail,Verify,Forgot,Reset,Invite,Onboarding,Explore}Page.tsx
  src/shell/guards.tsx                RequireAuth, HomeRedirect, PreferencesSync
  src/shell/settings/{SettingsLayout,GeneralPage,MembersPage,RepositoriesPage,UsagePage,PreferencesPage,SecurityPage}.tsx
  src/shell/router.tsx, src/main.tsx
  src/workspace/Workspace.tsx, src/workspace/panels/TopBar.tsx   (controlled theme/language, home link)
  test/shell/*.test.ts(x), e2e/shell.spec.ts, e2e/workspace.spec.ts (auth via demo session)
```

---

### Task 1: API configuration, database bootstrap and migrations

**Files:**
- Modify: `apps/api/package.json`, `apps/api/src/config.ts`, `apps/api/src/checks.ts`, `apps/api/test/health.test.ts`
- Create: `apps/api/vitest.integration.config.ts`, `apps/api/src/domain/constants.ts`, `apps/api/src/db/ensureDatabase.ts`, `apps/api/src/db/migrate.ts`, `apps/api/src/db/migrations/001_accounts.sql`, `apps/api/test/setup/env.ts`, `apps/api/test/setup/globalSetup.ts`
- Test: `apps/api/test/migrate.integration.test.ts`
- Modify: `apps/api/vitest.config.ts`

**Interfaces:**
- Produces:
  ```ts
  type Config = { port; databaseUrl; neo4jUrl; neo4jUser; neo4jPassword; redisUrl; nodeEnv: string; appUrl: string; devRoutes: boolean;
                  cookieSecure: boolean; rateLimitPrefix: string; rateLimitsEnabled: boolean; dbEnsure: boolean }
  createPgPool(connectionString: string, max?: number): pg.Pool
  ensureDatabase(databaseUrl: string): Promise<void>
  runMigrations(pool: pg.Pool, dir?: string): Promise<string[]>   // returns newly applied file names
  constants: UI_LANGUAGES = ['en','es','pt']; THEME_IDS = ['mission','studio','paper','contrast']; LEVEL_IDS = ['system','architecture','components','detail']; REPO_LIMIT = 10; SESSION_TTL_DAYS = 30
  TEST_DATABASE_URL, TEST_REDIS_URL (test/setup/env.ts)
  ```

- [ ] **Step 1: Dependencies and scripts**

Run:
```bash
npm install -w @rdi/api @fastify/cookie @node-rs/argon2 zod
grep -E '"(@fastify/cookie|@node-rs/argon2|zod)"' apps/api/package.json
```
Expected: the three packages listed under `dependencies` (re-run the install if one is missing).

In `apps/api/package.json` set the scripts to:
```json
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "typecheck": "tsc -p tsconfig.json"
```

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', testTimeout: 20_000, exclude: ['**/node_modules/**', 'test/**/*.integration.test.ts'] } });
```

`apps/api/vitest.integration.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    include: ['test/**/*.integration.test.ts'],
    globalSetup: ['./test/setup/globalSetup.ts'],
    fileParallelism: false,
  },
});
```

- [ ] **Step 2: Write the failing tests**

Replace the `loadConfig` describe block in `apps/api/test/health.test.ts` with:
```ts
describe('loadConfig', () => {
  it('defaults to local development values', () => {
    expect(loadConfig({})).toEqual({
      port: 4040,
      databaseUrl: 'postgres://rdi:rdi@localhost:5548/rdi',
      neo4jUrl: 'bolt://localhost:7690',
      neo4jUser: 'neo4j',
      neo4jPassword: 'rdi-dev-password',
      redisUrl: 'redis://localhost:6391',
      nodeEnv: 'development',
      appUrl: 'http://localhost:5177',
      devRoutes: false,
      cookieSecure: true,
      rateLimitPrefix: 'rl',
      rateLimitsEnabled: true,
      dbEnsure: false,
    });
  });

  it('reads overrides from env', () => {
    expect(loadConfig({ API_PORT: '5000', REDIS_URL: 'redis://x:1', RDI_DEV_ROUTES: 'true', RATE_LIMITS: 'off' })).toMatchObject({
      port: 5000, redisUrl: 'redis://x:1', devRoutes: true, rateLimitsEnabled: false,
    });
  });

  it('never enables dev routes or disables rate limits in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', RDI_DEV_ROUTES: 'true', RATE_LIMITS: 'off' })).toMatchObject({ devRoutes: false, rateLimitsEnabled: true });
  });
});
```

`apps/api/test/setup/env.ts`:
```ts
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://rdi:rdi@localhost:5548/rdi_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6391/1';
```

`apps/api/test/migrate.integration.test.ts`:
```ts
import { afterAll, describe, expect, it } from 'vitest';
import { createPgPool } from '../src/checks';
import { runMigrations } from '../src/db/migrate';
import { TEST_DATABASE_URL } from './setup/env';

const pool = createPgPool(TEST_DATABASE_URL);
afterAll(() => pool.end());

describe('runMigrations', () => {
  it('has created every table', async () => {
    const { rows } = await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by table_name");
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(['email_tokens', 'github_installations', 'invitations', 'memberships', 'orgs', 'repos', 'schema_migrations', 'sessions', 'users']),
    );
  });

  it('is idempotent', async () => {
    expect(await runMigrations(pool)).toEqual([]);
  });
});
```

Run: `npm test -w @rdi/api; npm run test:integration -w @rdi/api`
Expected: FAIL — config lacks the new fields; `globalSetup` / `migrate` modules not found.

- [ ] **Step 3: Implement config, pool and constants**

`apps/api/src/config.ts`:
```ts
export type Config = {
  port: number;
  databaseUrl: string;
  neo4jUrl: string;
  neo4jUser: string;
  neo4jPassword: string;
  redisUrl: string;
  nodeEnv: string;
  appUrl: string;
  devRoutes: boolean;
  cookieSecure: boolean;
  rateLimitPrefix: string;
  rateLimitsEnabled: boolean;
  dbEnsure: boolean;
};

const DEFAULTS = {
  API_PORT: '4040',
  DATABASE_URL: 'postgres://rdi:rdi@localhost:5548/rdi',
  NEO4J_URL: 'bolt://localhost:7690',
  NEO4J_USER: 'neo4j',
  NEO4J_PASSWORD: 'rdi-dev-password',
  REDIS_URL: 'redis://localhost:6391',
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:5177',
  RDI_DEV_ROUTES: 'false',
  COOKIE_SECURE: 'true',
  RATE_LIMIT_PREFIX: 'rl',
  RATE_LIMITS: 'on',
  DB_ENSURE: 'false',
};

const PRODUCTION = 'production';

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const read = (key: keyof typeof DEFAULTS) => env[key] ?? DEFAULTS[key];
  const nodeEnv = read('NODE_ENV');
  const production = nodeEnv === PRODUCTION;
  return {
    port: Number(read('API_PORT')),
    databaseUrl: read('DATABASE_URL'),
    neo4jUrl: read('NEO4J_URL'),
    neo4jUser: read('NEO4J_USER'),
    neo4jPassword: read('NEO4J_PASSWORD'),
    redisUrl: read('REDIS_URL'),
    nodeEnv,
    appUrl: read('APP_URL'),
    devRoutes: !production && read('RDI_DEV_ROUTES') === 'true',
    cookieSecure: read('COOKIE_SECURE') !== 'false',
    rateLimitPrefix: read('RATE_LIMIT_PREFIX'),
    rateLimitsEnabled: production || read('RATE_LIMITS') !== 'off',
    dbEnsure: read('DB_ENSURE') === 'true',
  };
};
```

In `apps/api/src/checks.ts` change `createPgPool`:
```ts
export const createPgPool = (connectionString: string, max = 2): pg.Pool => {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', ignoreClientError);
  return pool;
};
```

`apps/api/src/domain/constants.ts`:
```ts
export const UI_LANGUAGES = ['en', 'es', 'pt'] as const;
export const THEME_IDS = ['mission', 'studio', 'paper', 'contrast'] as const;
export const LEVEL_IDS = ['system', 'architecture', 'components', 'detail'] as const;
export const REPO_LIMIT = 10;
export const SESSION_TTL_DAYS = 30;
export const VERIFY_TTL_MINUTES = 48 * 60;
export const RESET_TTL_MINUTES = 30;
export const INVITATION_TTL_DAYS = 7;
```

- [ ] **Step 4: Implement database bootstrap and migrations**

`apps/api/src/db/ensureDatabase.ts`:
```ts
import pg from 'pg';

const SAFE_NAME = /^[a-z0-9_]+$/;

export const ensureDatabase = async (databaseUrl: string): Promise<void> => {
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe database name "${name}"`);
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount === 0) await client.query(`create database ${name}`);
  } finally {
    await client.end();
  }
};
```

`apps/api/src/db/migrate.ts`:
```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export const runMigrations = async (pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> => {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await pool.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const pending = files.filter((f) => !applied.has(f));
  for (const file of pending) {
    const sql = await readFile(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  return pending;
};
```

`apps/api/src/db/migrations/001_accounts.sql`:
```sql
create extension if not exists citext;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  name text not null,
  password_hash text not null,
  email_verified_at timestamptz,
  ui_language text,
  explanation_language text,
  theme text,
  initial_level text,
  created_at timestamptz not null default now()
);

create table sessions (
  id_hash text primary key,
  public_id uuid unique not null default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip text
);
create index sessions_user_idx on sessions (user_id);

create table email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  token_hash text unique not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  default_ui_language text not null default 'en',
  default_explanation_language text not null default 'en',
  default_theme text not null default 'mission',
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  email citext not null,
  role text not null check (role in ('admin', 'member')),
  token_hash text unique not null,
  invited_by uuid references users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_org_idx on invitations (org_id);

create table github_installations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  installation_id bigint unique not null,
  account_login text not null,
  created_at timestamptz not null default now()
);

create table repos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  installation_id uuid references github_installations (id) on delete set null,
  full_name text not null,
  default_branch text not null default 'main',
  languages text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'indexing', 'ready', 'error')),
  stages jsonb not null default '[]',
  error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, full_name)
);
```

`apps/api/test/setup/globalSetup.ts`:
```ts
import { createPgPool } from '../../src/checks';
import { ensureDatabase } from '../../src/db/ensureDatabase';
import { runMigrations } from '../../src/db/migrate';
import { TEST_DATABASE_URL } from './env';

export default async () => {
  await ensureDatabase(TEST_DATABASE_URL);
  const pool = createPgPool(TEST_DATABASE_URL);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
};
```

- [ ] **Step 5: Run tests and typecheck**

Run:
```bash
npm test -w @rdi/api
npm run test:integration -w @rdi/api
npm run typecheck -w @rdi/api
```
Expected: unit PASS (health + checks + config); integration PASS (migrate + existing health integration); typecheck clean. Requires `npm run infra:up`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add config, database bootstrap and account migrations

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Auth primitives — passwords, tokens, roles, rate limiter

**Files:**
- Create: `apps/api/src/auth/password.ts`, `apps/api/src/auth/tokens.ts`, `apps/api/src/auth/rateLimit.ts`, `apps/api/src/domain/roles.ts`
- Test: `apps/api/test/auth.primitives.test.ts`, `apps/api/test/rateLimit.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  MIN_PASSWORD_LENGTH = 12
  passwordProblem(password: string): 'too_short' | 'too_common' | null
  hashPassword(password: string): Promise<string>
  verifyPassword(hash: string, password: string): Promise<boolean>   // false (never throws) on malformed hash
  randomToken(bytes?: number): string       // base64url
  hashToken(token: string): string          // sha256 hex
  type Role = 'owner' | 'admin' | 'member'
  type Action = 'explore' | 'org.update' | 'members.manage' | 'invitations.manage' | 'repos.manage' | 'org.delete' | 'ownership.transfer'
  can(role: Role, action: Action): boolean
  type RateLimiter = { hit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> }
  createRateLimiter(redis: Redis, prefix: string): RateLimiter
  ```

- [ ] **Step 1: Write the failing tests**

`apps/api/test/auth.primitives.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from '../src/auth/password';
import { hashToken, randomToken } from '../src/auth/tokens';
import { can } from '../src/domain/roles';

describe('passwords', () => {
  it('rejects short and common passwords', () => {
    expect(passwordProblem('short')).toBe('too_short');
    expect(passwordProblem('Password1234')).toBe('too_common');
    expect(passwordProblem('correct horse battery')).toBeNull();
  });

  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong horse battery')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('tokens', () => {
  it('creates url-safe random tokens and stable hashes', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('roles', () => {
  it('follows the permission matrix', () => {
    expect(can('owner', 'org.delete')).toBe(true);
    expect(can('admin', 'org.delete')).toBe(false);
    expect(can('admin', 'members.manage')).toBe(true);
    expect(can('member', 'members.manage')).toBe(false);
    expect(can('member', 'explore')).toBe(true);
    expect(can('admin', 'ownership.transfer')).toBe(false);
  });
});
```

`apps/api/test/rateLimit.integration.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/auth/rateLimit';
import { createRedisClient } from '../src/checks';
import { TEST_REDIS_URL } from './setup/env';

const redis = createRedisClient(TEST_REDIS_URL);
const limiter = createRateLimiter(redis, 'rltest-unit');

beforeEach(async () => {
  const keys = await redis.keys('rltest-unit:*');
  if (keys.length) await redis.del(...keys);
});
afterAll(() => redis.disconnect());

describe('createRateLimiter', () => {
  it('allows up to the limit then blocks with a retry-after', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit('login:ip:1.2.3.4', 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfter).toBeGreaterThan(0);
    expect(results[3]!.retryAfter).toBeLessThanOrEqual(60);
  });

  it('keeps keys independent', async () => {
    await limiter.hit('a', 1, 60);
    expect((await limiter.hit('b', 1, 60)).allowed).toBe(true);
  });
});
```

Run: `npm test -w @rdi/api; npm run test:integration -w @rdi/api`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement**

`apps/api/src/auth/password.ts`:
```ts
import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
  'password1234', '123456789012', 'qwertyuiopas', 'letmein12345', 'iloveyou1234', 'passwordpassword',
  'admin1234567', 'welcome12345', 'qwerty123456', '111111111111', 'abcdefghijkl', 'changeme1234',
]);

export const passwordProblem = (password: string): 'too_short' | 'too_common' | null => {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'too_common';
  return null;
};

export const hashPassword = (password: string): Promise<string> => hash(password);

export const verifyPassword = async (passwordHash: string, password: string): Promise<boolean> => {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
};
```

`apps/api/src/auth/tokens.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';

const DEFAULT_TOKEN_BYTES = 32;

export const randomToken = (bytes = DEFAULT_TOKEN_BYTES): string => randomBytes(bytes).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
```

`apps/api/src/domain/roles.ts`:
```ts
export type Role = 'owner' | 'admin' | 'member';
export type Action = 'explore' | 'org.update' | 'members.manage' | 'invitations.manage' | 'repos.manage' | 'org.delete' | 'ownership.transfer';

const MATRIX: Record<Action, Role[]> = {
  explore: ['owner', 'admin', 'member'],
  'org.update': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'invitations.manage': ['owner', 'admin'],
  'repos.manage': ['owner', 'admin'],
  'org.delete': ['owner'],
  'ownership.transfer': ['owner'],
};

export const can = (role: Role, action: Action): boolean => MATRIX[action].includes(role);
```

`apps/api/src/auth/rateLimit.ts`:
```ts
import type { Redis } from 'ioredis';

export type RateLimiter = { hit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> };

export const createRateLimiter = (redis: Redis, prefix: string): RateLimiter => ({
  async hit(key, limit, windowSeconds) {
    const full = `${prefix}:${key}`;
    const count = await redis.incr(full);
    if (count === 1) await redis.expire(full, windowSeconds);
    if (count <= limit) return { allowed: true, retryAfter: 0 };
    const ttl = await redis.ttl(full);
    return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSeconds };
  },
});
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add password, token, role and rate-limit primitives

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Data access — users, sessions, email tokens

**Files:**
- Create: `apps/api/src/db/queries/users.ts`, `sessions.ts`, `emailTokens.ts`
- Test: `apps/api/test/queries.accounts.integration.test.ts`

**Interfaces:**
- Produces (`type Db = Pick<pg.Pool, 'query'>`):
  ```ts
  type UserRow = { id; email; name; password_hash; email_verified_at: Date | null; ui_language: string | null; explanation_language: string | null; theme: string | null; initial_level: string | null; created_at: Date }
  findUserByEmail(db, email): Promise<UserRow | null>; findUserById(db, id): Promise<UserRow | null>
  insertUser(db, { email, name, passwordHash }): Promise<UserRow>
  markVerified(db, id, now: Date): Promise<void>; updatePassword(db, id, passwordHash): Promise<void>
  type UserPatch = Partial<Pick<UserRow, 'name' | 'ui_language' | 'explanation_language' | 'theme' | 'initial_level'>>
  updateUser(db, id, patch: UserPatch): Promise<UserRow | null>
  type SessionRow = { id_hash; public_id; user_id; csrf_token; created_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null; user_agent: string | null; ip: string | null }
  createSession(db, { userId, userAgent, ip, now }): Promise<{ token: string; session: SessionRow }>
  findActiveSession(db, token, now): Promise<SessionRow | null>   // slides expiry when last_seen_at is older than 1h
  revokeSession(db, idHash, now); revokeUserSessions(db, userId, now, exceptIdHash?)
  listUserSessions(db, userId, now): Promise<SessionRow[]>; revokeByPublicId(db, userId, publicId, now): Promise<number>
  issueEmailToken(db, userId, kind: 'verify' | 'reset', ttlMinutes, now): Promise<string>
  consumeEmailToken(db, token, kind, now): Promise<string | null>   // user id; single use
  ```

- [ ] **Step 1: Write the failing tests**

`apps/api/test/queries.accounts.integration.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgPool } from '../src/checks';
import { consumeEmailToken, issueEmailToken } from '../src/db/queries/emailTokens';
import { createSession, findActiveSession, listUserSessions, revokeByPublicId, revokeUserSessions } from '../src/db/queries/sessions';
import { findUserByEmail, insertUser, markVerified, updateUser } from '../src/db/queries/users';
import { TEST_DATABASE_URL } from './setup/env';

const pool = createPgPool(TEST_DATABASE_URL);
const now = new Date('2026-09-28T12:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);
const HOUR = 3_600_000;

beforeEach(() => pool.query('truncate users cascade'));
afterAll(() => pool.end());

const user = () => insertUser(pool, { email: 'Ana@Example.com', name: 'Ana', passwordHash: 'h' });

describe('users', () => {
  it('finds users by email case-insensitively and updates whitelisted fields', async () => {
    const u = await user();
    expect((await findUserByEmail(pool, 'ana@example.com'))?.id).toBe(u.id);
    await markVerified(pool, u.id, now);
    const updated = await updateUser(pool, u.id, { theme: 'paper', ui_language: 'es' });
    expect(updated).toMatchObject({ theme: 'paper', ui_language: 'es', name: 'Ana' });
    expect(updated?.email_verified_at?.toISOString()).toBe(now.toISOString());
    expect((await updateUser(pool, u.id, { theme: null }))?.theme).toBeNull();
  });
});

describe('sessions', () => {
  it('creates, finds, slides and revokes sessions', async () => {
    const u = await user();
    const { token, session } = await createSession(pool, { userId: u.id, userAgent: 'test', ip: '1.1.1.1', now });
    expect(session.csrf_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.id_hash).not.toBe(token);
    expect((await findActiveSession(pool, token, later(10 * 60_000)))?.last_seen_at.toISOString()).toBe(now.toISOString());
    const slid = await findActiveSession(pool, token, later(2 * HOUR));
    expect(slid?.last_seen_at.toISOString()).toBe(later(2 * HOUR).toISOString());
    expect(await findActiveSession(pool, 'wrong', now)).toBeNull();
    expect(await findActiveSession(pool, token, later(40 * 24 * HOUR))).toBeNull();
    expect(await revokeByPublicId(pool, u.id, session.public_id, now)).toBe(1);
    expect(await findActiveSession(pool, token, now)).toBeNull();
  });

  it('revokes every session of a user except one', async () => {
    const u = await user();
    const a = await createSession(pool, { userId: u.id, userAgent: null, ip: null, now });
    const b = await createSession(pool, { userId: u.id, userAgent: null, ip: null, now });
    await revokeUserSessions(pool, u.id, now, a.session.id_hash);
    expect(await findActiveSession(pool, a.token, now)).not.toBeNull();
    expect(await findActiveSession(pool, b.token, now)).toBeNull();
    expect((await listUserSessions(pool, u.id, now)).map((s) => s.id_hash)).toEqual([a.session.id_hash]);
  });
});

describe('email tokens', () => {
  it('are single use, kind-bound and expire', async () => {
    const u = await user();
    const token = await issueEmailToken(pool, u.id, 'reset', 30, now);
    expect(await consumeEmailToken(pool, token, 'verify', now)).toBeNull();
    expect(await consumeEmailToken(pool, token, 'reset', later(31 * 60_000))).toBeNull();
    expect(await consumeEmailToken(pool, token, 'reset', later(60_000))).toBe(u.id);
    expect(await consumeEmailToken(pool, token, 'reset', later(60_000))).toBeNull();
  });
});
```

Run: `npm run test:integration -w @rdi/api`
Expected: FAIL — query modules not found.

- [ ] **Step 2: Implement**

`apps/api/src/db/queries/users.ts`:
```ts
import type pg from 'pg';

export type Db = Pick<pg.Pool, 'query'>;

export type UserRow = {
  id: string; email: string; name: string; password_hash: string; email_verified_at: Date | null;
  ui_language: string | null; explanation_language: string | null; theme: string | null; initial_level: string | null; created_at: Date;
};

export type UserPatch = Partial<Pick<UserRow, 'name' | 'ui_language' | 'explanation_language' | 'theme' | 'initial_level'>>;

const PATCHABLE = ['name', 'ui_language', 'explanation_language', 'theme', 'initial_level'] as const;

export const findUserByEmail = async (db: Db, email: string): Promise<UserRow | null> =>
  (await db.query<UserRow>('select * from users where email = $1', [email])).rows[0] ?? null;

export const findUserById = async (db: Db, id: string): Promise<UserRow | null> =>
  (await db.query<UserRow>('select * from users where id = $1', [id])).rows[0] ?? null;

export const insertUser = async (db: Db, input: { email: string; name: string; passwordHash: string }): Promise<UserRow> =>
  (await db.query<UserRow>('insert into users (email, name, password_hash) values ($1, $2, $3) returning *', [input.email, input.name, input.passwordHash])).rows[0]!;

export const markVerified = async (db: Db, id: string, now: Date): Promise<void> => {
  await db.query('update users set email_verified_at = coalesce(email_verified_at, $2) where id = $1', [id, now]);
};

export const updatePassword = async (db: Db, id: string, passwordHash: string): Promise<void> => {
  await db.query('update users set password_hash = $2 where id = $1', [id, passwordHash]);
};

export const updateUser = async (db: Db, id: string, patch: UserPatch): Promise<UserRow | null> => {
  const entries = PATCHABLE.filter((column) => column in patch).map((column) => [column, patch[column]] as const);
  if (entries.length === 0) return findUserById(db, id);
  const sets = entries.map(([column], i) => `${column} = $${i + 2}`).join(', ');
  return (await db.query<UserRow>(`update users set ${sets} where id = $1 returning *`, [id, ...entries.map(([, value]) => value)])).rows[0] ?? null;
};
```

`apps/api/src/db/queries/sessions.ts`:
```ts
import { hashToken, randomToken } from '../../auth/tokens';
import { SESSION_TTL_DAYS } from '../../domain/constants';
import type { Db } from './users';

export type SessionRow = {
  id_hash: string; public_id: string; user_id: string; csrf_token: string; created_at: Date; last_seen_at: Date;
  expires_at: Date; revoked_at: Date | null; user_agent: string | null; ip: string | null;
};

const DAY_MS = 86_400_000;
const SLIDE_AFTER_MS = 3_600_000;
const expiryFrom = (now: Date) => new Date(now.getTime() + SESSION_TTL_DAYS * DAY_MS);

export const createSession = async (db: Db, input: { userId: string; userAgent: string | null; ip: string | null; now: Date }) => {
  const token = randomToken();
  const { rows } = await db.query<SessionRow>(
    `insert into sessions (id_hash, user_id, csrf_token, expires_at, user_agent, ip, created_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning *`,
    [hashToken(token), input.userId, randomToken(), expiryFrom(input.now), input.userAgent, input.ip, input.now],
  );
  return { token, session: rows[0]! };
};

export const findActiveSession = async (db: Db, token: string, now: Date): Promise<SessionRow | null> => {
  const session = (await db.query<SessionRow>('select * from sessions where id_hash = $1 and revoked_at is null and expires_at > $2', [hashToken(token), now])).rows[0];
  if (!session) return null;
  if (now.getTime() - session.last_seen_at.getTime() <= SLIDE_AFTER_MS) return session;
  const { rows } = await db.query<SessionRow>('update sessions set last_seen_at = $2, expires_at = $3 where id_hash = $1 returning *', [session.id_hash, now, expiryFrom(now)]);
  return rows[0] ?? session;
};

export const revokeSession = async (db: Db, idHash: string, now: Date): Promise<void> => {
  await db.query('update sessions set revoked_at = $2 where id_hash = $1 and revoked_at is null', [idHash, now]);
};

export const revokeUserSessions = async (db: Db, userId: string, now: Date, exceptIdHash?: string): Promise<void> => {
  await db.query("update sessions set revoked_at = $2 where user_id = $1 and revoked_at is null and id_hash <> coalesce($3, '')", [userId, now, exceptIdHash ?? null]);
};

export const listUserSessions = async (db: Db, userId: string, now: Date): Promise<SessionRow[]> =>
  (await db.query<SessionRow>('select * from sessions where user_id = $1 and revoked_at is null and expires_at > $2 order by last_seen_at desc', [userId, now])).rows;

export const revokeByPublicId = async (db: Db, userId: string, publicId: string, now: Date): Promise<number> =>
  (await db.query('update sessions set revoked_at = $3 where user_id = $1 and public_id = $2 and revoked_at is null', [userId, publicId, now])).rowCount ?? 0;
```

`apps/api/src/db/queries/emailTokens.ts`:
```ts
import { hashToken, randomToken } from '../../auth/tokens';
import type { Db } from './users';

export type EmailTokenKind = 'verify' | 'reset';
const MINUTE_MS = 60_000;

export const issueEmailToken = async (db: Db, userId: string, kind: EmailTokenKind, ttlMinutes: number, now: Date): Promise<string> => {
  const token = randomToken();
  await db.query('insert into email_tokens (user_id, kind, token_hash, expires_at) values ($1, $2, $3, $4)', [userId, kind, hashToken(token), new Date(now.getTime() + ttlMinutes * MINUTE_MS)]);
  return token;
};

export const consumeEmailToken = async (db: Db, token: string, kind: EmailTokenKind, now: Date): Promise<string | null> =>
  (
    await db.query<{ user_id: string }>(
      'update email_tokens set used_at = $3 where token_hash = $1 and kind = $2 and used_at is null and expires_at > $3 returning user_id',
      [hashToken(token), kind, now],
    )
  ).rows[0]?.user_id ?? null;
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add user, session and email token queries

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Data access — organizations, memberships, invitations, repositories

**Files:**
- Create: `apps/api/src/db/queries/orgs.ts`, `invitations.ts`, `repos.ts`
- Test: `apps/api/test/queries.orgs.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type OrgRow = { id; name; slug; default_ui_language; default_explanation_language; default_theme; created_at: Date }
  type OrgWithRole = OrgRow & { role: Role }
  slugify(name: string): string
  createOrg(pool: pg.Pool, { name, ownerId }): Promise<OrgRow>          // unique slug, owner membership, one transaction
  listOrgsForUser(db, userId): Promise<OrgWithRole[]>
  findMembership(db, orgId, userId): Promise<{ org: OrgRow; role: Role } | null>
  type OrgPatch = Partial<Pick<OrgRow, 'name' | 'default_ui_language' | 'default_explanation_language' | 'default_theme'>>
  updateOrg(db, orgId, patch): Promise<OrgRow | null>
  type MemberRow = { user_id; email; name; role: Role; created_at: Date }
  listMembers(db, orgId): Promise<MemberRow[]>; getMemberRole(db, orgId, userId): Promise<Role | null>
  countOwners(db, orgId): Promise<number>; setRole(db, orgId, userId, role): Promise<number>
  removeMember(db, orgId, userId): Promise<number>; addMember(db, orgId, userId, role): Promise<void>
  findMemberByEmail(db, orgId, email): Promise<MemberRow | null>
  type InvitationRow = { id; org_id; email; role: 'admin' | 'member'; token_hash; invited_by; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null; created_at: Date }
  type InvitationStatus = 'valid' | 'expired' | 'revoked' | 'accepted'
  createInvitation(db, { orgId, email, role, invitedBy, now }): Promise<{ invitation: InvitationRow; token: string }>
  findInvitationByToken(db, token): Promise<(InvitationRow & { org_name: string }) | null>
  invitationStatus(inv: InvitationRow, now: Date): InvitationStatus
  listPendingInvitations(db, orgId, now): Promise<InvitationRow[]>
  revokeInvitation(db, orgId, id, now): Promise<number>
  renewInvitation(db, orgId, id, now): Promise<{ invitation: InvitationRow; token: string } | null>
  markInvitationAccepted(db, id, now): Promise<void>
  type RepoStage = { name: 'clone' | 'parse' | 'detect' | 'summarize' | 'link'; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string }
  type RepoRow = { id; org_id; installation_id: string | null; full_name; default_branch; languages: string[]; status: 'pending' | 'indexing' | 'ready' | 'error'; stages: RepoStage[]; error: string | null; last_synced_at: Date | null; created_at: Date }
  listRepos(db, orgId): Promise<RepoRow[]>; countRepos(db, orgId): Promise<number>
  upsertRepo(db, input: { orgId; fullName; defaultBranch; languages; status; stages; error?: string | null; lastSyncedAt?: Date | null }): Promise<RepoRow>
  ```

- [ ] **Step 1: Write the failing tests**

`apps/api/test/queries.orgs.integration.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgPool } from '../src/checks';
import { createInvitation, findInvitationByToken, invitationStatus, listPendingInvitations, markInvitationAccepted, renewInvitation, revokeInvitation } from '../src/db/queries/invitations';
import { addMember, countOwners, createOrg, findMemberByEmail, findMembership, getMemberRole, listMembers, listOrgsForUser, removeMember, setRole, slugify, updateOrg } from '../src/db/queries/orgs';
import { countRepos, listRepos, upsertRepo } from '../src/db/queries/repos';
import { insertUser } from '../src/db/queries/users';
import { TEST_DATABASE_URL } from './setup/env';

const pool = createPgPool(TEST_DATABASE_URL);
const now = new Date('2026-09-28T12:00:00Z');
const DAY = 86_400_000;

beforeEach(() => pool.query('truncate users, orgs cascade'));
afterAll(() => pool.end());

const makeUser = (email: string) => insertUser(pool, { email, name: email.split('@')[0]!, passwordHash: 'h' });

describe('orgs and memberships', () => {
  it('slugifies names', () => {
    expect(slugify('Acme Inc.')).toBe('acme-inc');
    expect(slugify('Ñandú Café')).toBe('nandu-cafe');
    expect(slugify('!!!')).toBe('org');
  });

  it('creates orgs with unique slugs and an owner', async () => {
    const ana = await makeUser('ana@acme.com');
    const a = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    const b = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    expect([a.slug, b.slug]).toEqual(['acme', 'acme-2']);
    expect((await listOrgsForUser(pool, ana.id)).map((o) => [o.name, o.role])).toEqual([['Acme', 'owner'], ['Acme', 'owner']]);
    expect((await findMembership(pool, a.id, ana.id))?.role).toBe('owner');
    expect((await updateOrg(pool, a.id, { default_theme: 'paper' }))?.default_theme).toBe('paper');
  });

  it('manages members and counts owners', async () => {
    const ana = await makeUser('ana@acme.com');
    const leo = await makeUser('leo@acme.com');
    const org = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    await addMember(pool, org.id, leo.id, 'member');
    await addMember(pool, org.id, leo.id, 'admin');
    expect(await getMemberRole(pool, org.id, leo.id)).toBe('member');
    expect((await findMemberByEmail(pool, org.id, 'LEO@acme.com'))?.user_id).toBe(leo.id);
    expect(await countOwners(pool, org.id)).toBe(1);
    expect(await setRole(pool, org.id, leo.id, 'owner')).toBe(1);
    expect(await countOwners(pool, org.id)).toBe(2);
    expect((await listMembers(pool, org.id)).map((m) => m.email)).toEqual(['ana@acme.com', 'leo@acme.com']);
    expect(await removeMember(pool, org.id, leo.id)).toBe(1);
    expect(await findMembership(pool, org.id, leo.id)).toBeNull();
  });
});

describe('invitations', () => {
  it('creates, finds, renews, revokes and accepts invitations', async () => {
    const ana = await makeUser('ana@acme.com');
    const org = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    const { invitation, token } = await createInvitation(pool, { orgId: org.id, email: 'sofi@acme.com', role: 'member', invitedBy: ana.id, now });
    const found = await findInvitationByToken(pool, token);
    expect(found).toMatchObject({ id: invitation.id, org_name: 'Acme', role: 'member' });
    expect(invitationStatus(found!, now)).toBe('valid');
    expect(invitationStatus(found!, new Date(now.getTime() + 8 * DAY))).toBe('expired');
    const renewed = await renewInvitation(pool, org.id, invitation.id, now);
    expect(await findInvitationByToken(pool, token)).toBeNull();
    expect(await findInvitationByToken(pool, renewed!.token)).not.toBeNull();
    expect((await listPendingInvitations(pool, org.id, now)).map((i) => i.email)).toEqual(['sofi@acme.com']);
    await markInvitationAccepted(pool, invitation.id, now);
    expect(invitationStatus((await findInvitationByToken(pool, renewed!.token))!, now)).toBe('accepted');
    expect(await listPendingInvitations(pool, org.id, now)).toEqual([]);
    const second = await createInvitation(pool, { orgId: org.id, email: 'x@acme.com', role: 'admin', invitedBy: ana.id, now });
    expect(await revokeInvitation(pool, org.id, second.invitation.id, now)).toBe(1);
    expect(invitationStatus((await findInvitationByToken(pool, second.token))!, now)).toBe('revoked');
    expect(await renewInvitation(pool, org.id, second.invitation.id, now)).toBeNull();
  });
});

describe('repos', () => {
  it('upserts and lists repositories per org', async () => {
    const ana = await makeUser('ana@acme.com');
    const org = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    const stages = [{ name: 'clone' as const, status: 'done' as const }];
    await upsertRepo(pool, { orgId: org.id, fullName: 'acme/api', defaultBranch: 'main', languages: ['TypeScript'], status: 'indexing', stages });
    await upsertRepo(pool, { orgId: org.id, fullName: 'acme/api', defaultBranch: 'main', languages: ['TypeScript'], status: 'ready', stages });
    expect(await countRepos(pool, org.id)).toBe(1);
    expect((await listRepos(pool, org.id))[0]).toMatchObject({ full_name: 'acme/api', status: 'ready', languages: ['TypeScript'], stages });
  });
});
```

Run: `npm run test:integration -w @rdi/api`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement**

`apps/api/src/db/queries/orgs.ts`:
```ts
import type pg from 'pg';
import type { Role } from '../../domain/roles';
import type { Db } from './users';

export type OrgRow = { id: string; name: string; slug: string; default_ui_language: string; default_explanation_language: string; default_theme: string; created_at: Date };
export type OrgWithRole = OrgRow & { role: Role };
export type OrgPatch = Partial<Pick<OrgRow, 'name' | 'default_ui_language' | 'default_explanation_language' | 'default_theme'>>;
export type MemberRow = { user_id: string; email: string; name: string; role: Role; created_at: Date };

const MAX_SLUG = 40;
const PATCHABLE = ['name', 'default_ui_language', 'default_explanation_language', 'default_theme'] as const;

export const slugify = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SLUG) || 'org';

export const createOrg = async (pool: pg.Pool, input: { name: string; ownerId: string }): Promise<OrgRow> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const base = slugify(input.name);
    let slug = base;
    for (let suffix = 2; ((await client.query('select 1 from orgs where slug = $1', [slug])).rowCount ?? 0) > 0; suffix++) slug = `${base}-${suffix}`;
    const org = (await client.query<OrgRow>('insert into orgs (name, slug) values ($1, $2) returning *', [input.name, slug])).rows[0]!;
    await client.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')", [org.id, input.ownerId]);
    await client.query('commit');
    return org;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

export const listOrgsForUser = async (db: Db, userId: string): Promise<OrgWithRole[]> =>
  (await db.query<OrgWithRole>('select o.*, m.role from orgs o join memberships m on m.org_id = o.id where m.user_id = $1 order by o.created_at, o.name', [userId])).rows;

export const findMembership = async (db: Db, orgId: string, userId: string): Promise<{ org: OrgRow; role: Role } | null> => {
  const row = (await db.query<OrgWithRole>('select o.*, m.role from orgs o join memberships m on m.org_id = o.id where o.id = $1 and m.user_id = $2', [orgId, userId])).rows[0];
  if (!row) return null;
  const { role, ...org } = row;
  return { org, role };
};

export const updateOrg = async (db: Db, orgId: string, patch: OrgPatch): Promise<OrgRow | null> => {
  const entries = PATCHABLE.filter((column) => column in patch).map((column) => [column, patch[column]] as const);
  if (entries.length === 0) return (await db.query<OrgRow>('select * from orgs where id = $1', [orgId])).rows[0] ?? null;
  const sets = entries.map(([column], i) => `${column} = $${i + 2}`).join(', ');
  return (await db.query<OrgRow>(`update orgs set ${sets} where id = $1 returning *`, [orgId, ...entries.map(([, value]) => value)])).rows[0] ?? null;
};

const MEMBER_SELECT = 'select m.user_id, u.email, u.name, m.role, m.created_at from memberships m join users u on u.id = m.user_id';

export const listMembers = async (db: Db, orgId: string): Promise<MemberRow[]> =>
  (await db.query<MemberRow>(`${MEMBER_SELECT} where m.org_id = $1 order by m.created_at, u.email`, [orgId])).rows;

export const findMemberByEmail = async (db: Db, orgId: string, email: string): Promise<MemberRow | null> =>
  (await db.query<MemberRow>(`${MEMBER_SELECT} where m.org_id = $1 and u.email = $2`, [orgId, email])).rows[0] ?? null;

export const getMemberRole = async (db: Db, orgId: string, userId: string): Promise<Role | null> =>
  (await db.query<{ role: Role }>('select role from memberships where org_id = $1 and user_id = $2', [orgId, userId])).rows[0]?.role ?? null;

export const countOwners = async (db: Db, orgId: string): Promise<number> =>
  Number((await db.query<{ count: string }>("select count(*) from memberships where org_id = $1 and role = 'owner'", [orgId])).rows[0]?.count ?? 0);

export const setRole = async (db: Db, orgId: string, userId: string, role: Role): Promise<number> =>
  (await db.query('update memberships set role = $3 where org_id = $1 and user_id = $2', [orgId, userId, role])).rowCount ?? 0;

export const removeMember = async (db: Db, orgId: string, userId: string): Promise<number> =>
  (await db.query('delete from memberships where org_id = $1 and user_id = $2', [orgId, userId])).rowCount ?? 0;

export const addMember = async (db: Db, orgId: string, userId: string, role: Role): Promise<void> => {
  await db.query('insert into memberships (org_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [orgId, userId, role]);
};
```

`apps/api/src/db/queries/invitations.ts`:
```ts
import { hashToken, randomToken } from '../../auth/tokens';
import { INVITATION_TTL_DAYS } from '../../domain/constants';
import type { Db } from './users';

export type InvitationRow = {
  id: string; org_id: string; email: string; role: 'admin' | 'member'; token_hash: string; invited_by: string | null;
  expires_at: Date; accepted_at: Date | null; revoked_at: Date | null; created_at: Date;
};
export type InvitationStatus = 'valid' | 'expired' | 'revoked' | 'accepted';

const DAY_MS = 86_400_000;
const expiryFrom = (now: Date) => new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS);

export const createInvitation = async (db: Db, input: { orgId: string; email: string; role: 'admin' | 'member'; invitedBy: string; now: Date }) => {
  const token = randomToken();
  const { rows } = await db.query<InvitationRow>(
    'insert into invitations (org_id, email, role, token_hash, invited_by, expires_at) values ($1, $2, $3, $4, $5, $6) returning *',
    [input.orgId, input.email, input.role, hashToken(token), input.invitedBy, expiryFrom(input.now)],
  );
  return { invitation: rows[0]!, token };
};

export const findInvitationByToken = async (db: Db, token: string): Promise<(InvitationRow & { org_name: string }) | null> =>
  (await db.query<InvitationRow & { org_name: string }>('select i.*, o.name as org_name from invitations i join orgs o on o.id = i.org_id where i.token_hash = $1', [hashToken(token)])).rows[0] ?? null;

export const invitationStatus = (inv: InvitationRow, now: Date): InvitationStatus => {
  if (inv.accepted_at) return 'accepted';
  if (inv.revoked_at) return 'revoked';
  return inv.expires_at.getTime() <= now.getTime() ? 'expired' : 'valid';
};

export const listPendingInvitations = async (db: Db, orgId: string, now: Date): Promise<InvitationRow[]> =>
  (await db.query<InvitationRow>('select * from invitations where org_id = $1 and accepted_at is null and revoked_at is null and expires_at > $2 order by created_at', [orgId, now])).rows;

export const revokeInvitation = async (db: Db, orgId: string, id: string, now: Date): Promise<number> =>
  (await db.query('update invitations set revoked_at = $3 where org_id = $1 and id = $2 and accepted_at is null and revoked_at is null', [orgId, id, now])).rowCount ?? 0;

export const renewInvitation = async (db: Db, orgId: string, id: string, now: Date) => {
  const token = randomToken();
  const { rows } = await db.query<InvitationRow>(
    'update invitations set token_hash = $3, expires_at = $4 where org_id = $1 and id = $2 and accepted_at is null and revoked_at is null returning *',
    [orgId, id, hashToken(token), expiryFrom(now)],
  );
  return rows[0] ? { invitation: rows[0], token } : null;
};

export const markInvitationAccepted = async (db: Db, id: string, now: Date): Promise<void> => {
  await db.query('update invitations set accepted_at = $2 where id = $1', [id, now]);
};
```

`apps/api/src/db/queries/repos.ts`:
```ts
import type { Db } from './users';

export type RepoStage = { name: 'clone' | 'parse' | 'detect' | 'summarize' | 'link'; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string };
export type RepoStatus = 'pending' | 'indexing' | 'ready' | 'error';
export type RepoRow = {
  id: string; org_id: string; installation_id: string | null; full_name: string; default_branch: string; languages: string[];
  status: RepoStatus; stages: RepoStage[]; error: string | null; last_synced_at: Date | null; created_at: Date;
};

export const listRepos = async (db: Db, orgId: string): Promise<RepoRow[]> =>
  (await db.query<RepoRow>('select * from repos where org_id = $1 order by full_name', [orgId])).rows;

export const countRepos = async (db: Db, orgId: string): Promise<number> =>
  Number((await db.query<{ count: string }>('select count(*) from repos where org_id = $1', [orgId])).rows[0]?.count ?? 0);

export const upsertRepo = async (
  db: Db,
  input: { orgId: string; fullName: string; defaultBranch: string; languages: string[]; status: RepoStatus; stages: RepoStage[]; error?: string | null; lastSyncedAt?: Date | null },
): Promise<RepoRow> =>
  (
    await db.query<RepoRow>(
      `insert into repos (org_id, full_name, default_branch, languages, status, stages, error, last_synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (org_id, full_name) do update set default_branch = excluded.default_branch, languages = excluded.languages,
         status = excluded.status, stages = excluded.stages, error = excluded.error, last_synced_at = excluded.last_synced_at
       returning *`,
      [input.orgId, input.fullName, input.defaultBranch, input.languages, input.status, JSON.stringify(input.stages), input.error ?? null, input.lastSyncedAt ?? null],
    )
  ).rows[0]!;
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add organization, membership, invitation and repository queries

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: HTTP foundation — deps, auth hook, CSRF, payloads, dev mailer and dev routes

**Files:**
- Create: `apps/api/src/mail/mailer.ts`, `apps/api/src/http/deps.ts`, `apps/api/src/http/auth.ts`, `apps/api/src/http/payloads.ts`, `apps/api/src/routes/dev.ts`, `apps/api/src/routes/auth.ts` (session endpoint only in this task), `apps/api/test/helpers.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/http.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Mail = { to: string; subject: string; text: string; link?: string; kind: 'verify' | 'reset' | 'invite' }
  type Mailer = { send(mail: Mail): Promise<void> }; type DevMailer = Mailer & { inbox(to: string): Mail[] }
  createDevMailer(log?: (line: string) => void): DevMailer
  type AppDeps = { config: Config; pool: pg.Pool; redis: Redis; mailer: Mailer; now?: () => Date }
  nowOf(deps: AppDeps): Date
  SESSION_COOKIE = 'rdi_session'
  type AuthContext = { user: UserRow; session: SessionRow; token: string }; type MemberContext = { org: OrgRow; role: Role }
  registerAuth(api: FastifyInstance, deps: AppDeps): void            // decorates req.auth / req.member, resolves session cookie
  requireAuth(req, reply)                                             // 401 unauthorized; 403 csrf on mutating methods
  requireMember(deps)(req, reply)                                     // 404 not_found unless member of :orgId
  requireAction(action)(req, reply)                                   // 403 forbidden
  fail(reply, status, code, extra?)
  isUuid(value: unknown): value is string
  setSessionCookie(reply, config, token); clearSessionCookie(reply)
  publicUser(u: UserRow); publicOrg(o: OrgWithRole); sessionPayload(pool, user, session)
  // routes: GET /api/auth/session; GET /api/dev/mailbox?to=; POST /api/dev/demo-session; POST /api/dev/orgs/:orgId/seed-repos
  buildApp({ checks, onClose?, checkTimeoutMs?, deps? })
  // test/helpers.ts
  createTestContext(): Promise<TestContext>; cookieFrom(res); tokenFromLink(link); signupVerified(ctx, email?, password?); authed(s)
  ```

- [ ] **Step 1: Test helpers and failing tests**

`apps/api/test/helpers.ts`:
```ts
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { createPgPool, createRedisClient } from '../src/checks';
import { loadConfig } from '../src/config';
import { createDevMailer } from '../src/mail/mailer';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './setup/env';

const TABLES = ['repos', 'github_installations', 'invitations', 'email_tokens', 'sessions', 'memberships', 'orgs', 'users'];
const RATE_PREFIX = 'rltest';

export const createTestContext = async () => {
  const config = loadConfig({ DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL, RDI_DEV_ROUTES: 'true', RATE_LIMIT_PREFIX: RATE_PREFIX });
  const pool = createPgPool(config.databaseUrl, 5);
  const redis = createRedisClient(config.redisUrl);
  const mailer = createDevMailer(() => {});
  const app = buildApp({ checks: {}, deps: { config, pool, redis, mailer } });
  await app.ready();
  const reset = async () => {
    await pool.query(`truncate ${TABLES.join(', ')} cascade`);
    const keys = await redis.keys(`${RATE_PREFIX}:*`);
    if (keys.length) await redis.del(...keys);
  };
  const close = async () => {
    await app.close();
    await pool.end();
    redis.disconnect();
  };
  return { app, pool, redis, mailer, config, reset, close };
};

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

export const cookieFrom = (res: LightMyRequestResponse): string => {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith('rdi_session='))?.split(';')[0] ?? '';
};

export const tokenFromLink = (link: string): string => new URL(link).searchParams.get('token') ?? link.split('/').pop() ?? '';

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${Date.now()}${counter++}@example.com`;

export const signupVerified = async (ctx: TestContext, email = uniqueEmail(), password = 'correct horse battery') => {
  await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, name: 'Test User', password } });
  const mail = ctx.mailer.inbox(email).find((m) => m.kind === 'verify');
  if (mail?.link) await ctx.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: tokenFromLink(mail.link) } });
  const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const body = login.json();
  return { email, password, cookie: cookieFrom(login), csrf: body.csrfToken as string, userId: body.user?.id as string };
};

export const authed = (s: { cookie: string; csrf: string }) => ({ cookie: s.cookie, 'x-csrf-token': s.csrf });
```

`apps/api/test/http.integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

describe('session and dev routes', () => {
  it('answers 401 without a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthorized' } });
  });

  it('creates a demo session with a secure http-only cookie, an org and a csrf token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/dev/demo-session', payload: {} });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/rdi_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const body = res.json();
    expect(body.orgs).toHaveLength(1);
    expect(body.orgs[0]).toMatchObject({ name: 'Demo', role: 'owner', defaultTheme: 'mission' });
    const session = await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: cookieFrom(res) } });
    expect(session.json()).toMatchObject({ user: { email: body.user.email }, csrfToken: body.csrfToken });
  });

  it('rejects mutating requests without the csrf header and accepts them with it', async () => {
    const demo = await ctx.app.inject({ method: 'POST', url: '/api/dev/demo-session', payload: {} });
    const cookie = cookieFrom(demo);
    const orgId = demo.json().orgs[0].id;
    const denied = await ctx.app.inject({ method: 'POST', url: `/api/dev/orgs/${orgId}/seed-repos`, headers: { cookie }, payload: {} });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: { code: 'csrf' } });
    const forged = await ctx.app.inject({ method: 'POST', url: `/api/dev/orgs/${orgId}/seed-repos`, headers: { cookie, 'x-csrf-token': 'nope' }, payload: {} });
    expect(forged.statusCode).toBe(403);
    const ok = await ctx.app.inject({ method: 'POST', url: `/api/dev/orgs/${orgId}/seed-repos`, headers: { cookie, 'x-csrf-token': demo.json().csrfToken }, payload: {} });
    expect(ok.statusCode).toBe(201);
  });

  it('exposes the dev mailbox', async () => {
    await ctx.mailer.send({ to: 'x@example.com', subject: 's', text: 't', kind: 'verify', link: 'http://l' });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/dev/mailbox?to=X@example.com' });
    expect(res.json().messages).toEqual([{ to: 'x@example.com', subject: 's', text: 't', kind: 'verify', link: 'http://l' }]);
  });

  it('keeps health working without deps', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
```

Run: `npm run test:integration -w @rdi/api`
Expected: FAIL — `helpers` imports modules that do not exist yet.

- [ ] **Step 2: Mailer, deps and auth plumbing**

`apps/api/src/mail/mailer.ts`:
```ts
export type Mail = { to: string; subject: string; text: string; link?: string; kind: 'verify' | 'reset' | 'invite' };
export type Mailer = { send(mail: Mail): Promise<void> };
export type DevMailer = Mailer & { inbox(to: string): Mail[] };

export const createDevMailer = (log: (line: string) => void = (line) => console.log(line)): DevMailer => {
  const sent: Mail[] = [];
  return {
    async send(mail) {
      sent.push(mail);
      log(`[mail] ${mail.kind} to=${mail.to} subject="${mail.subject}"${mail.link ? ` link=${mail.link}` : ''}`);
    },
    inbox: (to) => sent.filter((m) => m.to.toLowerCase() === to.toLowerCase()),
  };
};
```

`apps/api/src/http/deps.ts`:
```ts
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../config';
import type { Mailer } from '../mail/mailer';

export type AppDeps = { config: Config; pool: pg.Pool; redis: Redis; mailer: Mailer; now?: () => Date };

export const nowOf = (deps: AppDeps): Date => deps.now?.() ?? new Date();
```

`apps/api/src/http/auth.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { SESSION_TTL_DAYS } from '../domain/constants';
import { can, type Action, type Role } from '../domain/roles';
import { findMembership, type OrgRow } from '../db/queries/orgs';
import { findActiveSession, type SessionRow } from '../db/queries/sessions';
import { findUserById, type UserRow } from '../db/queries/users';
import { nowOf, type AppDeps } from './deps';

export const SESSION_COOKIE = 'rdi_session';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_SECONDS = 86_400;

export type AuthContext = { user: UserRow; session: SessionRow; token: string };
export type MemberContext = { org: OrgRow; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    member: MemberContext | null;
  }
}

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export const fail = (reply: FastifyReply, status: number, code: string, extra: Record<string, unknown> = {}) =>
  reply.code(status).send({ error: { code, ...extra } });

export const setSessionCookie = (reply: FastifyReply, config: Config, token: string) =>
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_DAYS * DAY_SECONDS });

export const clearSessionCookie = (reply: FastifyReply) => reply.clearCookie(SESSION_COOKIE, { path: '/' });

export const registerAuth = (api: FastifyInstance, deps: AppDeps) => {
  api.decorateRequest('auth', null);
  api.decorateRequest('member', null);
  api.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await findActiveSession(deps.pool, token, nowOf(deps));
    if (!session) return;
    const user = await findUserById(deps.pool, session.user_id);
    if (user) req.auth = { user, session, token };
  });
};

export const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.auth) return fail(reply, 401, 'unauthorized');
  if (MUTATING.has(req.method) && req.headers['x-csrf-token'] !== req.auth.session.csrf_token) return fail(reply, 403, 'csrf');
};

export const requireMember = (deps: AppDeps) => async (req: FastifyRequest, reply: FastifyReply) => {
  const orgId = (req.params as { orgId?: string }).orgId;
  if (!req.auth || !isUuid(orgId)) return fail(reply, 404, 'not_found');
  const found = await findMembership(deps.pool, orgId, req.auth.user.id);
  if (!found) return fail(reply, 404, 'not_found');
  req.member = found;
};

export const requireAction = (action: Action) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.member || !can(req.member.role, action)) return fail(reply, 403, 'forbidden');
};
```

`apps/api/src/http/payloads.ts`:
```ts
import type pg from 'pg';
import { listOrgsForUser, type OrgWithRole } from '../db/queries/orgs';
import type { InvitationRow } from '../db/queries/invitations';
import type { RepoRow } from '../db/queries/repos';
import type { SessionRow } from '../db/queries/sessions';
import type { UserRow } from '../db/queries/users';

export const publicUser = (u: UserRow) => ({
  id: u.id, email: u.email, name: u.name, uiLanguage: u.ui_language, explanationLanguage: u.explanation_language, theme: u.theme, initialLevel: u.initial_level,
});

export const publicOrg = (o: OrgWithRole) => ({
  id: o.id, name: o.name, slug: o.slug, role: o.role,
  defaultUiLanguage: o.default_ui_language, defaultExplanationLanguage: o.default_explanation_language, defaultTheme: o.default_theme,
});

export const publicInvitation = (i: InvitationRow) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at.toISOString() });

export const publicRepo = (r: RepoRow) => ({
  id: r.id, fullName: r.full_name, defaultBranch: r.default_branch, languages: r.languages, status: r.status,
  stages: r.stages, error: r.error, lastSyncedAt: r.last_synced_at?.toISOString() ?? null,
});

export const sessionPayload = async (pool: pg.Pool, user: UserRow, session: SessionRow) => ({
  user: publicUser(user),
  orgs: (await listOrgsForUser(pool, user.id)).map(publicOrg),
  csrfToken: session.csrf_token,
});
```

- [ ] **Step 3: Session route, dev routes and app wiring**

`apps/api/src/routes/auth.ts` (only the session endpoint for now; Task 6 adds the rest to this file):
```ts
import type { FastifyInstance } from 'fastify';
import { fail } from '../http/auth';
import type { AppDeps } from '../http/deps';
import { sessionPayload } from '../http/payloads';

export const authRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/auth/session', async (req, reply) => {
    if (!req.auth) return fail(reply, 401, 'unauthorized');
    return sessionPayload(deps.pool, req.auth.user, req.auth.session);
  });
};
```

`apps/api/src/routes/dev.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import { randomToken } from '../auth/tokens';
import { createOrg } from '../db/queries/orgs';
import { upsertRepo, type RepoStage } from '../db/queries/repos';
import { createSession } from '../db/queries/sessions';
import { findUserById, insertUser, markVerified } from '../db/queries/users';
import { requireAuth, requireMember, setSessionCookie } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';
import { sessionPayload } from '../http/payloads';
import type { DevMailer } from '../mail/mailer';

const MINUTE_MS = 60_000;
const DEMO_TOKEN_BYTES = 6;

const DEMO_REPOS = (now: Date) => [
  {
    fullName: 'acme/web-store', defaultBranch: 'main', languages: ['TypeScript', 'React'], status: 'ready' as const, lastSyncedAt: new Date(now.getTime() - 4 * MINUTE_MS),
    stages: (['clone', 'parse', 'detect', 'summarize', 'link'] as const).map((name): RepoStage => ({ name, status: 'done' })),
  },
  {
    fullName: 'acme/orders-api', defaultBranch: 'main', languages: ['TypeScript', 'Node'], status: 'indexing' as const, lastSyncedAt: null,
    stages: [
      { name: 'clone', status: 'done' }, { name: 'parse', status: 'done' }, { name: 'detect', status: 'done', detail: '12 endpoints · 3 queues · 9 tables' },
      { name: 'summarize', status: 'running', progress: 64 }, { name: 'link', status: 'pending' },
    ] as RepoStage[],
  },
  {
    fullName: 'acme/ml-ranker', defaultBranch: 'develop', languages: ['Python'], status: 'error' as const, lastSyncedAt: new Date(now.getTime() - 24 * 60 * MINUTE_MS),
    error: 'repository exceeds 500k LOC',
    stages: [{ name: 'clone', status: 'done' }, { name: 'parse', status: 'error', detail: 'repository exceeds 500k LOC' }] as RepoStage[],
  },
];

export const devRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/dev/mailbox', async (req) => {
    const { to } = z.object({ to: z.string().min(1) }).parse(req.query);
    return { messages: (deps.mailer as Partial<DevMailer>).inbox?.(to) ?? [] };
  });

  api.post('/dev/demo-session', async (req, reply) => {
    const now = nowOf(deps);
    const email = `demo-${randomToken(DEMO_TOKEN_BYTES).toLowerCase().replace(/[^a-z0-9]/g, 'x')}@example.com`;
    const user = await insertUser(deps.pool, { email, name: 'Demo User', passwordHash: await hashPassword(randomToken()) });
    await markVerified(deps.pool, user.id, now);
    await createOrg(deps.pool, { name: 'Demo', ownerId: user.id });
    const { token, session } = await createSession(deps.pool, { userId: user.id, userAgent: req.headers['user-agent'] ?? null, ip: req.ip, now });
    setSessionCookie(reply, deps.config, token);
    return sessionPayload(deps.pool, (await findUserById(deps.pool, user.id))!, session);
  });

  api.post('/dev/orgs/:orgId/seed-repos', { preHandler: [requireAuth, requireMember(deps)] }, async (req, reply) => {
    for (const repo of DEMO_REPOS(nowOf(deps))) await upsertRepo(deps.pool, { orgId: req.member!.org.id, ...repo });
    return reply.code(201).send({ ok: true });
  });
};
```

Replace `apps/api/src/app.ts` with (health logic unchanged, deps-driven API added):
```ts
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Check } from './checks';
import { registerAuth } from './http/auth';
import type { AppDeps } from './http/deps';
import { authRoutes } from './routes/auth';
import { devRoutes } from './routes/dev';

const DEFAULT_CHECK_TIMEOUT_MS = 3000;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;
const HTTP_INTERNAL = 500;

type BuildAppOptions = { checks: Record<string, Check>; onClose?: () => Promise<void>; checkTimeoutMs?: number; deps?: AppDeps };

const withTimeout = (check: Check, ms: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    check().then(
      () => { clearTimeout(timer); resolve(); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });

export const buildApp = ({ checks, onClose, checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS, deps }: BuildAppOptions): FastifyInstance => {
  const app = Fastify({ logger: false, trustProxy: true });

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
    return reply.code(allOk ? HTTP_OK : HTTP_UNAVAILABLE).send({ status: allOk ? 'ok' : 'degraded', checks: Object.fromEntries(entries) });
  });

  if (deps) {
    app.register(cookie);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(HTTP_BAD_REQUEST).send({ error: { code: 'validation', fields: error.issues.map((i) => i.path.join('.')) } });
      if ((error as { statusCode?: number }).statusCode === HTTP_BAD_REQUEST) return reply.code(HTTP_BAD_REQUEST).send({ error: { code: 'validation' } });
      console.error(error);
      return reply.code(HTTP_INTERNAL).send({ error: { code: 'internal' } });
    });
    app.register(
      async (api) => {
        registerAuth(api, deps);
        authRoutes(api, deps);
        if (deps.config.devRoutes) devRoutes(api, deps);
      },
      { prefix: '/api' },
    );
  }

  if (onClose) app.addHook('onClose', onClose);
  return app;
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add session context, csrf guard, dev mailer and dev routes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Auth routes — sign-up, verify, sign-in, sign-out, forgot, reset

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Test: `apps/api/test/auth.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces endpoints: `POST /api/auth/signup {email,name,password}` → 201 · `POST /api/auth/verify {token}` · `POST /api/auth/resend-verification {email}` → 200 always · `POST /api/auth/login {email,password}` → session payload + cookie · `POST /api/auth/logout` (auth+csrf) · `POST /api/auth/forgot {email}` → 200 always · `POST /api/auth/reset {token,password}`. Mail links: `${appUrl}/verify?token=…`, `${appUrl}/reset?token=…`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/auth.integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, cookieFrom, createTestContext, signupVerified, tokenFromLink, uniqueEmail, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => ctx.app.inject({ method: 'POST', url, payload: payload as object, headers });
const PASSWORD = 'correct horse battery';

describe('sign-up and verification', () => {
  it('rejects weak passwords and duplicate emails', async () => {
    expect((await post('/api/auth/signup', { email: uniqueEmail(), name: 'A', password: 'short' })).json()).toEqual({ error: { code: 'weak_password', reason: 'too_short' } });
    const email = uniqueEmail();
    expect((await post('/api/auth/signup', { email, name: 'A', password: PASSWORD })).statusCode).toBe(201);
    expect((await post('/api/auth/signup', { email: email.toUpperCase(), name: 'A', password: PASSWORD })).json()).toEqual({ error: { code: 'email_taken' } });
  });

  it('validates input shape', async () => {
    const res = await post('/api/auth/signup', { email: 'not-an-email', name: '', password: PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it('requires verification before sign-in and verifies with the emailed link once', async () => {
    const email = uniqueEmail();
    await post('/api/auth/signup', { email, name: 'Ana', password: PASSWORD });
    expect((await post('/api/auth/login', { email, password: PASSWORD })).json()).toEqual({ error: { code: 'email_not_verified' } });
    const mail = ctx.mailer.inbox(email).find((m) => m.kind === 'verify')!;
    expect(mail.link).toMatch(/^http:\/\/localhost:5177\/verify\?token=/);
    expect((await post('/api/auth/verify', { token: tokenFromLink(mail.link!) })).statusCode).toBe(200);
    expect((await post('/api/auth/verify', { token: tokenFromLink(mail.link!) })).json()).toEqual({ error: { code: 'invalid_token' } });
    expect((await post('/api/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
  });

  it('resend-verification always answers 200', async () => {
    expect((await post('/api/auth/resend-verification', { email: uniqueEmail() })).statusCode).toBe(200);
  });
});

describe('sign-in and sign-out', () => {
  it('uses the same error for unknown emails and wrong passwords', async () => {
    const s = await signupVerified(ctx);
    const wrong = await post('/api/auth/login', { email: s.email, password: 'wrong horse battery' });
    const unknown = await post('/api/auth/login', { email: uniqueEmail(), password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(unknown.json()).toEqual({ error: { code: 'invalid_credentials' } });
  });

  it('returns the session payload and signs out', async () => {
    const s = await signupVerified(ctx);
    const session = await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } });
    expect(session.json()).toMatchObject({ user: { email: s.email, uiLanguage: null }, orgs: [] });
    expect((await post('/api/auth/logout', {}, authed(s))).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } })).statusCode).toBe(401);
  });

  it('rate-limits sign-in attempts per email', async () => {
    const email = uniqueEmail();
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await post('/api/auth/login', { email, password: 'wrong horse battery' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('password reset', () => {
  it('forgot always answers 200 and only mails existing users', async () => {
    const unknown = uniqueEmail();
    expect((await post('/api/auth/forgot', { email: unknown })).statusCode).toBe(200);
    expect(ctx.mailer.inbox(unknown)).toEqual([]);
  });

  it('resets once and signs out every session', async () => {
    const s = await signupVerified(ctx);
    await post('/api/auth/forgot', { email: s.email });
    const token = tokenFromLink(ctx.mailer.inbox(s.email).find((m) => m.kind === 'reset')!.link!);
    expect((await post('/api/auth/reset', { token, password: 'short' })).json().error.code).toBe('weak_password');
    expect((await post('/api/auth/reset', { token, password: 'brand new passphrase' })).statusCode).toBe(200);
    expect((await post('/api/auth/reset', { token, password: 'another new passphrase' })).json()).toEqual({ error: { code: 'invalid_token' } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } })).statusCode).toBe(401);
    const login = await post('/api/auth/login', { email: s.email, password: 'brand new passphrase' });
    expect(cookieFrom(login)).toMatch(/^rdi_session=/);
  });
});
```

Run: `npm run test:integration -w @rdi/api`
Expected: FAIL — sign-up returns 404.

- [ ] **Step 2: Implement the auth routes**

Replace `apps/api/src/routes/auth.ts`:
```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import { createRateLimiter } from '../auth/rateLimit';
import { randomToken } from '../auth/tokens';
import { RESET_TTL_MINUTES, VERIFY_TTL_MINUTES } from '../domain/constants';
import { consumeEmailToken, issueEmailToken } from '../db/queries/emailTokens';
import { createSession, revokeSession, revokeUserSessions } from '../db/queries/sessions';
import { findUserByEmail, insertUser, markVerified, updatePassword, type UserRow } from '../db/queries/users';
import { clearSessionCookie, fail, requireAuth, setSessionCookie } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';
import { sessionPayload } from '../http/payloads';

const MAX_EMAIL = 254;
const MAX_NAME = 80;
const MAX_PASSWORD = 200;
const MAX_TOKEN = 200;
const MINUTE = 60;
const HOUR = 3600;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL));
const tokenSchema = z.object({ token: z.string().min(10).max(MAX_TOKEN) });
const signupSchema = z.object({ email: emailSchema, name: z.string().trim().min(1).max(MAX_NAME), password: z.string().max(MAX_PASSWORD) });
const loginSchema = z.object({ email: emailSchema, password: z.string().max(MAX_PASSWORD) });
const emailOnly = z.object({ email: emailSchema });
const resetSchema = z.object({ token: z.string().min(10).max(MAX_TOKEN), password: z.string().max(MAX_PASSWORD) });

let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

export const authRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const limiter = createRateLimiter(deps.redis, deps.config.rateLimitPrefix);
  const limited = async (reply: FastifyReply, key: string, limit: number, windowSeconds: number): Promise<boolean> => {
    if (!deps.config.rateLimitsEnabled) return false;
    const result = await limiter.hit(key, limit, windowSeconds);
    if (result.allowed) return false;
    reply.header('retry-after', String(result.retryAfter));
    fail(reply, 429, 'rate_limited');
    return true;
  };

  const sendVerification = async (user: UserRow) => {
    const token = await issueEmailToken(deps.pool, user.id, 'verify', VERIFY_TTL_MINUTES, nowOf(deps));
    await deps.mailer.send({ to: user.email, kind: 'verify', subject: 'Verify your email for Repository Designer', text: `Hi ${user.name}, confirm your email to start exploring.`, link: `${deps.config.appUrl}/verify?token=${token}` });
  };

  api.get('/auth/session', async (req, reply) => {
    if (!req.auth) return fail(reply, 401, 'unauthorized');
    return sessionPayload(deps.pool, req.auth.user, req.auth.session);
  });

  api.post('/auth/signup', async (req, reply) => {
    const body = signupSchema.parse(req.body);
    if (await limited(reply, `signup:ip:${req.ip}`, 5, HOUR)) return reply;
    const problem = passwordProblem(body.password);
    if (problem) return fail(reply, 400, 'weak_password', { reason: problem });
    if (await findUserByEmail(deps.pool, body.email)) return fail(reply, 409, 'email_taken');
    const user = await insertUser(deps.pool, { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) });
    await sendVerification(user);
    return reply.code(201).send({ ok: true });
  });

  api.post('/auth/verify', async (req, reply) => {
    const { token } = tokenSchema.parse(req.body);
    const userId = await consumeEmailToken(deps.pool, token, 'verify', nowOf(deps));
    if (!userId) return fail(reply, 400, 'invalid_token');
    await markVerified(deps.pool, userId, nowOf(deps));
    return { ok: true };
  });

  api.post('/auth/resend-verification', async (req, reply) => {
    const { email } = emailOnly.parse(req.body);
    if (await limited(reply, `resend:email:${email}`, 3, HOUR)) return reply;
    const user = await findUserByEmail(deps.pool, email);
    if (user && !user.email_verified_at) await sendVerification(user);
    return { ok: true };
  });

  api.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    if ((await limited(reply, `login:ip:${req.ip}`, 10, 15 * MINUTE)) || (await limited(reply, `login:email:${body.email}`, 10, 15 * MINUTE))) return reply;
    const user = await findUserByEmail(deps.pool, body.email);
    const valid = user ? await verifyPassword(user.password_hash, body.password) : (await verifyPassword(await getDummyHash(), body.password), false);
    if (!user || !valid) return fail(reply, 401, 'invalid_credentials');
    if (!user.email_verified_at) return fail(reply, 403, 'email_not_verified');
    const { token, session } = await createSession(deps.pool, { userId: user.id, userAgent: req.headers['user-agent'] ?? null, ip: req.ip, now: nowOf(deps) });
    setSessionCookie(reply, deps.config, token);
    return sessionPayload(deps.pool, user, session);
  });

  api.post('/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    await revokeSession(deps.pool, req.auth!.session.id_hash, nowOf(deps));
    clearSessionCookie(reply);
    return { ok: true };
  });

  api.post('/auth/forgot', async (req, reply) => {
    const { email } = emailOnly.parse(req.body);
    if (await limited(reply, `forgot:email:${email}`, 5, HOUR)) return reply;
    const user = await findUserByEmail(deps.pool, email);
    if (user) {
      const token = await issueEmailToken(deps.pool, user.id, 'reset', RESET_TTL_MINUTES, nowOf(deps));
      await deps.mailer.send({ to: user.email, kind: 'reset', subject: 'Reset your Repository Designer password', text: 'Use this link within 30 minutes to choose a new password.', link: `${deps.config.appUrl}/reset?token=${token}` });
    }
    return { ok: true };
  });

  api.post('/auth/reset', async (req, reply) => {
    const body = resetSchema.parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) return fail(reply, 400, 'weak_password', { reason: problem });
    const now = nowOf(deps);
    const userId = await consumeEmailToken(deps.pool, body.token, 'reset', now);
    if (!userId) return fail(reply, 400, 'invalid_token');
    await updatePassword(deps.pool, userId, await hashPassword(body.password));
    await markVerified(deps.pool, userId, now);
    await revokeUserSessions(deps.pool, userId, now);
    return { ok: true };
  });
};
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add sign-up, verification, sign-in, sign-out and password reset

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Account routes — preferences, password change, sessions

**Files:**
- Create: `apps/api/src/routes/me.ts`
- Modify: `apps/api/src/app.ts` (register `meRoutes`)
- Test: `apps/api/test/me.integration.test.ts`

**Interfaces:**
- Produces: `PATCH /api/me {name?, uiLanguage?, explanationLanguage?, theme?, initialLevel?}` (null resets to org default) → public user · `POST /api/me/password {currentPassword,newPassword}` · `GET /api/me/sessions` → `[{ id, createdAt, lastSeenAt, userAgent, ip, current }]` · `DELETE /api/me/sessions/:id` → 204.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/me.integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const req = (method: 'GET' | 'PATCH' | 'POST' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  ctx.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });

describe('/api/me', () => {
  it('updates and resets preferences with validation', async () => {
    const s = await signupVerified(ctx);
    const updated = await req('PATCH', '/api/me', authed(s), { uiLanguage: 'es', theme: 'paper', initialLevel: 'components' });
    expect(updated.json()).toMatchObject({ uiLanguage: 'es', theme: 'paper', initialLevel: 'components' });
    expect((await req('PATCH', '/api/me', authed(s), { theme: null })).json().theme).toBeNull();
    expect((await req('PATCH', '/api/me', authed(s), { theme: 'neon' })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/me', authed(s), { email: 'x@y.z' })).statusCode).toBe(400);
  });

  it('requires the csrf header', async () => {
    const s = await signupVerified(ctx);
    expect((await req('PATCH', '/api/me', { cookie: s.cookie }, { theme: 'paper' })).statusCode).toBe(403);
  });

  it('changes the password and signs out other sessions only', async () => {
    const s = await signupVerified(ctx);
    const other = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: s.email, password: s.password } });
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]!;
    expect((await req('POST', '/api/me/password', authed(s), { currentPassword: 'wrong horse battery', newPassword: 'fresh passphrase 99' })).json()).toEqual({ error: { code: 'invalid_credentials' } });
    expect((await req('POST', '/api/me/password', authed(s), { currentPassword: s.password, newPassword: 'fresh passphrase 99' })).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/session', { cookie: s.cookie })).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/session', { cookie: otherCookie })).statusCode).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    const s = await signupVerified(ctx);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: s.email, password: s.password } });
    const list = (await req('GET', '/api/me/sessions', { cookie: s.cookie })).json() as { id: string; current: boolean }[];
    expect(list).toHaveLength(2);
    expect(list.filter((x) => x.current)).toHaveLength(1);
    const other = list.find((x) => !x.current)!;
    expect((await req('DELETE', `/api/me/sessions/${other.id}`, authed(s))).statusCode).toBe(204);
    expect((await req('GET', '/api/me/sessions', { cookie: s.cookie })).json()).toHaveLength(1);
    expect((await req('DELETE', '/api/me/sessions/not-a-uuid', authed(s))).statusCode).toBe(404);
  });
});
```

Run: `npm run test:integration -w @rdi/api`
Expected: FAIL — 404 on `/api/me`.

- [ ] **Step 2: Implement**

`apps/api/src/routes/me.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password';
import { LEVEL_IDS, THEME_IDS, UI_LANGUAGES } from '../domain/constants';
import { listUserSessions, revokeByPublicId, revokeUserSessions } from '../db/queries/sessions';
import { updatePassword, updateUser, type UserPatch } from '../db/queries/users';
import { clearSessionCookie, fail, isUuid, requireAuth } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';
import { publicUser } from '../http/payloads';

const MAX_NAME = 80;
const MAX_PASSWORD = 200;

const prefsSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME).optional(),
    uiLanguage: z.enum(UI_LANGUAGES).nullable().optional(),
    explanationLanguage: z.enum(UI_LANGUAGES).nullable().optional(),
    theme: z.enum(THEME_IDS).nullable().optional(),
    initialLevel: z.enum(LEVEL_IDS).nullable().optional(),
  })
  .strict();

const passwordSchema = z.object({ currentPassword: z.string().max(MAX_PASSWORD), newPassword: z.string().max(MAX_PASSWORD) });

const COLUMN: Record<keyof z.infer<typeof prefsSchema>, keyof UserPatch> = {
  name: 'name', uiLanguage: 'ui_language', explanationLanguage: 'explanation_language', theme: 'theme', initialLevel: 'initial_level',
};

export const meRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.patch('/me', { preHandler: requireAuth }, async (req) => {
    const body = prefsSchema.parse(req.body);
    const patch = Object.fromEntries(Object.entries(body).map(([key, value]) => [COLUMN[key as keyof typeof COLUMN], value])) as UserPatch;
    return publicUser((await updateUser(deps.pool, req.auth!.user.id, patch))!);
  });

  api.post('/me/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = passwordSchema.parse(req.body);
    if (!(await verifyPassword(req.auth!.user.password_hash, body.currentPassword))) return fail(reply, 400, 'invalid_credentials');
    const problem = passwordProblem(body.newPassword);
    if (problem) return fail(reply, 400, 'weak_password', { reason: problem });
    await updatePassword(deps.pool, req.auth!.user.id, await hashPassword(body.newPassword));
    await revokeUserSessions(deps.pool, req.auth!.user.id, nowOf(deps), req.auth!.session.id_hash);
    return { ok: true };
  });

  api.get('/me/sessions', { preHandler: requireAuth }, async (req) =>
    (await listUserSessions(deps.pool, req.auth!.user.id, nowOf(deps))).map((s) => ({
      id: s.public_id, createdAt: s.created_at.toISOString(), lastSeenAt: s.last_seen_at.toISOString(),
      userAgent: s.user_agent, ip: s.ip, current: s.id_hash === req.auth!.session.id_hash,
    })),
  );

  api.delete('/me/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    const revoked = await revokeByPublicId(deps.pool, req.auth!.user.id, id, nowOf(deps));
    if (revoked === 0) return fail(reply, 404, 'not_found');
    if (id === req.auth!.session.public_id) clearSessionCookie(reply);
    return reply.code(204).send();
  });
};
```

In `apps/api/src/app.ts` add `import { meRoutes } from './routes/me';` and call `meRoutes(api, deps);` right after `authRoutes(api, deps);`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add preferences, password change and session management

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Organization routes — orgs, members, invitations, repositories, usage

**Files:**
- Create: `apps/api/src/routes/orgs.ts`, `apps/api/src/routes/invitations.ts`
- Modify: `apps/api/src/app.ts` (register both)
- Test: `apps/api/test/orgs.integration.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/orgs` · `POST /api/orgs {name}` → 201 public org (role owner)
  - `GET /api/orgs/:orgId` · `PATCH /api/orgs/:orgId {name?, defaultUiLanguage?, defaultExplanationLanguage?, defaultTheme?}` (owner/admin)
  - `GET /api/orgs/:orgId/members` → `{ members: [{userId,email,name,role,joinedAt}], invitations: [...] }` (invitations only for owner/admin)
  - `POST /api/orgs/:orgId/invitations {email, role: admin|member}` → 201 · `POST …/invitations/:invitationId/resend` · `DELETE …/invitations/:invitationId` → 204
  - `PATCH /api/orgs/:orgId/members/:userId {role}` · `DELETE /api/orgs/:orgId/members/:userId` → 204 (self-leave allowed)
  - `GET /api/orgs/:orgId/repos` → public repos · `GET /api/orgs/:orgId/usage` → `{ repos, repoLimit, pieces }`
  - `GET /api/invitations/:token` → `{ orgName, email, role, status }` · `POST /api/invitations/:token/accept` (auth+csrf) → `{ orgId }`
  - Invitation mail link: `${appUrl}/invite/${token}`

- [ ] **Step 1: Write the failing tests**

`apps/api/test/orgs.integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, tokenFromLink, uniqueEmail, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

type Who = Awaited<ReturnType<typeof signupVerified>>;
const call = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: method === 'GET' ? { cookie: who.cookie } : authed(who), ...(payload === undefined ? {} : { payload: payload as object }) });

const setupOrg = async () => {
  const owner = await signupVerified(ctx);
  const org = (await call(owner, 'POST', '/api/orgs', { name: 'Acme' })).json();
  return { owner, org };
};

const inviteAndJoin = async (owner: Who, orgId: string, role: 'admin' | 'member') => {
  const email = uniqueEmail(role);
  await call(owner, 'POST', `/api/orgs/${orgId}/invitations`, { email, role });
  const token = tokenFromLink(ctx.mailer.inbox(email).find((m) => m.kind === 'invite')!.link!);
  const invitee = await signupVerified(ctx, email);
  const accepted = await call(invitee, 'POST', `/api/invitations/${token}/accept`, {});
  expect(accepted.json()).toEqual({ orgId });
  return invitee;
};

describe('organizations', () => {
  it('creates and lists orgs and updates defaults (owner/admin only)', async () => {
    const { owner, org } = await setupOrg();
    expect(org).toMatchObject({ name: 'Acme', slug: 'acme', role: 'owner', defaultUiLanguage: 'en' });
    expect((await call(owner, 'GET', '/api/orgs')).json()).toHaveLength(1);
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}`, { defaultTheme: 'studio', defaultUiLanguage: 'es' })).json()).toMatchObject({ defaultTheme: 'studio', defaultUiLanguage: 'es' });
    const member = await inviteAndJoin(owner, org.id, 'member');
    expect((await call(member, 'PATCH', `/api/orgs/${org.id}`, { name: 'Hacked' })).json()).toEqual({ error: { code: 'forbidden' } });
  });

  it('hides other tenants behind 404', async () => {
    const { org } = await setupOrg();
    const stranger = await signupVerified(ctx);
    for (const url of [`/api/orgs/${org.id}`, `/api/orgs/${org.id}/members`, `/api/orgs/${org.id}/repos`, '/api/orgs/not-a-uuid']) {
      const res = await call(stranger, 'GET', url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not_found' } });
    }
  });
});

describe('invitations and members', () => {
  it('invites, lists pending, resends and revokes', async () => {
    const { owner, org } = await setupOrg();
    const created = (await call(owner, 'POST', `/api/orgs/${org.id}/invitations`, { email: 'sofi@acme.com', role: 'member' })).json();
    expect(created).toMatchObject({ email: 'sofi@acme.com', role: 'member' });
    expect(ctx.mailer.inbox('sofi@acme.com')[0]!.link).toMatch(/^http:\/\/localhost:5177\/invite\//);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/members`)).json().invitations).toHaveLength(1);
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/invitations/${created.id}/resend`, {})).statusCode).toBe(200);
    expect(ctx.mailer.inbox('sofi@acme.com')).toHaveLength(2);
    expect((await call(owner, 'DELETE', `/api/orgs/${org.id}/invitations/${created.id}`)).statusCode).toBe(204);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/members`)).json().invitations).toEqual([]);
  });

  it('previews and accepts invitations only for the invited email', async () => {
    const { owner, org } = await setupOrg();
    await call(owner, 'POST', `/api/orgs/${org.id}/invitations`, { email: 'sofi@acme.com', role: 'admin' });
    const token = tokenFromLink(ctx.mailer.inbox('sofi@acme.com')[0]!.link!);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/invitations/${token}` })).json()).toEqual({ orgName: 'Acme', email: 'sofi@acme.com', role: 'admin', status: 'valid' });
    const wrong = await signupVerified(ctx);
    expect((await call(wrong, 'POST', `/api/invitations/${token}/accept`, {})).json()).toEqual({ error: { code: 'email_mismatch' } });
    const sofi = await signupVerified(ctx, 'sofi@acme.com');
    expect((await call(sofi, 'POST', `/api/invitations/${token}/accept`, {})).json()).toEqual({ orgId: org.id });
    expect((await call(sofi, 'POST', `/api/invitations/${token}/accept`, {})).json()).toEqual({ error: { code: 'invitation_unavailable' } });
    expect((await call(sofi, 'GET', `/api/orgs/${org.id}`)).json().role).toBe('admin');
  });

  it('rejects inviting existing members', async () => {
    const { owner, org } = await setupOrg();
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/invitations`, { email: owner.email, role: 'member' })).json()).toEqual({ error: { code: 'already_member' } });
  });

  it('protects the last owner and owner-only changes', async () => {
    const { owner, org } = await setupOrg();
    const admin = await inviteAndJoin(owner, org.id, 'admin');
    const member = await inviteAndJoin(owner, org.id, 'member');
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}/members/${owner.userId}`, { role: 'admin' })).json()).toEqual({ error: { code: 'last_owner' } });
    expect((await call(owner, 'DELETE', `/api/orgs/${org.id}/members/${owner.userId}`)).json()).toEqual({ error: { code: 'last_owner' } });
    expect((await call(admin, 'PATCH', `/api/orgs/${org.id}/members/${member.userId}`, { role: 'owner' })).json()).toEqual({ error: { code: 'forbidden' } });
    expect((await call(admin, 'PATCH', `/api/orgs/${org.id}/members/${member.userId}`, { role: 'admin' })).statusCode).toBe(200);
    expect((await call(member, 'DELETE', `/api/orgs/${org.id}/members/${admin.userId}`)).json()).toEqual({ error: { code: 'forbidden' } });
    expect((await call(member, 'DELETE', `/api/orgs/${org.id}/members/${member.userId}`)).statusCode).toBe(204);
    expect((await call(member, 'GET', `/api/orgs/${org.id}`)).statusCode).toBe(404);
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}/members/${admin.userId}`, { role: 'owner' })).statusCode).toBe(200);
    expect((await call(owner, 'DELETE', `/api/orgs/${org.id}/members/${owner.userId}`)).statusCode).toBe(204);
  });

  it('lists members with roles; members do not see invitations', async () => {
    const { owner, org } = await setupOrg();
    const member = await inviteAndJoin(owner, org.id, 'member');
    await call(owner, 'POST', `/api/orgs/${org.id}/invitations`, { email: 'pending@acme.com', role: 'member' });
    const view = (await call(member, 'GET', `/api/orgs/${org.id}/members`)).json();
    expect(view.members.map((m: { role: string }) => m.role)).toEqual(['owner', 'member']);
    expect(view.invitations).toEqual([]);
  });
});

describe('repositories and usage', () => {
  it('lists seeded repositories with stages and reports usage', async () => {
    const { owner, org } = await setupOrg();
    await call(owner, 'POST', `/api/dev/orgs/${org.id}/seed-repos`, {});
    const repos = (await call(owner, 'GET', `/api/orgs/${org.id}/repos`)).json();
    expect(repos.map((r: { fullName: string }) => r.fullName)).toEqual(['acme/ml-ranker', 'acme/orders-api', 'acme/web-store']);
    expect(repos[1].stages[3]).toEqual({ name: 'summarize', status: 'running', progress: 64 });
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/usage`)).json()).toEqual({ repos: 3, repoLimit: 10, pieces: 0 });
  });
});
```

Run: `npm run test:integration -w @rdi/api`
Expected: FAIL — `/api/orgs` returns 404.

- [ ] **Step 2: Implement**

`apps/api/src/routes/orgs.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { REPO_LIMIT, THEME_IDS, UI_LANGUAGES } from '../domain/constants';
import { can, type Role } from '../domain/roles';
import { createInvitation, listPendingInvitations, renewInvitation, revokeInvitation } from '../db/queries/invitations';
import { countOwners, createOrg, findMemberByEmail, getMemberRole, listMembers, listOrgsForUser, removeMember, setRole, updateOrg, type OrgPatch } from '../db/queries/orgs';
import { countRepos, listRepos } from '../db/queries/repos';
import { fail, isUuid, requireAction, requireAuth, requireMember } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';
import { publicInvitation, publicOrg, publicRepo } from '../http/payloads';
import { emailSchema } from './auth';

const MAX_NAME = 80;
const nameSchema = z.string().trim().min(1).max(MAX_NAME);
const orgPatchSchema = z
  .object({ name: nameSchema.optional(), defaultUiLanguage: z.enum(UI_LANGUAGES).optional(), defaultExplanationLanguage: z.enum(UI_LANGUAGES).optional(), defaultTheme: z.enum(THEME_IDS).optional() })
  .strict();
const inviteSchema = z.object({ email: emailSchema, role: z.enum(['admin', 'member']) });
const roleSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) });
const ORG_COLUMN = { name: 'name', defaultUiLanguage: 'default_ui_language', defaultExplanationLanguage: 'default_explanation_language', defaultTheme: 'default_theme' } as const;

export const orgRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const param = (req: FastifyRequest, name: string) => (req.params as Record<string, string>)[name];

  const sendInvite = async (orgName: string, email: string, token: string) =>
    deps.mailer.send({ to: email, kind: 'invite', subject: `Join ${orgName} on Repository Designer`, text: `You were invited to ${orgName}.`, link: `${deps.config.appUrl}/invite/${token}` });

  api.get('/orgs', { preHandler: requireAuth }, async (req) => (await listOrgsForUser(deps.pool, req.auth!.user.id)).map(publicOrg));

  api.post('/orgs', { preHandler: requireAuth }, async (req, reply) => {
    const { name } = z.object({ name: nameSchema }).parse(req.body);
    const org = await createOrg(deps.pool, { name, ownerId: req.auth!.user.id });
    return reply.code(201).send(publicOrg({ ...org, role: 'owner' }));
  });

  api.get('/orgs/:orgId', { preHandler: member }, async (req) => publicOrg({ ...req.member!.org, role: req.member!.role }));

  api.patch('/orgs/:orgId', { preHandler: [...member, requireAction('org.update')] }, async (req) => {
    const body = orgPatchSchema.parse(req.body);
    const patch = Object.fromEntries(Object.entries(body).map(([key, value]) => [ORG_COLUMN[key as keyof typeof ORG_COLUMN], value])) as OrgPatch;
    const org = await updateOrg(deps.pool, req.member!.org.id, patch);
    return publicOrg({ ...org!, role: req.member!.role });
  });

  api.get('/orgs/:orgId/members', { preHandler: member }, async (req) => {
    const orgId = req.member!.org.id;
    const members = (await listMembers(deps.pool, orgId)).map((m) => ({ userId: m.user_id, email: m.email, name: m.name, role: m.role, joinedAt: m.created_at.toISOString() }));
    const invitations = can(req.member!.role, 'invitations.manage') ? (await listPendingInvitations(deps.pool, orgId, nowOf(deps))).map(publicInvitation) : [];
    return { members, invitations };
  });

  api.post('/orgs/:orgId/invitations', { preHandler: [...member, requireAction('invitations.manage')] }, async (req, reply) => {
    const body = inviteSchema.parse(req.body);
    const org = req.member!.org;
    if (await findMemberByEmail(deps.pool, org.id, body.email)) return fail(reply, 409, 'already_member');
    const { invitation, token } = await createInvitation(deps.pool, { orgId: org.id, email: body.email, role: body.role, invitedBy: req.auth!.user.id, now: nowOf(deps) });
    await sendInvite(org.name, invitation.email, token);
    return reply.code(201).send(publicInvitation(invitation));
  });

  api.post('/orgs/:orgId/invitations/:invitationId/resend', { preHandler: [...member, requireAction('invitations.manage')] }, async (req, reply) => {
    const id = param(req, 'invitationId');
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    const renewed = await renewInvitation(deps.pool, req.member!.org.id, id, nowOf(deps));
    if (!renewed) return fail(reply, 404, 'not_found');
    await sendInvite(req.member!.org.name, renewed.invitation.email, renewed.token);
    return publicInvitation(renewed.invitation);
  });

  api.delete('/orgs/:orgId/invitations/:invitationId', { preHandler: [...member, requireAction('invitations.manage')] }, async (req, reply) => {
    const id = param(req, 'invitationId');
    if (!isUuid(id) || (await revokeInvitation(deps.pool, req.member!.org.id, id, nowOf(deps))) === 0) return fail(reply, 404, 'not_found');
    return reply.code(204).send();
  });

  const targetOf = async (req: FastifyRequest, reply: FastifyReply): Promise<{ userId: string; role: Role } | null> => {
    const userId = param(req, 'userId');
    const role = isUuid(userId) ? await getMemberRole(deps.pool, req.member!.org.id, userId) : null;
    if (!userId || !role) {
      fail(reply, 404, 'not_found');
      return null;
    }
    return { userId, role };
  };

  api.patch('/orgs/:orgId/members/:userId', { preHandler: [...member, requireAction('members.manage')] }, async (req, reply) => {
    const { role } = roleSchema.parse(req.body);
    const target = await targetOf(req, reply);
    if (!target) return reply;
    const orgId = req.member!.org.id;
    if ((target.role === 'owner' || role === 'owner') && req.member!.role !== 'owner') return fail(reply, 403, 'forbidden');
    if (target.role === 'owner' && role !== 'owner' && (await countOwners(deps.pool, orgId)) === 1) return fail(reply, 409, 'last_owner');
    await setRole(deps.pool, orgId, target.userId, role);
    return { userId: target.userId, role };
  });

  api.delete('/orgs/:orgId/members/:userId', { preHandler: member }, async (req, reply) => {
    const target = await targetOf(req, reply);
    if (!target) return reply;
    const self = target.userId === req.auth!.user.id;
    const orgId = req.member!.org.id;
    if (!self && !can(req.member!.role, 'members.manage')) return fail(reply, 403, 'forbidden');
    if (target.role === 'owner' && !self && req.member!.role !== 'owner') return fail(reply, 403, 'forbidden');
    if (target.role === 'owner' && (await countOwners(deps.pool, orgId)) === 1) return fail(reply, 409, 'last_owner');
    await removeMember(deps.pool, orgId, target.userId);
    return reply.code(204).send();
  });

  api.get('/orgs/:orgId/repos', { preHandler: member }, async (req) => (await listRepos(deps.pool, req.member!.org.id)).map(publicRepo));

  api.get('/orgs/:orgId/usage', { preHandler: member }, async (req) => ({ repos: await countRepos(deps.pool, req.member!.org.id), repoLimit: REPO_LIMIT, pieces: 0 }));
};
```

`apps/api/src/routes/invitations.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { findInvitationByToken, invitationStatus, markInvitationAccepted } from '../db/queries/invitations';
import { addMember } from '../db/queries/orgs';
import { fail, requireAuth } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';

const MAX_TOKEN = 200;

export const invitationRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const lookup = async (token: string | undefined) => (token && token.length <= MAX_TOKEN ? findInvitationByToken(deps.pool, token) : null);

  api.get('/invitations/:token', async (req, reply) => {
    const inv = await lookup((req.params as { token?: string }).token);
    if (!inv) return fail(reply, 404, 'invalid_token');
    return { orgName: inv.org_name, email: inv.email, role: inv.role, status: invitationStatus(inv, nowOf(deps)) };
  });

  api.post('/invitations/:token/accept', { preHandler: requireAuth }, async (req, reply) => {
    const inv = await lookup((req.params as { token?: string }).token);
    if (!inv) return fail(reply, 404, 'invalid_token');
    const now = nowOf(deps);
    if (invitationStatus(inv, now) !== 'valid') return fail(reply, 410, 'invitation_unavailable');
    if (inv.email.toLowerCase() !== req.auth!.user.email.toLowerCase()) return fail(reply, 403, 'email_mismatch');
    await addMember(deps.pool, inv.org_id, req.auth!.user.id, inv.role);
    await markInvitationAccepted(deps.pool, inv.id, now);
    return { orgId: inv.org_id };
  });
};
```

In `apps/api/src/app.ts` add imports for `orgRoutes` and `invitationRoutes` and register them after `meRoutes(api, deps);`:
```ts
        orgRoutes(api, deps);
        invitationRoutes(api, deps);
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add organizations, members, invitations, repositories and usage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Server boot wiring

**Files:**
- Modify: `apps/api/src/server.ts`, `.env.example`, `README.md`

**Interfaces:**
- Produces: `npm run dev -w @rdi/api` migrates the configured database (creating it when `DB_ENSURE=true`) and serves `/health` + `/api/*`.

- [ ] **Step 1: Implement**

`apps/api/src/server.ts`:
```ts
import { buildApp } from './app';
import { createInfraChecks, createPgPool, createRedisClient } from './checks';
import { loadConfig } from './config';
import { ensureDatabase } from './db/ensureDatabase';
import { runMigrations } from './db/migrate';
import { createDevMailer } from './mail/mailer';

const APP_POOL_SIZE = 10;

const config = loadConfig();
if (config.dbEnsure) await ensureDatabase(config.databaseUrl);
const pool = createPgPool(config.databaseUrl, APP_POOL_SIZE);
const applied = await runMigrations(pool);
if (applied.length > 0) console.log(`applied migrations: ${applied.join(', ')}`);
const redis = createRedisClient(config.redisUrl);
const mailer = createDevMailer();
const infra = createInfraChecks(config);

const app = buildApp({
  checks: infra.checks,
  onClose: async () => {
    await infra.close();
    await pool.end();
    redis.disconnect();
  },
  deps: { config, pool, redis, mailer },
});

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`api listening on http://localhost:${config.port}${config.devRoutes ? ' (dev routes on)' : ''}`);
```

Append to `.env.example`:
```
NODE_ENV=development
APP_URL=http://localhost:5177
RDI_DEV_ROUTES=true
COOKIE_SECURE=true
```

Append to the README "Local development" section:
```markdown
The API applies database migrations on start. With `RDI_DEV_ROUTES=true` (never in production) it also serves
`/api/dev/mailbox?to=<email>` so you can read verification, reset and invitation emails locally.
```

- [ ] **Step 2: Smoke test**

Run (stop any running `npm run dev` first):
```bash
RDI_DEV_ROUTES=true npm run dev -w @rdi/api &
sleep 6
curl -s localhost:4040/health
curl -s -X POST localhost:4040/api/auth/signup -H 'content-type: application/json' -d '{"email":"smoke@example.com","name":"Smoke","password":"correct horse battery"}'
curl -s 'localhost:4040/api/dev/mailbox?to=smoke@example.com'
kill %1
```
Expected: health `ok`; signup `{"ok":true}` (or `email_taken` on a re-run); mailbox shows a `verify` message with a link.

- [ ] **Step 3: Full API verification and commit**

Run: `npm test -w @rdi/api && npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): boot the api with migrations, mailer and account routes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Web foundations — API client, session, preferences, proxy

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`
- Create: `apps/web/src/shell/api.ts`, `apps/web/src/shell/session.ts`, `apps/web/src/shell/preferences.ts`, `apps/web/src/shell/errors.ts`
- Test: `apps/web/test/shell/api.test.ts`, `apps/web/test/shell/preferences.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class ApiError extends Error { status: number; code: string }
  setCsrfToken(token: string | null): void
  apiFetch<T>(path: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<T>   // prefixes /api
  type SessionUser = { id; email; name; uiLanguage: UiLanguage | null; explanationLanguage: UiLanguage | null; theme: ThemeId | null; initialLevel: Level | null }
  type SessionOrg = { id; name; slug; role: 'owner' | 'admin' | 'member'; defaultUiLanguage: UiLanguage; defaultExplanationLanguage: UiLanguage; defaultTheme: ThemeId }
  type SessionData = { user: SessionUser; orgs: SessionOrg[]; csrfToken: string }
  SESSION_KEY = ['session']
  fetchSession(): Promise<SessionData | null>; useSession(); acceptSession(client, session); clearSession(client)
  type PreferencesPatch = Partial<Pick<SessionUser, 'name' | 'uiLanguage' | 'explanationLanguage' | 'theme' | 'initialLevel'>>
  useUpdateMe(): UseMutationResult<SessionUser, Error, PreferencesPatch>   // optimistic
  effectiveUiLanguage(user, org, fallback): UiLanguage; effectiveExplanationLanguage(user, org, ui): UiLanguage
  effectiveTheme(user, org): ThemeId; effectiveLevel(user): Level
  safeNext(next: string | null): string
  errorText(t, error: unknown): string
  ```

- [ ] **Step 1: Dependencies and proxy**

Run:
```bash
npm install -w @rdi/web react-router-dom @tanstack/react-query
grep -E '"(react-router-dom|@tanstack/react-query)"' apps/web/package.json
```

In `apps/web/vite.config.ts` replace the `server` line with:
```ts
  server: { port: 5177, strictPort: true, proxy: { '/api': process.env.VITE_API_URL ?? 'http://localhost:4040' } },
```

- [ ] **Step 2: Write the failing tests**

`apps/web/test/shell/api.test.ts`:
```ts
import { ApiError, apiFetch, setCsrfToken } from '../../src/shell/api';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => { vi.restoreAllMocks(); setCsrfToken(null); });

describe('apiFetch', () => {
  it('prefixes /api, sends JSON and the csrf header on mutations', async () => {
    const spy = respond(200, { ok: true });
    setCsrfToken('csrf-1');
    await apiFetch('/me', { method: 'PATCH', body: { theme: 'paper' } });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/me');
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'same-origin', body: '{"theme":"paper"}' });
    expect((init!.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
    expect((init!.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('does not send the csrf header on GET', async () => {
    const spy = respond(200, []);
    setCsrfToken('csrf-1');
    await apiFetch('/orgs');
    expect((spy.mock.calls[0]![1]!.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('throws ApiError with the server code', async () => {
    respond(401, { error: { code: 'invalid_credentials' } });
    await expect(apiFetch('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
  });

  it('handles 204 and non-JSON errors', async () => {
    respond(204, null);
    expect(await apiFetch('/x', { method: 'DELETE' })).toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }));
    const error = await apiFetch('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'unknown' });
  });
});
```

`apps/web/test/shell/preferences.test.ts`:
```ts
import { effectiveExplanationLanguage, effectiveLevel, effectiveTheme, effectiveUiLanguage, safeNext } from '../../src/shell/preferences';
import type { SessionOrg, SessionUser } from '../../src/shell/session';

const user = (patch: Partial<SessionUser> = {}): SessionUser => ({ id: 'u', email: 'a@b.c', name: 'A', uiLanguage: null, explanationLanguage: null, theme: null, initialLevel: null, ...patch });
const org = (patch: Partial<SessionOrg> = {}): SessionOrg => ({ id: 'o', name: 'Acme', slug: 'acme', role: 'owner', defaultUiLanguage: 'es', defaultExplanationLanguage: 'pt', defaultTheme: 'studio', ...patch });

describe('preference precedence', () => {
  it('prefers the user, then the org, then the fallback', () => {
    expect(effectiveUiLanguage(user({ uiLanguage: 'pt' }), org(), 'en')).toBe('pt');
    expect(effectiveUiLanguage(user(), org(), 'en')).toBe('es');
    expect(effectiveUiLanguage(user(), null, 'en')).toBe('en');
    expect(effectiveExplanationLanguage(user(), org(), 'en')).toBe('pt');
    expect(effectiveExplanationLanguage(user(), null, 'es')).toBe('es');
    expect(effectiveTheme(user({ theme: 'paper' }), org())).toBe('paper');
    expect(effectiveTheme(user(), org())).toBe('studio');
    expect(effectiveTheme(user(), null)).toBe('mission');
    expect(effectiveLevel(user({ initialLevel: 'detail' }))).toBe('detail');
    expect(effectiveLevel(user())).toBe('architecture');
  });
});

describe('safeNext', () => {
  it('only allows same-origin paths', () => {
    expect(safeNext('/orgs/1/explore')).toBe('/orgs/1/explore');
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
```

Run: `npm test -w @rdi/web -- shell`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/shell/api.ts`:
```ts
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const NO_CONTENT = 204;
let csrfToken: string | null = null;

export const setCsrfToken = (token: string | null): void => {
  csrfToken = token;
};

export const apiFetch = async <T>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> => {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (response.status === NO_CONTENT) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (data as { error?: { code?: string } } | null)?.error?.code ?? 'unknown';
    throw new ApiError(response.status, code);
  }
  return data as T;
};
```

`apps/web/src/shell/session.ts`:
```ts
import type { Level } from '@rdi/scene';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { UiLanguage } from '../i18n/messages';
import type { ThemeId } from '../theme/themes';
import { ApiError, apiFetch, setCsrfToken } from './api';

export type SessionUser = { id: string; email: string; name: string; uiLanguage: UiLanguage | null; explanationLanguage: UiLanguage | null; theme: ThemeId | null; initialLevel: Level | null };
export type SessionOrg = { id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member'; defaultUiLanguage: UiLanguage; defaultExplanationLanguage: UiLanguage; defaultTheme: ThemeId };
export type SessionData = { user: SessionUser; orgs: SessionOrg[]; csrfToken: string };
export type PreferencesPatch = Partial<Pick<SessionUser, 'name' | 'uiLanguage' | 'explanationLanguage' | 'theme' | 'initialLevel'>>;

export const SESSION_KEY = ['session'] as const;
const UNAUTHORIZED = 401;
const SESSION_STALE_MS = 60_000;

export const fetchSession = async (): Promise<SessionData | null> => {
  try {
    const session = await apiFetch<SessionData>('/auth/session');
    setCsrfToken(session.csrfToken);
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === UNAUTHORIZED) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
};

export const useSession = () => useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: SESSION_STALE_MS });

export const acceptSession = (client: QueryClient, session: SessionData) => {
  setCsrfToken(session.csrfToken);
  client.setQueryData(SESSION_KEY, session);
};

export const clearSession = (client: QueryClient) => {
  setCsrfToken(null);
  client.setQueryData(SESSION_KEY, null);
};

export const useUpdateMe = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: PreferencesPatch) => apiFetch<SessionUser>('/me', { method: 'PATCH', body: patch }),
    onMutate: (patch) => {
      const previous = client.getQueryData<SessionData | null>(SESSION_KEY);
      if (previous) client.setQueryData(SESSION_KEY, { ...previous, user: { ...previous.user, ...patch } });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) client.setQueryData(SESSION_KEY, context.previous);
    },
    onSuccess: (user) => {
      const current = client.getQueryData<SessionData | null>(SESSION_KEY);
      if (current) client.setQueryData(SESSION_KEY, { ...current, user });
    },
  });
};
```

`apps/web/src/shell/preferences.ts`:
```ts
import { LEVELS, type Level } from '@rdi/scene';
import type { UiLanguage } from '../i18n/messages';
import { resolveTheme, type ThemeId } from '../theme/themes';
import type { SessionOrg, SessionUser } from './session';

const DEFAULT_LEVEL: Level = 'architecture';

export const effectiveUiLanguage = (user: SessionUser, org: SessionOrg | null, fallback: UiLanguage): UiLanguage =>
  user.uiLanguage ?? org?.defaultUiLanguage ?? fallback;

export const effectiveExplanationLanguage = (user: SessionUser, org: SessionOrg | null, ui: UiLanguage): UiLanguage =>
  user.explanationLanguage ?? org?.defaultExplanationLanguage ?? ui;

export const effectiveTheme = (user: SessionUser, org: SessionOrg | null): ThemeId => resolveTheme(user.theme, org?.defaultTheme);

export const effectiveLevel = (user: SessionUser): Level =>
  user.initialLevel && (LEVELS as readonly string[]).includes(user.initialLevel) ? user.initialLevel : DEFAULT_LEVEL;

export const safeNext = (next: string | null): string => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
```

`apps/web/src/shell/errors.ts`:
```ts
import { messages, type MessageKey } from '../i18n/messages';
import { ApiError } from './api';

export const errorText = (t: (key: MessageKey) => string, error: unknown): string => {
  const key = `errors.${error instanceof ApiError ? error.code : 'unknown'}`;
  return key in messages.en ? t(key as MessageKey) : t('errors.unknown');
};
```

Note: `errors.*` keys land in Task 11; `errors.ts` typechecks now because `key` is a string until cast.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add api client, session hooks and preference resolution

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Shell i18n and the Aurora design system

**Files:**
- Create: `apps/web/src/i18n/shellMessages.ts`, `apps/web/src/shell/aurora.css`, `apps/web/src/shell/components/{AuroraBackground,AnimatedLogo,MiniFlow,Field,Buttons,LanguagePills,Segmented,Splash}.tsx`, `apps/web/src/shell/layouts/AuthLayout.tsx`
- Modify: `apps/web/src/i18n/messages.ts`
- Test: `apps/web/test/shell/components.test.tsx`

**Interfaces:**
- Produces: `shellEn/shellEs/shellPt` merged into the catalogs; components `AuroraBackground({children, soft?})`, `AnimatedLogo({size?, showName?})`, `MiniFlow()`, `Field(props & {label, error?, hint?})`, `PrimaryButton({loading?, ...})`, `GhostButton`, `LanguagePills()`, `Segmented<T extends string | null>({value, options: {value: T; label: string}[], onChange, disabled?, testid})`, `Splash()`, `AuthLayout` (route element with `<Outlet/>`).

- [ ] **Step 1: Write the failing test**

`apps/web/test/shell/components.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { messages } from '../../src/i18n/messages';
import { AnimatedLogo } from '../../src/shell/components/AnimatedLogo';
import { AuroraBackground } from '../../src/shell/components/AuroraBackground';
import { Field } from '../../src/shell/components/Field';
import { Segmented } from '../../src/shell/components/Segmented';
import { AuthLayout } from '../../src/shell/layouts/AuthLayout';

const wrap = (ui: React.ReactElement) => render(<I18nProvider initialLanguage="en"><MemoryRouter>{ui}</MemoryRouter></I18nProvider>);

describe('Aurora components', () => {
  it('renders the animated logo with the product name', () => {
    wrap(<AnimatedLogo />);
    expect(screen.getByTestId('animated-logo')).toHaveTextContent('Repository Designer');
    expect(screen.getByTestId('animated-logo').querySelectorAll('circle.nd')).toHaveLength(3);
  });

  it('renders the background layers and children', () => {
    wrap(<AuroraBackground><p>inside</p></AuroraBackground>);
    expect(document.querySelectorAll('.aurora-blob')).toHaveLength(3);
    expect(screen.getByText('inside')).toBeInTheDocument();
  });

  it('labels fields and exposes errors accessibly', () => {
    wrap(<Field label="Email" error="Required" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('switches the UI language from the pills', () => {
    wrap(<AuthLayout />);
    fireEvent.click(screen.getByTestId('lang-es'));
    expect(screen.getByTestId('lang-es')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('sin leer una línea de código.')).toBeInTheDocument();
  });

  it('segmented control reports changes', () => {
    const onChange = vi.fn();
    wrap(<Segmented testid="seg" value="a" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('seg-b'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByTestId('seg-a')).toHaveAttribute('aria-pressed', 'true');
  });

  it('has every shell key translated in es and pt', () => {
    const shellKeys = Object.keys(messages.en).filter((k) => /^(shell|auth|invite|onboarding|nav|general|members|repos|stage|repoStatus|usage|prefs|security|errors|common|role)\./.test(k));
    expect(shellKeys.length).toBeGreaterThan(100);
    shellKeys.forEach((k) => {
      expect(messages.es, k).toHaveProperty(k);
      expect(messages.pt, k).toHaveProperty(k);
    });
  });
});
```

Run: `npm test -w @rdi/web -- shell/components`
Expected: FAIL — modules not found.

- [ ] **Step 2: Shell catalogs and merge**

`apps/web/src/i18n/shellMessages.ts`:
```ts
export const shellEn = {
  'shell.headline': 'Understand any system',
  'shell.headlineAccent': 'without reading a line of code.',
  'shell.lead': 'Connect your repositories and watch every request flow, where the risks are and what happens when volume grows.',
  'shell.footer': '© Repository Designer · Privacy · Status: operational',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.name': 'Your name',
  'auth.signIn.title': 'Welcome back',
  'auth.signIn.subtitle': 'Sign in to your organization',
  'auth.signIn.submit': 'Sign in',
  'auth.forgot': 'Forgot your password?',
  'auth.createOrg': 'Create organization',
  'auth.haveInvite': 'I have an invitation',
  'auth.signUp.title': 'Create your account',
  'auth.signUp.subtitle': 'You will set up your organization next.',
  'auth.signUp.submit': 'Create account',
  'auth.passwordHint': 'At least 12 characters.',
  'auth.haveAccount': 'Already have an account? Sign in',
  'auth.checkEmail.title': 'Check your email',
  'auth.checkEmail.body': 'We sent a verification link to {email}.',
  'auth.resend': 'Resend email',
  'auth.resent': 'Sent again ✓',
  'auth.verify.working': 'Verifying your email…',
  'auth.verify.done': 'Email verified. You can sign in now.',
  'auth.verify.failed': 'This link is invalid or has expired.',
  'auth.goToSignIn': 'Go to sign in',
  'auth.forgotPage.title': 'Reset your password',
  'auth.forgotPage.subtitle': 'We will email you a reset link.',
  'auth.forgotPage.submit': 'Send reset link',
  'auth.forgotPage.sent': 'If an account exists for that email, a reset link is on its way.',
  'auth.reset.title': 'Choose a new password',
  'auth.reset.submit': 'Update password',
  'auth.reset.done': 'Password updated. Sign in with your new password.',
  'auth.back': 'Back to sign in',
  'invite.title': 'Join {org}',
  'invite.body': 'You were invited as {role} using {email}.',
  'invite.accept': 'Accept invitation',
  'invite.signInToAccept': 'Sign in to accept',
  'invite.signUpToAccept': 'Create an account',
  'invite.unavailable': 'This invitation is no longer valid.',
  'onboarding.title': 'Welcome! Let’s set up your organization',
  'onboarding.step1': 'Create organization',
  'onboarding.step2': 'Connect GitHub',
  'onboarding.step3': 'First map',
  'onboarding.orgName': 'Organization name',
  'onboarding.create': 'Create and continue',
  'onboarding.soon': 'Coming next',
  'nav.explore': 'Explore',
  'nav.settings': 'Settings',
  'nav.general': 'General',
  'nav.members': 'Members',
  'nav.repositories': 'Repositories',
  'nav.usage': 'Usage & limits',
  'nav.preferences': 'Preferences',
  'nav.security': 'Security',
  'nav.org': 'Organization',
  'nav.account': 'Account',
  'nav.signOut': 'Sign out',
  'nav.switchOrg': 'Switch organization',
  'common.save': 'Save',
  'common.saved': 'Saved ✓',
  'common.remove': 'Remove',
  'common.loading': 'Loading…',
  'role.owner': 'owner',
  'role.admin': 'admin',
  'role.member': 'member',
  'general.title': 'General',
  'general.subtitle': 'Organization settings. They apply to every member unless someone overrides them personally.',
  'general.name': 'Organization name',
  'general.uiLanguage': 'Default UI language',
  'general.explanationLanguage': 'Default explanation language',
  'general.theme': 'Default workspace theme',
  'general.readOnly': 'Only owners and admins can change these settings.',
  'members.title': 'Members',
  'members.subtitle': 'Invite whoever needs to understand the system.',
  'members.invite': 'Invite by email',
  'members.send': 'Invite',
  'members.pending': 'Pending invitations',
  'members.expires': 'expires {date}',
  'members.resend': 'Resend',
  'members.revoke': 'Revoke',
  'members.you': 'you',
  'members.leave': 'Leave',
  'repos.title': 'Repositories',
  'repos.subtitle': 'Connected through the GitHub App · read-only',
  'repos.connect': 'Connect GitHub',
  'repos.soon': 'Available in the next release',
  'repos.empty': 'No repositories yet. Connect GitHub to pick the ones to explore.',
  'repos.col.repo': 'Repository',
  'repos.col.branch': 'Branch',
  'repos.col.languages': 'Languages',
  'repos.col.status': 'Indexing',
  'repos.col.synced': 'Last sync',
  'repos.limit': '{count} of {limit} repositories',
  'repos.never': 'never',
  'stage.clone': 'Clone',
  'stage.parse': 'Parse',
  'stage.detect': 'Detect',
  'stage.summarize': 'Summarize',
  'stage.link': 'Link repos',
  'repoStatus.ready': 'ready',
  'repoStatus.indexing': 'indexing',
  'repoStatus.error': 'error',
  'repoStatus.pending': 'pending',
  'usage.title': 'Usage & limits',
  'usage.repos': 'Repositories',
  'usage.pieces': 'Indexed pieces',
  'usage.agent': 'Agent budget',
  'usage.agentSoon': 'Available when the agent is connected',
  'prefs.title': 'Preferences',
  'prefs.subtitle': 'Only for you. When unset, the organization default applies.',
  'prefs.uiLanguage': 'UI language',
  'prefs.explanationLanguage': 'Explanation language',
  'prefs.theme': 'Workspace theme',
  'prefs.level': 'Initial exploration level',
  'prefs.orgDefault': 'Org default ({value})',
  'security.title': 'Security',
  'security.password': 'Change password',
  'security.current': 'Current password',
  'security.new': 'New password',
  'security.update': 'Update password',
  'security.updated': 'Password updated. Your other sessions were signed out.',
  'security.sessions': 'Active sessions',
  'security.thisDevice': 'this device',
  'security.revoke': 'Sign out',
  'security.lastSeen': 'last seen {date}',
  'errors.invalid_credentials': 'Email or password is incorrect.',
  'errors.email_not_verified': 'Verify your email before signing in.',
  'errors.email_taken': 'An account with that email already exists.',
  'errors.weak_password': 'Use at least 12 characters and avoid common passwords.',
  'errors.invalid_token': 'This link is invalid or has expired.',
  'errors.rate_limited': 'Too many attempts. Try again in a few minutes.',
  'errors.forbidden': 'You don’t have permission to do that.',
  'errors.last_owner': 'The organization needs at least one owner.',
  'errors.already_member': 'That person is already a member.',
  'errors.email_mismatch': 'This invitation was sent to a different email.',
  'errors.invitation_unavailable': 'This invitation is no longer valid.',
  'errors.validation': 'Check the fields and try again.',
  'errors.not_found': 'Not found.',
  'errors.unknown': 'Something went wrong. Try again.',
} as const;

export type ShellKey = keyof typeof shellEn;
type ShellCatalog = Record<ShellKey, string>;

export const shellEs: ShellCatalog = {
  'shell.headline': 'Entendé cualquier sistema',
  'shell.headlineAccent': 'sin leer una línea de código.',
  'shell.lead': 'Conectá tus repos y mirá cómo fluye cada request, dónde están los riesgos y qué pasa cuando crece el volumen.',
  'shell.footer': '© Repository Designer · Privacidad · Estado: operativo',
  'auth.email': 'Email',
  'auth.password': 'Contraseña',
  'auth.name': 'Tu nombre',
  'auth.signIn.title': 'Bienvenido de nuevo',
  'auth.signIn.subtitle': 'Ingresá a tu organización',
  'auth.signIn.submit': 'Ingresar',
  'auth.forgot': '¿Olvidaste tu contraseña?',
  'auth.createOrg': 'Crear organización',
  'auth.haveInvite': 'Tengo una invitación',
  'auth.signUp.title': 'Creá tu cuenta',
  'auth.signUp.subtitle': 'Después configurás tu organización.',
  'auth.signUp.submit': 'Crear cuenta',
  'auth.passwordHint': 'Al menos 12 caracteres.',
  'auth.haveAccount': '¿Ya tenés cuenta? Ingresá',
  'auth.checkEmail.title': 'Revisá tu email',
  'auth.checkEmail.body': 'Te enviamos un link de verificación a {email}.',
  'auth.resend': 'Reenviar email',
  'auth.resent': 'Reenviado ✓',
  'auth.verify.working': 'Verificando tu email…',
  'auth.verify.done': 'Email verificado. Ya podés ingresar.',
  'auth.verify.failed': 'Este link es inválido o venció.',
  'auth.goToSignIn': 'Ir a ingresar',
  'auth.forgotPage.title': 'Restablecé tu contraseña',
  'auth.forgotPage.subtitle': 'Te enviamos un link por email.',
  'auth.forgotPage.submit': 'Enviar link',
  'auth.forgotPage.sent': 'Si existe una cuenta con ese email, el link ya está en camino.',
  'auth.reset.title': 'Elegí una contraseña nueva',
  'auth.reset.submit': 'Actualizar contraseña',
  'auth.reset.done': 'Contraseña actualizada. Ingresá con la nueva.',
  'auth.back': 'Volver a ingresar',
  'invite.title': 'Unite a {org}',
  'invite.body': 'Te invitaron como {role} con {email}.',
  'invite.accept': 'Aceptar invitación',
  'invite.signInToAccept': 'Ingresá para aceptar',
  'invite.signUpToAccept': 'Crear una cuenta',
  'invite.unavailable': 'Esta invitación ya no es válida.',
  'onboarding.title': '¡Bienvenido! Configuremos tu organización',
  'onboarding.step1': 'Crear organización',
  'onboarding.step2': 'Conectar GitHub',
  'onboarding.step3': 'Primer mapa',
  'onboarding.orgName': 'Nombre de la organización',
  'onboarding.create': 'Crear y continuar',
  'onboarding.soon': 'Próximamente',
  'nav.explore': 'Explorar',
  'nav.settings': 'Configuración',
  'nav.general': 'General',
  'nav.members': 'Miembros',
  'nav.repositories': 'Repositorios',
  'nav.usage': 'Uso y límites',
  'nav.preferences': 'Preferencias',
  'nav.security': 'Seguridad',
  'nav.org': 'Organización',
  'nav.account': 'Cuenta',
  'nav.signOut': 'Salir',
  'nav.switchOrg': 'Cambiar organización',
  'common.save': 'Guardar',
  'common.saved': 'Guardado ✓',
  'common.remove': 'Quitar',
  'common.loading': 'Cargando…',
  'role.owner': 'owner',
  'role.admin': 'admin',
  'role.member': 'miembro',
  'general.title': 'General',
  'general.subtitle': 'Configuración de la organización. Aplica a todos los miembros salvo que alguien la cambie para sí.',
  'general.name': 'Nombre de la organización',
  'general.uiLanguage': 'Idioma de la UI por defecto',
  'general.explanationLanguage': 'Idioma de las explicaciones por defecto',
  'general.theme': 'Tema del espacio de trabajo por defecto',
  'general.readOnly': 'Solo owners y admins pueden cambiar esta configuración.',
  'members.title': 'Miembros',
  'members.subtitle': 'Invitá a quien necesite entender el sistema.',
  'members.invite': 'Invitar por email',
  'members.send': 'Invitar',
  'members.pending': 'Invitaciones pendientes',
  'members.expires': 'vence {date}',
  'members.resend': 'Reenviar',
  'members.revoke': 'Revocar',
  'members.you': 'vos',
  'members.leave': 'Salir',
  'repos.title': 'Repositorios',
  'repos.subtitle': 'Conectados vía GitHub App · solo lectura',
  'repos.connect': 'Conectar GitHub',
  'repos.soon': 'Disponible en la próxima versión',
  'repos.empty': 'Todavía no hay repositorios. Conectá GitHub para elegir cuáles explorar.',
  'repos.col.repo': 'Repositorio',
  'repos.col.branch': 'Rama',
  'repos.col.languages': 'Lenguajes',
  'repos.col.status': 'Indexado',
  'repos.col.synced': 'Último sync',
  'repos.limit': '{count} de {limit} repositorios',
  'repos.never': 'nunca',
  'stage.clone': 'Clonar',
  'stage.parse': 'Parsear',
  'stage.detect': 'Detectar',
  'stage.summarize': 'Resumir',
  'stage.link': 'Vincular repos',
  'repoStatus.ready': 'listo',
  'repoStatus.indexing': 'indexando',
  'repoStatus.error': 'error',
  'repoStatus.pending': 'pendiente',
  'usage.title': 'Uso y límites',
  'usage.repos': 'Repositorios',
  'usage.pieces': 'Piezas indexadas',
  'usage.agent': 'Presupuesto del agente',
  'usage.agentSoon': 'Disponible cuando el agente esté conectado',
  'prefs.title': 'Preferencias',
  'prefs.subtitle': 'Solo para vos. Si no elegís nada, se usa el default de la organización.',
  'prefs.uiLanguage': 'Idioma de la UI',
  'prefs.explanationLanguage': 'Idioma de las explicaciones',
  'prefs.theme': 'Tema del espacio de trabajo',
  'prefs.level': 'Nivel inicial de exploración',
  'prefs.orgDefault': 'Default de la org ({value})',
  'security.title': 'Seguridad',
  'security.password': 'Cambiar contraseña',
  'security.current': 'Contraseña actual',
  'security.new': 'Contraseña nueva',
  'security.update': 'Actualizar contraseña',
  'security.updated': 'Contraseña actualizada. Cerramos tus otras sesiones.',
  'security.sessions': 'Sesiones activas',
  'security.thisDevice': 'este dispositivo',
  'security.revoke': 'Cerrar sesión',
  'security.lastSeen': 'última vez {date}',
  'errors.invalid_credentials': 'Email o contraseña incorrectos.',
  'errors.email_not_verified': 'Verificá tu email antes de ingresar.',
  'errors.email_taken': 'Ya existe una cuenta con ese email.',
  'errors.weak_password': 'Usá al menos 12 caracteres y evitá contraseñas comunes.',
  'errors.invalid_token': 'Este link es inválido o venció.',
  'errors.rate_limited': 'Demasiados intentos. Probá de nuevo en unos minutos.',
  'errors.forbidden': 'No tenés permiso para hacer eso.',
  'errors.last_owner': 'La organización necesita al menos un owner.',
  'errors.already_member': 'Esa persona ya es miembro.',
  'errors.email_mismatch': 'Esta invitación se envió a otro email.',
  'errors.invitation_unavailable': 'Esta invitación ya no es válida.',
  'errors.validation': 'Revisá los campos e intentá de nuevo.',
  'errors.not_found': 'No encontrado.',
  'errors.unknown': 'Algo salió mal. Intentá de nuevo.',
};

export const shellPt: ShellCatalog = {
  'shell.headline': 'Entenda qualquer sistema',
  'shell.headlineAccent': 'sem ler uma linha de código.',
  'shell.lead': 'Conecte seus repositórios e veja cada requisição fluir, onde estão os riscos e o que acontece quando o volume cresce.',
  'shell.footer': '© Repository Designer · Privacidade · Status: operacional',
  'auth.email': 'Email',
  'auth.password': 'Senha',
  'auth.name': 'Seu nome',
  'auth.signIn.title': 'Bem-vindo de volta',
  'auth.signIn.subtitle': 'Entre na sua organização',
  'auth.signIn.submit': 'Entrar',
  'auth.forgot': 'Esqueceu sua senha?',
  'auth.createOrg': 'Criar organização',
  'auth.haveInvite': 'Tenho um convite',
  'auth.signUp.title': 'Crie sua conta',
  'auth.signUp.subtitle': 'Depois você configura sua organização.',
  'auth.signUp.submit': 'Criar conta',
  'auth.passwordHint': 'Pelo menos 12 caracteres.',
  'auth.haveAccount': 'Já tem conta? Entre',
  'auth.checkEmail.title': 'Confira seu email',
  'auth.checkEmail.body': 'Enviamos um link de verificação para {email}.',
  'auth.resend': 'Reenviar email',
  'auth.resent': 'Reenviado ✓',
  'auth.verify.working': 'Verificando seu email…',
  'auth.verify.done': 'Email verificado. Você já pode entrar.',
  'auth.verify.failed': 'Este link é inválido ou expirou.',
  'auth.goToSignIn': 'Ir para entrar',
  'auth.forgotPage.title': 'Redefina sua senha',
  'auth.forgotPage.subtitle': 'Enviaremos um link por email.',
  'auth.forgotPage.submit': 'Enviar link',
  'auth.forgotPage.sent': 'Se existir uma conta com esse email, o link já está a caminho.',
  'auth.reset.title': 'Escolha uma nova senha',
  'auth.reset.submit': 'Atualizar senha',
  'auth.reset.done': 'Senha atualizada. Entre com a nova senha.',
  'auth.back': 'Voltar para entrar',
  'invite.title': 'Entre em {org}',
  'invite.body': 'Você foi convidado como {role} com {email}.',
  'invite.accept': 'Aceitar convite',
  'invite.signInToAccept': 'Entre para aceitar',
  'invite.signUpToAccept': 'Criar uma conta',
  'invite.unavailable': 'Este convite não é mais válido.',
  'onboarding.title': 'Bem-vindo! Vamos configurar sua organização',
  'onboarding.step1': 'Criar organização',
  'onboarding.step2': 'Conectar GitHub',
  'onboarding.step3': 'Primeiro mapa',
  'onboarding.orgName': 'Nome da organização',
  'onboarding.create': 'Criar e continuar',
  'onboarding.soon': 'Em breve',
  'nav.explore': 'Explorar',
  'nav.settings': 'Configurações',
  'nav.general': 'Geral',
  'nav.members': 'Membros',
  'nav.repositories': 'Repositórios',
  'nav.usage': 'Uso e limites',
  'nav.preferences': 'Preferências',
  'nav.security': 'Segurança',
  'nav.org': 'Organização',
  'nav.account': 'Conta',
  'nav.signOut': 'Sair',
  'nav.switchOrg': 'Trocar organização',
  'common.save': 'Salvar',
  'common.saved': 'Salvo ✓',
  'common.remove': 'Remover',
  'common.loading': 'Carregando…',
  'role.owner': 'owner',
  'role.admin': 'admin',
  'role.member': 'membro',
  'general.title': 'Geral',
  'general.subtitle': 'Configurações da organização. Valem para todos os membros, salvo quando alguém muda para si.',
  'general.name': 'Nome da organização',
  'general.uiLanguage': 'Idioma padrão da interface',
  'general.explanationLanguage': 'Idioma padrão das explicações',
  'general.theme': 'Tema padrão do espaço de trabalho',
  'general.readOnly': 'Somente owners e admins podem alterar estas configurações.',
  'members.title': 'Membros',
  'members.subtitle': 'Convide quem precisa entender o sistema.',
  'members.invite': 'Convidar por email',
  'members.send': 'Convidar',
  'members.pending': 'Convites pendentes',
  'members.expires': 'expira {date}',
  'members.resend': 'Reenviar',
  'members.revoke': 'Revogar',
  'members.you': 'você',
  'members.leave': 'Sair',
  'repos.title': 'Repositórios',
  'repos.subtitle': 'Conectados via GitHub App · somente leitura',
  'repos.connect': 'Conectar GitHub',
  'repos.soon': 'Disponível na próxima versão',
  'repos.empty': 'Ainda não há repositórios. Conecte o GitHub para escolher quais explorar.',
  'repos.col.repo': 'Repositório',
  'repos.col.branch': 'Branch',
  'repos.col.languages': 'Linguagens',
  'repos.col.status': 'Indexação',
  'repos.col.synced': 'Último sync',
  'repos.limit': '{count} de {limit} repositórios',
  'repos.never': 'nunca',
  'stage.clone': 'Clonar',
  'stage.parse': 'Analisar',
  'stage.detect': 'Detectar',
  'stage.summarize': 'Resumir',
  'stage.link': 'Vincular repos',
  'repoStatus.ready': 'pronto',
  'repoStatus.indexing': 'indexando',
  'repoStatus.error': 'erro',
  'repoStatus.pending': 'pendente',
  'usage.title': 'Uso e limites',
  'usage.repos': 'Repositórios',
  'usage.pieces': 'Peças indexadas',
  'usage.agent': 'Orçamento do agente',
  'usage.agentSoon': 'Disponível quando o agente estiver conectado',
  'prefs.title': 'Preferências',
  'prefs.subtitle': 'Somente para você. Sem escolha, vale o padrão da organização.',
  'prefs.uiLanguage': 'Idioma da interface',
  'prefs.explanationLanguage': 'Idioma das explicações',
  'prefs.theme': 'Tema do espaço de trabalho',
  'prefs.level': 'Nível inicial de exploração',
  'prefs.orgDefault': 'Padrão da org ({value})',
  'security.title': 'Segurança',
  'security.password': 'Alterar senha',
  'security.current': 'Senha atual',
  'security.new': 'Nova senha',
  'security.update': 'Atualizar senha',
  'security.updated': 'Senha atualizada. Suas outras sessões foram encerradas.',
  'security.sessions': 'Sessões ativas',
  'security.thisDevice': 'este dispositivo',
  'security.revoke': 'Encerrar',
  'security.lastSeen': 'visto {date}',
  'errors.invalid_credentials': 'Email ou senha incorretos.',
  'errors.email_not_verified': 'Verifique seu email antes de entrar.',
  'errors.email_taken': 'Já existe uma conta com esse email.',
  'errors.weak_password': 'Use pelo menos 12 caracteres e evite senhas comuns.',
  'errors.invalid_token': 'Este link é inválido ou expirou.',
  'errors.rate_limited': 'Muitas tentativas. Tente novamente em alguns minutos.',
  'errors.forbidden': 'Você não tem permissão para isso.',
  'errors.last_owner': 'A organização precisa de pelo menos um owner.',
  'errors.already_member': 'Essa pessoa já é membro.',
  'errors.email_mismatch': 'Este convite foi enviado para outro email.',
  'errors.invitation_unavailable': 'Este convite não é mais válido.',
  'errors.validation': 'Revise os campos e tente novamente.',
  'errors.not_found': 'Não encontrado.',
  'errors.unknown': 'Algo deu errado. Tente novamente.',
};
```

In `apps/web/src/i18n/messages.ts`:
- add `import { shellEn, shellEs, shellPt } from './shellMessages';` at the top;
- rename `const en = {` to `const workspaceEn = {` and, right after that object's closing `} as const;`, add `const en = { ...workspaceEn, ...shellEn } as const;`;
- rename `const es: Catalog = {` to `const esWorkspace: Catalog = {` and after its closing `};` add `const es: Catalog = { ...esWorkspace, ...shellEs };`;
- rename `const pt: Catalog = {` to `const ptWorkspace: Catalog = {` and after its closing `};` add `const pt: Catalog = { ...ptWorkspace, ...shellPt };`.

- [ ] **Step 3: Aurora stylesheet**

`apps/web/src/shell/aurora.css`:
```css
.aurora { position: relative; min-height: 100vh; overflow: hidden; background: #070a12; color: #eef2ff; font-family: Inter, system-ui, -apple-system, sans-serif; font-size: 14px; color-scheme: dark; }
.aurora * { box-sizing: border-box; }
.aurora-blob { position: absolute; border-radius: 50%; filter: blur(70px); opacity: .5; animation: aurora-float 14s ease-in-out infinite; pointer-events: none; }
.aurora-blob.b1 { width: 420px; height: 420px; background: #2dffa6; left: -100px; top: -80px; }
.aurora-blob.b2 { width: 480px; height: 480px; background: #6d5efc; right: -140px; top: 140px; animation-delay: -4s; }
.aurora-blob.b3 { width: 340px; height: 340px; background: #18c3ff; left: 38%; bottom: -160px; animation-delay: -8s; }
.aurora-soft .aurora-blob { opacity: .22; }
.aurora-grain { position: absolute; inset: 0; background-image: radial-gradient(rgba(255, 255, 255, .06) 1px, transparent 1px); background-size: 3px 3px; mix-blend-mode: overlay; pointer-events: none; }
.aurora-content { position: relative; z-index: 1; min-height: 100vh; }
@keyframes aurora-float { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(40px, 30px) scale(1.12); } }

.aurora-logo { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -.02em; font-size: 16px; }
.aurora-logo svg { overflow: visible; }
.aurora-logo .lk { stroke-dasharray: 40; stroke-dashoffset: 40; animation: logo-draw 1.2s ease-out forwards; }
.aurora-logo .lk.b { animation-delay: .35s; }
.aurora-logo .nd { transform-box: fill-box; transform-origin: center; animation: logo-pop .5s cubic-bezier(.3, 1.6, .5, 1) both; }
.aurora-logo .nd.b { animation-delay: .25s; } .aurora-logo .nd.c { animation-delay: .55s; }
.aurora-logo .tk { offset-path: path('M6 22 L18 8 L30 22'); animation: logo-ride 2.6s ease-in-out 1.2s infinite; }
@keyframes logo-draw { to { stroke-dashoffset: 0; } }
@keyframes logo-pop { from { transform: scale(0); } to { transform: scale(1); } }
@keyframes logo-ride { 0% { offset-distance: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { offset-distance: 100%; opacity: 0; } }

.shimmer { background: linear-gradient(90deg, #2dffa6, #18c3ff, #8b7dff, #2dffa6); -webkit-background-clip: text; background-clip: text; color: transparent; background-size: 200% 100%; animation: aurora-shimmer 6s linear infinite; }
@keyframes aurora-shimmer { to { background-position: 200% 0; } }

.glass { background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .14); backdrop-filter: blur(18px); border-radius: 20px; box-shadow: 0 30px 80px rgba(0, 0, 0, .45); }
.rise { animation: aurora-rise .8s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes aurora-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

.auth-grid { display: grid; grid-template-columns: 1.1fr 1fr; min-height: 100vh; }
.auth-pitch { padding: 40px 48px; display: flex; flex-direction: column; gap: 18px; }
.auth-pitch h1 { font-size: 40px; line-height: 1.08; letter-spacing: -.03em; margin: 36px 0 0; max-width: 520px; }
.auth-lead { color: #aab4d4; max-width: 440px; line-height: 1.55; font-size: 15px; }
.auth-footer { margin-top: auto; color: #8d97b8; font-size: 12px; }
.auth-panel { display: flex; align-items: center; justify-content: center; padding: 32px; }
.auth-card { width: 100%; max-width: 380px; padding: 28px; }
.auth-card-top { display: flex; justify-content: flex-end; margin-bottom: 4px; }
.auth-form h2 { margin: 0 0 4px; font-size: 20px; letter-spacing: -.01em; }
.auth-links { display: flex; justify-content: space-between; gap: 8px; margin-top: 16px; font-size: 12px; }
.auth-links a, .aurora a.link { color: #2dffa6; text-decoration: none; }
.muted-a { color: #8d97b8; font-size: 12px; }

.field { display: block; margin-top: 14px; }
.field-label { display: block; font-size: 12px; color: #aab4d4; margin-bottom: 6px; }
.input, .aurora select { width: 100%; padding: 11px 12px; border-radius: 12px; background: rgba(0, 0, 0, .28); border: 1px solid rgba(255, 255, 255, .14); color: #eef2ff; font: inherit; outline: none; transition: border-color .2s, box-shadow .2s; }
.input:focus, .aurora select:focus { border-color: #2dffa6; box-shadow: 0 0 0 4px rgba(45, 255, 166, .15); }
.input.has-error { border-color: #ff5d73; }
.field-hint { display: block; font-size: 11px; color: #8d97b8; margin-top: 5px; }
.field-error { display: block; font-size: 12px; color: #ff8a9a; margin-top: 5px; }

.btn-primary { display: inline-flex; justify-content: center; align-items: center; gap: 6px; width: 100%; margin-top: 18px; padding: 12px 16px; border: 0; border-radius: 12px; font: inherit; font-weight: 600; color: #04110b; cursor: pointer; text-decoration: none;
  background: linear-gradient(90deg, #2dffa6, #18c3ff, #2dffa6); background-size: 200% 100%; animation: aurora-shimmer 4s linear infinite; box-shadow: 0 10px 30px rgba(45, 255, 166, .25); transition: transform .15s; }
.btn-primary:hover { transform: translateY(-1px); }
.btn-primary:disabled { opacity: .6; cursor: default; transform: none; }
.btn-primary.btn-small { width: auto; margin: 0; padding: 8px 14px; font-size: 13px; }
.btn-ghost { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, .16); background: transparent; color: #aab4d4; font: inherit; font-size: 12px; cursor: pointer; }
.btn-ghost:hover { color: #eef2ff; border-color: rgba(255, 255, 255, .3); }
.btn-ghost:disabled { opacity: .5; cursor: default; }
.btn-danger { color: #ff8a9a; }

.pills { display: inline-flex; gap: 4px; }
.pills button { font: inherit; font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, .15); background: transparent; color: #aab4d4; cursor: pointer; }
.pills button[aria-pressed='true'] { background: #eef2ff; color: #070a12; }

.alert { margin: 14px 0 0; padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.4; }
.alert.error { background: rgba(255, 93, 115, .12); border: 1px solid rgba(255, 93, 115, .35); color: #ffc2cb; }
.alert.ok { background: rgba(45, 255, 166, .1); border: 1px solid rgba(45, 255, 166, .3); color: #b9ffe0; }

.mini-flow { position: relative; height: 150px; width: 420px; max-width: 100%; margin-top: 10px; }
.mini-flow svg { position: absolute; left: 0; top: 0; width: 420px; height: 150px; }
.mini-flow .flow { stroke-dasharray: 6 8; animation: flow-dash 1.2s linear infinite; }
.mini-flow .pill { position: absolute; padding: 8px 12px; border-radius: 12px; background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .12); backdrop-filter: blur(8px); font-size: 12px; animation: pill-bob 4s ease-in-out infinite; }
.mini-flow .pill:nth-of-type(2) { animation-delay: -1s; } .mini-flow .pill:nth-of-type(3) { animation-delay: -2s; }
@keyframes flow-dash { to { stroke-dashoffset: -28; } }
@keyframes pill-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

.segmented { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 12px; background: rgba(0, 0, 0, .25); border: 1px solid rgba(255, 255, 255, .1); }
.segmented button { font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 9px; border: 0; background: transparent; color: #aab4d4; cursor: pointer; }
.segmented button[aria-pressed='true'] { background: rgba(45, 255, 166, .16); color: #eef2ff; box-shadow: inset 0 0 0 1px rgba(45, 255, 166, .5); }
.segmented button:disabled { cursor: default; opacity: .6; }

.splash { display: grid; place-items: center; min-height: 100vh; }

.shell { display: grid; grid-template-columns: 230px 1fr; grid-template-rows: 64px 1fr; min-height: 100vh; }
.shell-top { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; padding: 0 24px; border-bottom: 1px solid rgba(255, 255, 255, .08); }
.shell-top select { width: auto; padding: 7px 10px; }
.shell-spacer { flex: 1; }
.shell-nav { padding: 20px 14px; display: flex; flex-direction: column; gap: 2px; }
.shell-nav-title { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #8d97b8; margin: 14px 10px 6px; }
.shell-nav-item { display: block; padding: 8px 12px; border-radius: 10px; color: #aab4d4; text-decoration: none; }
.shell-nav-item:hover { color: #eef2ff; background: rgba(255, 255, 255, .04); }
.shell-nav-item.is-active { color: #eef2ff; background: rgba(45, 255, 166, .1); box-shadow: inset 2px 0 0 #2dffa6; }
.shell-content { margin: 20px 24px 24px 0; padding: 26px 30px; overflow: auto; }
.shell-content h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -.02em; }
.shell-sub { color: #8d97b8; margin: 0 0 20px; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px 28px; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { text-align: left; font-weight: 500; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #8d97b8; padding: 8px 10px; border-bottom: 1px solid rgba(255, 255, 255, .08); }
.table td { padding: 11px 10px; border-bottom: 1px solid rgba(255, 255, 255, .06); vertical-align: middle; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, .16); font-size: 11px; color: #aab4d4; }
.stages { display: flex; gap: 6px; flex-wrap: wrap; }
.stage { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 11px; background: rgba(255, 255, 255, .05); color: #8d97b8; position: relative; overflow: hidden; }
.stage.done { color: #2dffa6; } .stage.error { color: #ff8a9a; }
.stage.running { color: #f5d90a; }
.stage.running::after { content: ''; position: absolute; left: 0; bottom: 0; height: 2px; width: 40%; background: linear-gradient(90deg, #2dffa6, #18c3ff); animation: stage-load 1.6s ease-in-out infinite; }
@keyframes stage-load { from { left: -40%; } to { left: 100%; } }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.status-dot.ready { background: #2dffa6; } .status-dot.indexing { background: #f5d90a; } .status-dot.error { background: #ff5d73; } .status-dot.pending { background: #8d97b8; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.stat { padding: 18px; border-radius: 16px; background: rgba(255, 255, 255, .04); border: 1px solid rgba(255, 255, 255, .08); }
.stat b { display: block; font-size: 28px; letter-spacing: -.02em; margin-top: 6px; }
.theme-swatches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.swatch { padding: 14px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, .14); cursor: pointer; text-align: left; font: inherit; }
.swatch[aria-pressed='true'] { box-shadow: 0 0 0 2px #2dffa6; }
.steps-list { display: flex; gap: 10px; margin: 18px 0; }
.steps-list li { list-style: none; flex: 1; padding: 10px 12px; border-radius: 12px; background: rgba(255, 255, 255, .04); color: #8d97b8; font-size: 12px; }
.steps-list li.is-active { color: #eef2ff; box-shadow: inset 0 0 0 1px rgba(45, 255, 166, .5); background: rgba(45, 255, 166, .08); }
.steps-list { padding: 0; }

@media (prefers-reduced-motion: reduce) {
  .aurora-blob, .shimmer, .btn-primary, .aurora-logo .lk, .aurora-logo .nd, .aurora-logo .tk, .rise, .mini-flow .flow, .mini-flow .pill, .stage.running::after { animation: none !important; }
  .aurora-logo .lk { stroke-dashoffset: 0; }
}
@media (max-width: 900px) {
  .auth-grid { grid-template-columns: 1fr; }
  .auth-pitch { display: none; }
  .shell { grid-template-columns: 1fr; }
  .shell-nav { flex-direction: row; overflow-x: auto; }
  .shell-content { margin: 0; border-radius: 0; }
}
```

- [ ] **Step 4: Components and auth layout**

`apps/web/src/shell/components/AuroraBackground.tsx`:
```tsx
import type { ReactNode } from 'react';
import '../aurora.css';

export const AuroraBackground = ({ children, soft = false }: { children: ReactNode; soft?: boolean }) => (
  <div className={soft ? 'aurora aurora-soft' : 'aurora'}>
    <div className="aurora-blob b1" aria-hidden />
    <div className="aurora-blob b2" aria-hidden />
    <div className="aurora-blob b3" aria-hidden />
    <div className="aurora-grain" aria-hidden />
    <div className="aurora-content">{children}</div>
  </div>
);
```

`apps/web/src/shell/components/AnimatedLogo.tsx`:
```tsx
import { useI18n } from '../../i18n/I18nProvider';

export const AnimatedLogo = ({ size = 36, showName = true }: { size?: number; showName?: boolean }) => {
  const { t } = useI18n();
  return (
    <span className="aurora-logo" data-testid="animated-logo">
      <svg width={size} height={(size * 30) / 36} viewBox="0 0 36 30" aria-hidden>
        <defs>
          <linearGradient id="aurora-logo-gradient" x1="0" x2="1">
            <stop offset="0" stopColor="#2dffa6" />
            <stop offset="1" stopColor="#18c3ff" />
          </linearGradient>
        </defs>
        <path className="lk" d="M6 22 L18 8" stroke="url(#aurora-logo-gradient)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path className="lk b" d="M18 8 L30 22" stroke="url(#aurora-logo-gradient)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle className="nd" cx="6" cy="22" r="4.5" fill="#2dffa6" />
        <circle className="nd b" cx="18" cy="8" r="4.5" fill="#18c3ff" />
        <circle className="nd c" cx="30" cy="22" r="4.5" fill="#8b7dff" />
        <circle className="tk" r="2.4" fill="#fff" />
      </svg>
      {showName && <span>{t('app.name')}</span>}
    </span>
  );
};
```

`apps/web/src/shell/components/MiniFlow.tsx`:
```tsx
export const MiniFlow = () => (
  <div className="mini-flow" aria-hidden>
    <svg viewBox="0 0 420 150">
      <path className="flow" d="M90 40 C 150 40, 150 100, 210 100 C 270 100, 270 40, 330 40" stroke="#2dffa6" strokeWidth="2" fill="none" opacity=".7" />
    </svg>
    <span className="pill" style={{ left: 0, top: 22 }}>🖥 checkout</span>
    <span className="pill" style={{ left: 160, top: 84 }}>⚙ worker</span>
    <span className="pill" style={{ left: 320, top: 22 }}>🛢 inventory</span>
  </div>
);
```

`apps/web/src/shell/components/Field.tsx`:
```tsx
import { useId, type InputHTMLAttributes } from 'react';

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string };

export const Field = ({ label, error, hint, className, ...input }: FieldProps) => {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} className={['input', error && 'has-error', className].filter(Boolean).join(' ')} aria-invalid={Boolean(error)} {...input} />
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
};
```

`apps/web/src/shell/components/Buttons.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean };

export const PrimaryButton = ({ loading = false, children, disabled, className, ...rest }: Props) => (
  <button {...rest} className={['btn-primary', className].filter(Boolean).join(' ')} disabled={loading || disabled} aria-busy={loading}>
    {loading ? '…' : children}
  </button>
);

export const GhostButton = ({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...rest} type={type} className={['btn-ghost', className].filter(Boolean).join(' ')} />
);
```

`apps/web/src/shell/components/LanguagePills.tsx`:
```tsx
import { useI18n } from '../../i18n/I18nProvider';
import { UI_LANGUAGES } from '../../i18n/messages';

export const LanguagePills = () => {
  const { language, setLanguage } = useI18n();
  return (
    <div className="pills" role="group" aria-label="Language">
      {UI_LANGUAGES.map((l) => (
        <button key={l} type="button" data-testid={`lang-${l}`} aria-pressed={language === l} onClick={() => setLanguage(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
};
```

`apps/web/src/shell/components/Segmented.tsx`:
```tsx
type Option<T> = { value: T; label: string };

type SegmentedProps<T extends string | null> = { value: T; options: Option<T>[]; onChange: (value: T) => void; disabled?: boolean; testid: string };

export const Segmented = <T extends string | null>({ value, options, onChange, disabled = false, testid }: SegmentedProps<T>) => (
  <div className="segmented" role="group" data-testid={testid}>
    {options.map((o) => (
      <button key={String(o.value)} type="button" data-testid={`${testid}-${o.value ?? 'default'}`} aria-pressed={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>
        {o.label}
      </button>
    ))}
  </div>
);
```

`apps/web/src/shell/components/Splash.tsx`:
```tsx
import { AnimatedLogo } from './AnimatedLogo';
import { AuroraBackground } from './AuroraBackground';

export const Splash = () => (
  <AuroraBackground>
    <div className="splash" data-testid="splash"><AnimatedLogo size={56} /></div>
  </AuroraBackground>
);
```

`apps/web/src/shell/layouts/AuthLayout.tsx`:
```tsx
import { Outlet } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { LanguagePills } from '../components/LanguagePills';
import { MiniFlow } from '../components/MiniFlow';

export const AuthLayout = () => {
  const { t } = useI18n();
  return (
    <AuroraBackground>
      <div className="auth-grid">
        <section className="auth-pitch">
          <AnimatedLogo />
          <h1>
            {t('shell.headline')} <span className="shimmer">{t('shell.headlineAccent')}</span>
          </h1>
          <p className="auth-lead">{t('shell.lead')}</p>
          <MiniFlow />
          <footer className="auth-footer">{t('shell.footer')}</footer>
        </section>
        <section className="auth-panel">
          <div className="glass auth-card rise">
            <div className="auth-card-top"><LanguagePills /></div>
            <Outlet />
          </div>
        </section>
      </div>
    </AuroraBackground>
  );
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add shell i18n and the Aurora design system

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Public auth pages

**Files:**
- Create: `apps/web/src/shell/pages/{LoginPage,SignupPage,CheckEmailPage,VerifyPage,ForgotPage,ResetPage,InvitePage}.tsx`
- Test: `apps/web/test/shell/render.tsx`, `apps/web/test/shell/authPages.test.tsx`

**Interfaces:**
- Consumes: Tasks 10–11.
- Produces pages (default layout `AuthLayout`) with testids: login `login-email`, `login-password`, `login-submit`, `form-error`, `resend-verification`; signup `signup-name`, `signup-email`, `signup-password`, `signup-submit`; verify `verify-status`; forgot `forgot-email`, `forgot-submit`, `forgot-sent`; reset `reset-password`, `reset-submit`; invite `invite-accept`, `invite-signin`, `invite-signup`, `invite-unavailable`. Test helpers `renderShell(ui, { route, path, session })`, `sessionFixture(patch?)`, `LocationProbe`.

- [ ] **Step 1: Test helpers and failing tests**

`apps/web/test/shell/render.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { SESSION_KEY, type SessionData } from '../../src/shell/session';

export const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
};

export const sessionFixture = (patch: Partial<SessionData> = {}): SessionData => ({
  user: { id: 'u1', email: 'ana@acme.com', name: 'Ana', uiLanguage: null, explanationLanguage: null, theme: null, initialLevel: null },
  orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'owner', defaultUiLanguage: 'en', defaultExplanationLanguage: 'en', defaultTheme: 'mission' }],
  csrfToken: 'csrf',
  ...patch,
});

export const renderShell = (ui: ReactElement, { route = '/', path = '/', session }: { route?: string; path?: string; session?: SessionData | null } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (session !== undefined) client.setQueryData(SESSION_KEY, session);
  const view = render(
    <I18nProvider initialLanguage="en">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { client, ...view };
};
```

`apps/web/test/shell/authPages.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { ApiError, apiFetch } from '../../src/shell/api';
import { CheckEmailPage } from '../../src/shell/pages/CheckEmailPage';
import { ForgotPage } from '../../src/shell/pages/ForgotPage';
import { InvitePage } from '../../src/shell/pages/InvitePage';
import { LoginPage } from '../../src/shell/pages/LoginPage';
import { ResetPage } from '../../src/shell/pages/ResetPage';
import { SignupPage } from '../../src/shell/pages/SignupPage';
import { VerifyPage } from '../../src/shell/pages/VerifyPage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
beforeEach(() => api.mockReset());

const type = (testid: string, value: string) => fireEvent.change(screen.getByTestId(testid), { target: { value } });

describe('LoginPage', () => {
  it('signs in and follows a safe next parameter', async () => {
    api.mockResolvedValueOnce(sessionFixture());
    renderShell(<LoginPage />, { route: '/login?next=/orgs/o1/settings', path: '/login' });
    type('login-email', 'ana@acme.com');
    type('login-password', 'correct horse battery');
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orgs/o1/settings'));
    expect(api).toHaveBeenCalledWith('/auth/login', { method: 'POST', body: { email: 'ana@acme.com', password: 'correct horse battery' } });
  });

  it('shows the generic error and offers resending verification', async () => {
    api.mockRejectedValueOnce(new ApiError(403, 'email_not_verified')).mockResolvedValueOnce({ ok: true });
    renderShell(<LoginPage />, { route: '/login', path: '/login' });
    type('login-email', 'ana@acme.com');
    type('login-password', 'x');
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Verify your email before signing in.');
    fireEvent.click(screen.getByTestId('resend-verification'));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('/auth/resend-verification', { method: 'POST', body: { email: 'ana@acme.com' } }));
  });
});

describe('SignupPage', () => {
  it('shows server validation and moves to check-email on success', async () => {
    api.mockRejectedValueOnce(new ApiError(400, 'weak_password')).mockResolvedValueOnce({ ok: true });
    renderShell(<SignupPage />, { route: '/signup', path: '/signup' });
    type('signup-name', 'Ana');
    type('signup-email', 'ana@acme.com');
    type('signup-password', 'short');
    fireEvent.click(screen.getByTestId('signup-submit'));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('at least 12 characters');
    type('signup-password', 'correct horse battery');
    fireEvent.click(screen.getByTestId('signup-submit'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/check-email?email=ana%40acme.com'));
  });
});

describe('CheckEmailPage', () => {
  it('shows the address and resends', async () => {
    api.mockResolvedValueOnce({ ok: true });
    renderShell(<CheckEmailPage />, { route: '/check-email?email=ana%40acme.com', path: '/check-email' });
    expect(screen.getByText(/ana@acme.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('resend-verification'));
    expect(await screen.findByText('Sent again ✓')).toBeInTheDocument();
  });
});

describe('VerifyPage', () => {
  it('verifies exactly once even in StrictMode', async () => {
    api.mockResolvedValue({ ok: true });
    renderShell(<StrictMode><VerifyPage /></StrictMode>, { route: '/verify?token=abcdefghijkl', path: '/verify' });
    await waitFor(() => expect(screen.getByTestId('verify-status')).toHaveTextContent('Email verified'));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('reports invalid links', async () => {
    api.mockRejectedValueOnce(new ApiError(400, 'invalid_token'));
    renderShell(<VerifyPage />, { route: '/verify?token=abcdefghijkl', path: '/verify' });
    await waitFor(() => expect(screen.getByTestId('verify-status')).toHaveTextContent('invalid or has expired'));
  });
});

describe('ForgotPage and ResetPage', () => {
  it('always confirms the forgot request', async () => {
    api.mockResolvedValueOnce({ ok: true });
    renderShell(<ForgotPage />, { route: '/forgot', path: '/forgot' });
    type('forgot-email', 'ana@acme.com');
    fireEvent.click(screen.getByTestId('forgot-submit'));
    expect(await screen.findByTestId('forgot-sent')).toBeInTheDocument();
  });

  it('resets and returns to sign in', async () => {
    api.mockResolvedValueOnce({ ok: true });
    renderShell(<ResetPage />, { route: '/reset?token=abcdefghijkl', path: '/reset' });
    type('reset-password', 'brand new passphrase');
    fireEvent.click(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?reset=1'));
    expect(api).toHaveBeenCalledWith('/auth/reset', { method: 'POST', body: { token: 'abcdefghijkl', password: 'brand new passphrase' } });
  });
});

describe('InvitePage', () => {
  it('lets a signed-in user accept', async () => {
    api.mockResolvedValueOnce({ orgName: 'Acme', email: 'ana@acme.com', role: 'member', status: 'valid' }).mockResolvedValueOnce({ orgId: 'o1' }).mockResolvedValue(sessionFixture());
    renderShell(<InvitePage />, { route: '/invite/tok123', path: '/invite/:token', session: sessionFixture() });
    fireEvent.click(await screen.findByTestId('invite-accept'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orgs/o1/explore'));
  });

  it('asks anonymous users to sign in with a return path', async () => {
    api.mockResolvedValueOnce({ orgName: 'Acme', email: 'ana@acme.com', role: 'admin', status: 'valid' });
    renderShell(<InvitePage />, { route: '/invite/tok123', path: '/invite/:token', session: null });
    expect(await screen.findByTestId('invite-signin')).toHaveAttribute('href', '/login?next=%2Finvite%2Ftok123');
  });

  it('explains unavailable invitations', async () => {
    api.mockResolvedValueOnce({ orgName: 'Acme', email: 'ana@acme.com', role: 'admin', status: 'expired' });
    renderShell(<InvitePage />, { route: '/invite/tok123', path: '/invite/:token', session: null });
    expect(await screen.findByTestId('invite-unavailable')).toBeInTheDocument();
  });
});
```

Run: `npm test -w @rdi/web -- shell/authPages`
Expected: FAIL — page modules not found.

- [ ] **Step 2: Implement the pages**

`apps/web/src/shell/pages/LoginPage.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { ApiError, apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';
import { safeNext } from '../preferences';
import { acceptSession, type SessionData } from '../session';

export const LoginPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await apiFetch<SessionData>('/auth/login', { method: 'POST', body: { email, password } });
      acceptSession(client, session);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setUnverified(err instanceof ApiError && err.code === 'email_not_verified');
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    await apiFetch('/auth/resend-verification', { method: 'POST', body: { email } });
    setResent(true);
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{t('auth.signIn.title')}</h2>
      <p className="muted-a">{t('auth.signIn.subtitle')}</p>
      {params.get('reset') && <p className="alert ok">{t('auth.reset.done')}</p>}
      <Field label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" required />
      <Field label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" required />
      {error && <p className="alert error" role="alert" data-testid="form-error">{error}</p>}
      {unverified && (
        <GhostButton onClick={resend} data-testid="resend-verification" style={{ marginTop: 10 }}>
          {resent ? t('auth.resent') : t('auth.resend')}
        </GhostButton>
      )}
      <PrimaryButton type="submit" loading={busy} data-testid="login-submit">{t('auth.signIn.submit')} →</PrimaryButton>
      <div className="auth-links">
        <Link to="/forgot">{t('auth.forgot')}</Link>
        <Link to="/signup">{t('auth.createOrg')}</Link>
      </div>
    </form>
  );
};
```

`apps/web/src/shell/pages/SignupPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';

export const SignupPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/signup', { method: 'POST', body: { name, email, password } });
      navigate(`/check-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{t('auth.signUp.title')}</h2>
      <p className="muted-a">{t('auth.signUp.subtitle')}</p>
      <Field label={t('auth.name')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="signup-name" required />
      <Field label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="signup-email" required />
      <Field label={t('auth.password')} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="signup-password" required />
      {error && <p className="alert error" role="alert" data-testid="form-error">{error}</p>}
      <PrimaryButton type="submit" loading={busy} data-testid="signup-submit">{t('auth.signUp.submit')} →</PrimaryButton>
      <div className="auth-links"><Link to="/login">{t('auth.haveAccount')}</Link></div>
    </form>
  );
};
```

`apps/web/src/shell/pages/CheckEmailPage.tsx`:
```tsx
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton } from '../components/Buttons';

export const CheckEmailPage = () => {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [resent, setResent] = useState(false);
  const resend = async () => {
    await apiFetch('/auth/resend-verification', { method: 'POST', body: { email } });
    setResent(true);
  };
  return (
    <div className="auth-form">
      <h2>{t('auth.checkEmail.title')} ✉️</h2>
      <p className="muted-a">{t('auth.checkEmail.body', { email })}</p>
      <div className="row" style={{ marginTop: 16 }}>
        <GhostButton onClick={resend} disabled={!email || resent} data-testid="resend-verification">{resent ? t('auth.resent') : t('auth.resend')}</GhostButton>
        <Link className="link" to="/login">{t('auth.back')}</Link>
      </div>
    </div>
  );
};
```

`apps/web/src/shell/pages/VerifyPage.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';

type State = 'working' | 'done' | 'failed';

export const VerifyPage = () => {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [state, setState] = useState<State>('working');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    if (!token) {
      setState('failed');
      return;
    }
    apiFetch('/auth/verify', { method: 'POST', body: { token } }).then(() => setState('done'), () => setState('failed'));
  }, [params]);

  const message = { working: t('auth.verify.working'), done: t('auth.verify.done'), failed: t('auth.verify.failed') }[state];
  return (
    <div className="auth-form">
      <h2>{state === 'done' ? '✨ ' : ''}{t('auth.checkEmail.title')}</h2>
      <p className={state === 'failed' ? 'alert error' : state === 'done' ? 'alert ok' : 'muted-a'} data-testid="verify-status">{message}</p>
      {state !== 'working' && <Link className="btn-primary" to="/login">{t('auth.goToSignIn')} →</Link>}
    </div>
  );
};
```

`apps/web/src/shell/pages/ForgotPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';

export const ForgotPage = () => {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{t('auth.forgotPage.title')}</h2>
      <p className="muted-a">{t('auth.forgotPage.subtitle')}</p>
      {sent ? (
        <p className="alert ok" data-testid="forgot-sent">{t('auth.forgotPage.sent')}</p>
      ) : (
        <>
          <Field label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email" required />
          {error && <p className="alert error" role="alert">{error}</p>}
          <PrimaryButton type="submit" loading={busy} data-testid="forgot-submit">{t('auth.forgotPage.submit')}</PrimaryButton>
        </>
      )}
      <div className="auth-links"><Link to="/login">{t('auth.back')}</Link></div>
    </form>
  );
};
```

`apps/web/src/shell/pages/ResetPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';

export const ResetPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/reset', { method: 'POST', body: { token: params.get('token') ?? '', password } });
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{t('auth.reset.title')}</h2>
      <Field label={t('auth.password')} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="reset-password" required />
      {error && <p className="alert error" role="alert">{error}</p>}
      <PrimaryButton type="submit" loading={busy} data-testid="reset-submit">{t('auth.reset.submit')}</PrimaryButton>
    </form>
  );
};
```

`apps/web/src/shell/pages/InvitePage.tsx`:
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { errorText } from '../errors';
import { SESSION_KEY, useSession } from '../session';

type Preview = { orgName: string; email: string; role: 'admin' | 'member'; status: 'valid' | 'expired' | 'revoked' | 'accepted' };

export const InvitePage = () => {
  const { t } = useI18n();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: session } = useSession();
  const preview = useQuery({ queryKey: ['invitation', token], queryFn: () => apiFetch<Preview>(`/invitations/${encodeURIComponent(token)}`), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      const { orgId } = await apiFetch<{ orgId: string }>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} });
      await client.invalidateQueries({ queryKey: SESSION_KEY });
      navigate(`/orgs/${orgId}/explore`, { replace: true });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (preview.isLoading) return <p className="muted-a">{t('common.loading')}</p>;
  if (preview.isError || !preview.data || preview.data.status !== 'valid') {
    return <p className="alert error" data-testid="invite-unavailable">{t('invite.unavailable')}</p>;
  }
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <div className="auth-form">
      <h2>{t('invite.title', { org: preview.data.orgName })} 👋</h2>
      <p className="muted-a">{t('invite.body', { role: t(`role.${preview.data.role}`), email: preview.data.email })}</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      {session ? (
        <PrimaryButton onClick={accept} loading={busy} data-testid="invite-accept">{t('invite.accept')} →</PrimaryButton>
      ) : (
        <div className="auth-links">
          <Link to={`/login?next=${next}`} data-testid="invite-signin">{t('invite.signInToAccept')}</Link>
          <Link to={`/signup?next=${next}`} data-testid="invite-signup">{t('invite.signUpToAccept')}</Link>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add sign-in, sign-up, verification, reset and invitation pages

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Router, guards, onboarding and the authenticated workspace

**Files:**
- Create: `apps/web/src/shell/guards.tsx`, `apps/web/src/shell/pages/OnboardingPage.tsx`, `apps/web/src/shell/pages/ExplorePage.tsx`, `apps/web/src/shell/router.tsx`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/workspace/Workspace.tsx`, `apps/web/src/workspace/panels/TopBar.tsx`
- Test: `apps/web/test/shell/guards.test.tsx`, `apps/web/test/workspace/TopBar.test.tsx` (extend)

**Interfaces:**
- Produces:
  ```tsx
  <RequireAuth />          // Splash while loading; redirects to /login?next=… when anonymous; renders <PreferencesSync/> + <Outlet/>
  <HomeRedirect />         // → /login | /onboarding | /orgs/:first/explore
  <PreferencesSync session /> // applies the effective UI language for the current org
  <OnboardingPage />       // testids onboarding-name, onboarding-submit
  <ExplorePage />          // mounts <Workspace> with controlled theme/language, initial level and home link
  router (createBrowserRouter)
  Workspace props: { theme?: ThemeId; onTheme?(t); onLanguage?(l); initialLevel?: Level; homeHref?: string }
  TopBar extra props: { onLanguage?(l: UiLanguage); homeHref?: string }   // home link testid home-link
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/shell/guards.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { useI18n } from '../../src/i18n/I18nProvider';
import { apiFetch } from '../../src/shell/api';
import { HomeRedirect, RequireAuth } from '../../src/shell/guards';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
beforeEach(() => vi.mocked(apiFetch).mockReset());

const LanguageProbe = () => <div data-testid="lang">{useI18n().language}</div>;

describe('HomeRedirect', () => {
  it('sends anonymous users to sign in', async () => {
    renderShell(<HomeRedirect />, { session: null });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  });

  it('sends users without orgs to onboarding and others to their first org', async () => {
    renderShell(<HomeRedirect />, { session: sessionFixture({ orgs: [] }) });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/onboarding'));
  });

  it('opens the first organization workspace', async () => {
    renderShell(<HomeRedirect />, { session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orgs/o1/explore'));
  });
});

describe('RequireAuth', () => {
  const guarded = (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="*" element={<LanguageProbe />} />
      </Route>
    </Routes>
  );

  it('redirects anonymous users with a return path', async () => {
    vi.mocked(apiFetch).mockResolvedValue(null);
    renderShell(guarded, { route: '/orgs/o1/settings', path: '/orgs/*', session: null });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Forgs%2Fo1%2Fsettings'));
  });

  it('renders children and applies the org default language', async () => {
    const session = sessionFixture({ orgs: [{ ...sessionFixture().orgs[0]!, defaultUiLanguage: 'es' }] });
    renderShell(guarded, { route: '/orgs/o1/settings', path: '/orgs/*', session });
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('es'));
  });

  it('prefers the user language over the org default', async () => {
    const base = sessionFixture();
    const session = { ...base, user: { ...base.user, uiLanguage: 'pt' as const }, orgs: [{ ...base.orgs[0]!, defaultUiLanguage: 'es' as const }] };
    renderShell(guarded, { route: '/orgs/o1/settings', path: '/orgs/*', session });
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('pt'));
  });
});
```

Append to `apps/web/test/workspace/TopBar.test.tsx` inside the `describe('TopBar', …)` block:
```tsx
  it('delegates language changes and renders the home link when provided', () => {
    const onLanguage = vi.fn();
    renderBar({ onLanguage, homeHref: '/orgs/o1/settings' });
    fireEvent.change(screen.getByTestId('language-select'), { target: { value: 'pt' } });
    expect(onLanguage).toHaveBeenCalledWith('pt');
    expect(screen.getByTestId('home-link')).toHaveAttribute('href', '/orgs/o1/settings');
  });
```

Run: `npm test -w @rdi/web -- shell/guards workspace/TopBar`
Expected: FAIL — guards module missing; TopBar ignores `onLanguage`/`homeHref`.

- [ ] **Step 2: Guards**

`apps/web/src/shell/guards.tsx`:
```tsx
import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useMatch } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { Splash } from './components/Splash';
import { effectiveUiLanguage } from './preferences';
import { useSession, type SessionData } from './session';

export const PreferencesSync = ({ session }: { session: SessionData }) => {
  const match = useMatch('/orgs/:orgId/*');
  const { language, setLanguage } = useI18n();
  const org = session.orgs.find((o) => o.id === match?.params.orgId) ?? session.orgs[0] ?? null;
  const target = effectiveUiLanguage(session.user, org, language);
  useEffect(() => {
    if (target !== language) setLanguage(target);
    // Only react to changes of the effective preference, not to local language switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return null;
};

export const RequireAuth = () => {
  const { data: session, isLoading } = useSession();
  const location = useLocation();
  if (isLoading) return <Splash />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <>
      <PreferencesSync session={session} />
      <Outlet />
    </>
  );
};

export const HomeRedirect = () => {
  const { data: session, isLoading } = useSession();
  if (isLoading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  const first = session.orgs[0];
  return <Navigate to={first ? `/orgs/${first.id}/explore` : '/onboarding'} replace />;
};
```

- [ ] **Step 3: Onboarding and explore pages**

`apps/web/src/shell/pages/OnboardingPage.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';
import { SESSION_KEY, type SessionOrg } from '../session';

export const OnboardingPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await apiFetch<SessionOrg>('/orgs', { method: 'POST', body: { name } });
      await client.refetchQueries({ queryKey: SESSION_KEY });
      navigate(`/orgs/${org.id}/explore`, { replace: true });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuroraBackground>
      <div className="splash">
        <form className="glass auth-card rise auth-form" style={{ maxWidth: 520 }} onSubmit={submit}>
          <AnimatedLogo size={30} />
          <h2 style={{ marginTop: 18 }}>{t('onboarding.title')}</h2>
          <ol className="steps-list">
            <li className="is-active">1 · {t('onboarding.step1')}</li>
            <li>2 · {t('onboarding.step2')} <span className="muted-a">({t('onboarding.soon')})</span></li>
            <li>3 · {t('onboarding.step3')}</li>
          </ol>
          <Field label={t('onboarding.orgName')} value={name} onChange={(e) => setName(e.target.value)} data-testid="onboarding-name" required />
          {error && <p className="alert error" role="alert">{error}</p>}
          <PrimaryButton type="submit" loading={busy} disabled={!name.trim()} data-testid="onboarding-submit">{t('onboarding.create')} →</PrimaryButton>
        </form>
      </div>
    </AuroraBackground>
  );
};
```

`apps/web/src/shell/pages/ExplorePage.tsx`:
```tsx
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { Workspace } from '../../workspace/Workspace';
import { effectiveLevel, effectiveTheme } from '../preferences';
import { useSession, useUpdateMe } from '../session';

export const ExplorePage = () => {
  const { orgId } = useParams();
  const { data: session } = useSession();
  const updateMe = useUpdateMe();
  const { setLanguage } = useI18n();
  if (!session) return null;
  const org = session.orgs.find((o) => o.id === orgId);
  if (!org) return <Navigate to="/" replace />;
  return (
    <Workspace
      theme={effectiveTheme(session.user, org)}
      onTheme={(theme) => updateMe.mutate({ theme })}
      onLanguage={(uiLanguage) => {
        setLanguage(uiLanguage);
        updateMe.mutate({ uiLanguage });
      }}
      initialLevel={effectiveLevel(session.user)}
      homeHref={`/orgs/${org.id}/settings`}
    />
  );
};
```

- [ ] **Step 4: Controlled workspace and top bar**

In `apps/web/src/workspace/panels/TopBar.tsx`:
- add to `TopBarProps`: `onLanguage?: (language: UiLanguage) => void; homeHref?: string;`
- replace the language select `onChange` with `onChange={(e) => (p.onLanguage ?? setLanguage)(e.target.value as UiLanguage)}`;
- right before the theme `<select …>` add:
```tsx
      {p.homeHref && (
        <a className="btn" href={p.homeHref} data-testid="home-link" title={t('nav.settings')}>⚙ {t('nav.settings')}</a>
      )}
```

In `apps/web/src/workspace/Workspace.tsx`:
- add `import type { UiLanguage } from '../i18n/messages';`;
- change the component signature and theme handling:
```tsx
type WorkspaceProps = { theme?: ThemeId; onTheme?: (theme: ThemeId) => void; onLanguage?: (language: UiLanguage) => void; initialLevel?: Level; homeHref?: string };

export const Workspace = ({ theme: controlledTheme, onTheme, onLanguage, initialLevel = DEFAULT_LEVEL, homeHref }: WorkspaceProps = {}) => {
```
- replace `() => initialExplorerState(sceneFor(language).id, DEFAULT_LEVEL),` with `() => initialExplorerState(sceneFor(language).id, initialLevel),`;
- replace the theme state and effect with:
```tsx
  const [localTheme, setLocalTheme] = useState<ThemeId>(() => resolveTheme(localStorage.getItem(THEME_STORAGE_KEY)));
  const theme = controlledTheme ?? localTheme;
  const setTheme = (next: ThemeId) => (onTheme ? onTheme(next) : setLocalTheme(next));

  useEffect(() => {
    applyTheme(document.documentElement, theme);
    if (!controlledTheme) localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, controlledTheme]);
```
- pass the new props to `<TopBar …>`: `onLanguage={onLanguage}` and `homeHref={homeHref}`.

- [ ] **Step 5: Router and entry point**

`apps/web/src/shell/router.tsx`:
```tsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { HomeRedirect, RequireAuth } from './guards';
import { AuthLayout } from './layouts/AuthLayout';
import { CheckEmailPage } from './pages/CheckEmailPage';
import { ExplorePage } from './pages/ExplorePage';
import { ForgotPage } from './pages/ForgotPage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ResetPage } from './pages/ResetPage';
import { SignupPage } from './pages/SignupPage';
import { VerifyPage } from './pages/VerifyPage';
import { GeneralPage } from './settings/GeneralPage';
import { MembersPage } from './settings/MembersPage';
import { PreferencesPage } from './settings/PreferencesPage';
import { RepositoriesPage } from './settings/RepositoriesPage';
import { SecurityPage } from './settings/SecurityPage';
import { SettingsLayout } from './settings/SettingsLayout';
import { UsagePage } from './settings/UsagePage';

export const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/check-email', element: <CheckEmailPage /> },
      { path: '/verify', element: <VerifyPage /> },
      { path: '/forgot', element: <ForgotPage /> },
      { path: '/reset', element: <ResetPage /> },
      { path: '/invite/:token', element: <InvitePage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/orgs/:orgId/explore', element: <ExplorePage /> },
      {
        path: '/orgs/:orgId/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="general" replace /> },
          { path: 'general', element: <GeneralPage /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'repositories', element: <RepositoriesPage /> },
          { path: 'usage', element: <UsagePage /> },
          { path: 'preferences', element: <PreferencesPage /> },
          { path: 'security', element: <SecurityPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
```

The settings pages are created in Task 14. To keep this task green, create placeholder modules now and replace them in Task 14 — each file exports one component returning `null`:
```bash
mkdir -p apps/web/src/shell/settings
for p in SettingsLayout GeneralPage MembersPage RepositoriesPage UsagePage PreferencesPage SecurityPage; do
  printf "export const %s = () => null;\n" "$p" > apps/web/src/shell/settings/$p.tsx
done
```

`apps/web/src/main.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { I18nProvider } from './i18n/I18nProvider';
import { router } from './shell/router';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): add router, auth guards, onboarding and the authenticated workspace

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Settings screens

**Files:**
- Replace placeholders: `apps/web/src/shell/settings/{SettingsLayout,GeneralPage,MembersPage,RepositoriesPage,UsagePage,PreferencesPage,SecurityPage}.tsx`
- Create: `apps/web/src/shell/format.ts`
- Test: `apps/web/test/shell/settings.test.tsx`

**Interfaces:**
- Produces: `useSettingsContext(): { org: SessionOrg; session: SessionData }`; `formatRelative(iso: string | null, locale: string, now?: Date): string | null`; testids — layout `org-switcher`, `nav-explore`, `sign-out`, `nav-<slug>`; general `general-name`, `general-ui`, `general-explanation`, `general-theme`, `general-save`, `general-saved`; members `member-row-<userId>`, `member-role-<userId>`, `member-remove-<userId>`, `invite-email`, `invite-role`, `invite-submit`, `invitation-<id>`, `invitation-resend-<id>`, `invitation-revoke-<id>`, `members-error`; repositories `repo-<fullName>`, `stage-<fullName>-<stage>`, `connect-github`, `repos-limit`; usage `usage-repos`; preferences `pref-ui`, `pref-explanation`, `pref-theme`, `pref-level`; security `password-current`, `password-new`, `password-submit`, `password-updated`, `session-<id>`, `session-revoke-<id>`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/shell/settings.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { formatRelative } from '../../src/shell/format';
import { GeneralPage } from '../../src/shell/settings/GeneralPage';
import { MembersPage } from '../../src/shell/settings/MembersPage';
import { PreferencesPage } from '../../src/shell/settings/PreferencesPage';
import { RepositoriesPage } from '../../src/shell/settings/RepositoriesPage';
import { SecurityPage } from '../../src/shell/settings/SecurityPage';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
beforeEach(() => api.mockReset());

const inSettings = (page: React.ReactElement, session = sessionFixture()) =>
  renderShell(
    <Routes>
      <Route path=":orgId/settings" element={<SettingsLayout />}>
        <Route path="*" element={page} />
      </Route>
    </Routes>,
    { route: '/orgs/o1/settings/x', path: '/orgs/*', session },
  );

describe('formatRelative', () => {
  it('formats past times in the locale', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    expect(formatRelative('2026-09-28T11:56:00Z', 'en', now)).toBe('4 minutes ago');
    expect(formatRelative('2026-09-27T12:00:00Z', 'es', now)).toBe('ayer');
    expect(formatRelative(null, 'en', now)).toBeNull();
  });
});

describe('SettingsLayout', () => {
  it('shows navigation, the org switcher and the explore link', () => {
    inSettings(<p>content</p>);
    expect(screen.getByTestId('nav-members')).toHaveAttribute('href', '/orgs/o1/settings/members');
    expect(screen.getByTestId('nav-explore')).toHaveAttribute('href', '/orgs/o1/explore');
    expect(screen.getByTestId('org-switcher')).toHaveValue('o1');
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('GeneralPage', () => {
  it('saves org defaults for admins', async () => {
    api.mockResolvedValueOnce({}).mockResolvedValue(sessionFixture());
    inSettings(<GeneralPage />);
    fireEvent.click(screen.getByTestId('general-theme-studio'));
    fireEvent.click(screen.getByTestId('general-save'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1', { method: 'PATCH', body: { name: 'Acme', defaultUiLanguage: 'en', defaultExplanationLanguage: 'en', defaultTheme: 'studio' } }));
    expect(await screen.findByTestId('general-saved')).toBeInTheDocument();
  });

  it('is read-only for members', () => {
    const base = sessionFixture();
    inSettings(<GeneralPage />, { ...base, orgs: [{ ...base.orgs[0]!, role: 'member' }] });
    expect(screen.getByTestId('general-save')).toBeDisabled();
    expect(screen.getByText('Only owners and admins can change these settings.')).toBeInTheDocument();
  });
});

describe('MembersPage', () => {
  const members = {
    members: [
      { userId: 'u1', email: 'ana@acme.com', name: 'Ana', role: 'owner', joinedAt: '2026-09-01T00:00:00Z' },
      { userId: 'u2', email: 'leo@acme.com', name: 'Leo', role: 'member', joinedAt: '2026-09-02T00:00:00Z' },
    ],
    invitations: [{ id: 'i1', email: 'sofi@acme.com', role: 'member', expiresAt: '2026-10-05T00:00:00Z' }],
  };

  it('lists members and pending invitations and sends invitations', async () => {
    api.mockImplementation(async (path, init) => (init?.method === 'POST' ? { id: 'i2', email: 'new@acme.com', role: 'admin', expiresAt: '2026-10-05T00:00:00Z' } : members) as never);
    inSettings(<MembersPage />);
    expect(await screen.findByTestId('member-row-u2')).toHaveTextContent('leo@acme.com');
    expect(screen.getByTestId('member-row-u1')).toHaveTextContent('you');
    expect(screen.getByTestId('invitation-i1')).toHaveTextContent('sofi@acme.com');
    fireEvent.change(screen.getByTestId('invite-email'), { target: { value: 'new@acme.com' } });
    fireEvent.change(screen.getByTestId('invite-role'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByTestId('invite-submit'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1/invitations', { method: 'POST', body: { email: 'new@acme.com', role: 'admin' } }));
  });

  it('changes roles and shows server errors', async () => {
    const { ApiError } = await import('../../src/shell/api');
    api.mockImplementation(async (_path, init) => {
      if (init?.method === 'PATCH') throw new ApiError(409, 'last_owner');
      return members as never;
    });
    inSettings(<MembersPage />);
    fireEvent.change(await screen.findByTestId('member-role-u2'), { target: { value: 'admin' } });
    expect(await screen.findByTestId('members-error')).toHaveTextContent('at least one owner');
  });
});

describe('RepositoriesPage', () => {
  it('renders stages per repository and the disabled connect button', async () => {
    api.mockImplementation(async (path) =>
      (String(path).endsWith('/usage')
        ? { repos: 1, repoLimit: 10, pieces: 0 }
        : [{ id: 'r1', fullName: 'acme/orders-api', defaultBranch: 'main', languages: ['TypeScript'], status: 'indexing', lastSyncedAt: null, error: null,
            stages: [{ name: 'clone', status: 'done' }, { name: 'summarize', status: 'running', progress: 64 }, { name: 'link', status: 'pending' }] }]) as never,
    );
    inSettings(<RepositoriesPage />);
    expect(await screen.findByTestId('repo-acme/orders-api')).toHaveTextContent('main');
    expect(screen.getByTestId('stage-acme/orders-api-summarize')).toHaveClass('running');
    expect(screen.getByTestId('stage-acme/orders-api-summarize')).toHaveTextContent('64%');
    expect(screen.getByTestId('connect-github')).toBeDisabled();
    expect(await screen.findByTestId('repos-limit')).toHaveTextContent('1 of 10 repositories');
  });
});

describe('PreferencesPage', () => {
  it('patches the user preference and can reset to the org default', async () => {
    api.mockImplementation(async (_path, init) => ({ ...sessionFixture().user, ...(init?.body as object) }) as never);
    inSettings(<PreferencesPage />);
    fireEvent.click(screen.getByTestId('pref-ui-es'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/me', { method: 'PATCH', body: { uiLanguage: 'es' } }));
    fireEvent.click(screen.getByTestId('pref-theme-default'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/me', { method: 'PATCH', body: { theme: null } }));
  });
});

describe('SecurityPage', () => {
  it('changes the password and revokes other sessions', async () => {
    api.mockImplementation(async (path, init) => {
      if (path === '/me/sessions' && !init) return [{ id: 's1', createdAt: '2026-09-28T10:00:00Z', lastSeenAt: '2026-09-28T11:00:00Z', userAgent: 'Chrome', ip: '1.1.1.1', current: true }, { id: 's2', createdAt: '2026-09-20T10:00:00Z', lastSeenAt: '2026-09-21T11:00:00Z', userAgent: 'Safari', ip: '2.2.2.2', current: false }] as never;
      return { ok: true } as never;
    });
    inSettings(<SecurityPage />);
    expect(await screen.findByTestId('session-s1')).toHaveTextContent('this device');
    expect(screen.queryByTestId('session-revoke-s1')).toBeNull();
    fireEvent.click(screen.getByTestId('session-revoke-s2'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/me/sessions/s2', { method: 'DELETE' }));
    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'fresh passphrase 99' } });
    fireEvent.click(screen.getByTestId('password-submit'));
    expect(await screen.findByTestId('password-updated')).toBeInTheDocument();
  });
});
```

Run: `npm test -w @rdi/web -- shell/settings`
Expected: FAIL — placeholders render nothing and `format` is missing.

- [ ] **Step 2: Formatting helper and layout**

`apps/web/src/shell/format.ts`:
```ts
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1],
];

export const formatRelative = (iso: string | null, locale: string, now: Date = new Date()): string | null => {
  if (!iso) return null;
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
};

export const formatDate = (iso: string, locale: string): string => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
```

`apps/web/src/shell/settings/SettingsLayout.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import { apiFetch } from '../api';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { GhostButton } from '../components/Buttons';
import { clearSession, useSession, type SessionData, type SessionOrg } from '../session';

export type SettingsContext = { org: SessionOrg; session: SessionData };
export const useSettingsContext = () => useOutletContext<SettingsContext>();

const ORG_ITEMS: [string, MessageKey][] = [['general', 'nav.general'], ['members', 'nav.members'], ['repositories', 'nav.repositories'], ['usage', 'nav.usage']];
const ACCOUNT_ITEMS: [string, MessageKey][] = [['preferences', 'nav.preferences'], ['security', 'nav.security']];

export const SettingsLayout = () => {
  const { t } = useI18n();
  const { orgId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: session } = useSession();
  if (!session) return null;
  const org = session.orgs.find((o) => o.id === orgId);
  if (!org) return <Navigate to="/" replace />;

  const signOut = async () => {
    await apiFetch('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    clearSession(client);
    navigate('/login', { replace: true });
  };
  const item = ([slug, key]: [string, MessageKey]) => (
    <NavLink key={slug} to={`/orgs/${org.id}/settings/${slug}`} data-testid={`nav-${slug}`} className={({ isActive }) => (isActive ? 'shell-nav-item is-active' : 'shell-nav-item')}>
      {t(key)}
    </NavLink>
  );

  return (
    <AuroraBackground soft>
      <div className="shell">
        <header className="shell-top">
          <AnimatedLogo size={28} />
          <select aria-label={t('nav.switchOrg')} data-testid="org-switcher" value={org.id} onChange={(e) => navigate(`/orgs/${e.target.value}/settings/general`)}>
            {session.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="shell-spacer" />
          <Link className="btn-primary btn-small" to={`/orgs/${org.id}/explore`} data-testid="nav-explore">{t('nav.explore')} →</Link>
          <span className="muted-a">{session.user.email}</span>
          <GhostButton onClick={signOut} data-testid="sign-out">{t('nav.signOut')}</GhostButton>
        </header>
        <nav className="shell-nav">
          <div className="shell-nav-title">{t('nav.org')}</div>
          {ORG_ITEMS.map(item)}
          <div className="shell-nav-title">{t('nav.account')}</div>
          {ACCOUNT_ITEMS.map(item)}
        </nav>
        <main className="shell-content glass rise">
          <Outlet context={{ org, session } satisfies SettingsContext} />
        </main>
      </div>
    </AuroraBackground>
  );
};
```

- [ ] **Step 3: Pages**

`apps/web/src/shell/settings/GeneralPage.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { UI_LANGUAGES, type UiLanguage } from '../../i18n/messages';
import { THEMES, type ThemeId } from '../../theme/themes';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { Segmented } from '../components/Segmented';
import { errorText } from '../errors';
import { SESSION_KEY } from '../session';
import { useSettingsContext } from './SettingsLayout';

export const GeneralPage = () => {
  const { t } = useI18n();
  const { org } = useSettingsContext();
  const client = useQueryClient();
  const canEdit = org.role !== 'member';
  const [name, setName] = useState(org.name);
  const [ui, setUi] = useState<UiLanguage>(org.defaultUiLanguage);
  const [explanation, setExplanation] = useState<UiLanguage>(org.defaultExplanationLanguage);
  const [theme, setTheme] = useState<ThemeId>(org.defaultTheme);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const languages = UI_LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }));

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/orgs/${org.id}`, { method: 'PATCH', body: { name, defaultUiLanguage: ui, defaultExplanationLanguage: explanation, defaultTheme: theme } });
      await client.refetchQueries({ queryKey: SESSION_KEY });
      setSaved(true);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>{t('general.title')}</h1>
      <p className="shell-sub">{t('general.subtitle')}</p>
      {!canEdit && <p className="alert ok">{t('general.readOnly')}</p>}
      <div className="form-grid">
        <Field label={t('general.name')} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} data-testid="general-name" />
        <div className="field"><span className="field-label">{t('general.uiLanguage')}</span><Segmented testid="general-ui" value={ui} options={languages} onChange={setUi} disabled={!canEdit} /></div>
        <div className="field"><span className="field-label">{t('general.explanationLanguage')}</span><Segmented testid="general-explanation" value={explanation} options={languages} onChange={setExplanation} disabled={!canEdit} /></div>
        <div className="field"><span className="field-label">{t('general.theme')}</span><Segmented testid="general-theme" value={theme} options={THEMES.map((th) => ({ value: th, label: t(`theme.${th}`) }))} onChange={setTheme} disabled={!canEdit} /></div>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <PrimaryButton className="btn-small" onClick={save} loading={busy} disabled={!canEdit} data-testid="general-save">{t('common.save')}</PrimaryButton>
        {saved && <span className="muted-a" data-testid="general-saved">{t('common.saved')}</span>}
      </div>
    </section>
  );
};
```

`apps/web/src/shell/settings/MembersPage.tsx`:
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { errorText } from '../errors';
import { formatDate } from '../format';
import { useSettingsContext } from './SettingsLayout';

type Role = 'owner' | 'admin' | 'member';
type Member = { userId: string; email: string; name: string; role: Role; joinedAt: string };
type Invitation = { id: string; email: string; role: 'admin' | 'member'; expiresAt: string };
type MembersResponse = { members: Member[]; invitations: Invitation[] };

export const MembersPage = () => {
  const { t, language } = useI18n();
  const { org, session } = useSettingsContext();
  const client = useQueryClient();
  const key = ['members', org.id];
  const query = useQuery({ queryKey: key, queryFn: () => apiFetch<MembersResponse>(`/orgs/${org.id}/members`) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);
  const canManage = org.role !== 'member';

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await client.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await apiFetch(`/orgs/${org.id}/invitations`, { method: 'POST', body: { email, role } });
      setEmail('');
    });
  };

  return (
    <section>
      <h1>{t('members.title')}</h1>
      <p className="shell-sub">{t('members.subtitle')}</p>
      {error && <p className="alert error" role="alert" data-testid="members-error">{error}</p>}
      <table className="table">
        <tbody>
          {(query.data?.members ?? []).map((m) => {
            const self = m.userId === session.user.id;
            const editable = canManage && !self && (m.role !== 'owner' || org.role === 'owner');
            return (
              <tr key={m.userId} data-testid={`member-row-${m.userId}`}>
                <td>{m.email} {self && <span className="tag">{t('members.you')}</span>}</td>
                <td>{m.name}</td>
                <td>
                  {editable ? (
                    <select value={m.role} data-testid={`member-role-${m.userId}`} onChange={(e) => void run(() => apiFetch(`/orgs/${org.id}/members/${m.userId}`, { method: 'PATCH', body: { role: e.target.value } }))}>
                      {(org.role === 'owner' ? (['owner', 'admin', 'member'] as const) : (['admin', 'member'] as const)).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                    </select>
                  ) : (
                    <span className="tag">{t(`role.${m.role}`)}</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {(editable || self) && (
                    <GhostButton className="btn-danger" data-testid={`member-remove-${m.userId}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/members/${m.userId}`, { method: 'DELETE' }))}>
                      {self ? t('members.leave') : t('common.remove')}
                    </GhostButton>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canManage && (
        <>
          <h3 style={{ marginTop: 28 }}>{t('members.invite')}</h3>
          <form className="row" onSubmit={invite}>
            <input className="input" style={{ maxWidth: 320 }} type="email" placeholder="sofi@acme.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="invite-email" aria-label={t('auth.email')} required />
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} data-testid="invite-role" style={{ width: 140 }} aria-label={t('role.member')}>
              <option value="member">{t('role.member')}</option>
              <option value="admin">{t('role.admin')}</option>
            </select>
            <PrimaryButton className="btn-small" type="submit" data-testid="invite-submit">{t('members.send')} ↵</PrimaryButton>
          </form>
          {(query.data?.invitations.length ?? 0) > 0 && (
            <>
              <h3 style={{ marginTop: 28 }}>{t('members.pending')}</h3>
              <table className="table">
                <tbody>
                  {query.data!.invitations.map((i) => (
                    <tr key={i.id} data-testid={`invitation-${i.id}`}>
                      <td>{i.email}</td>
                      <td><span className="tag">{t(`role.${i.role}`)}</span></td>
                      <td className="muted-a">{t('members.expires', { date: formatDate(i.expiresAt, language) })}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <GhostButton data-testid={`invitation-resend-${i.id}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/invitations/${i.id}/resend`, { method: 'POST', body: {} }))}>{t('members.resend')}</GhostButton>
                          <GhostButton className="btn-danger" data-testid={`invitation-revoke-${i.id}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/invitations/${i.id}`, { method: 'DELETE' }))}>{t('members.revoke')}</GhostButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
};
```

`apps/web/src/shell/settings/RepositoriesPage.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton } from '../components/Buttons';
import { formatRelative } from '../format';
import { useSettingsContext } from './SettingsLayout';

type Stage = { name: 'clone' | 'parse' | 'detect' | 'summarize' | 'link'; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string };
type Repo = { id: string; fullName: string; defaultBranch: string; languages: string[]; status: 'pending' | 'indexing' | 'ready' | 'error'; stages: Stage[]; error: string | null; lastSyncedAt: string | null };
type Usage = { repos: number; repoLimit: number; pieces: number };

const STAGE_GLYPH = { done: '✓', running: '◐', error: '✕', pending: '○' } as const;

export const RepositoriesPage = () => {
  const { t, language } = useI18n();
  const { org } = useSettingsContext();
  const repos = useQuery({ queryKey: ['repos', org.id], queryFn: () => apiFetch<Repo[]>(`/orgs/${org.id}/repos`) });
  const usage = useQuery({ queryKey: ['usage', org.id], queryFn: () => apiFetch<Usage>(`/orgs/${org.id}/usage`) });

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('repos.title')}</h1>
          <p className="shell-sub">
            {t('repos.subtitle')}
            {usage.data && <> · <span data-testid="repos-limit">{t('repos.limit', { count: usage.data.repos, limit: usage.data.repoLimit })}</span></>}
          </p>
        </div>
        <GhostButton disabled title={t('repos.soon')} data-testid="connect-github">+ {t('repos.connect')}</GhostButton>
      </div>
      {repos.data && repos.data.length === 0 && <p className="alert ok">{t('repos.empty')}</p>}
      {repos.data && repos.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('repos.col.repo')}</th><th>{t('repos.col.branch')}</th><th>{t('repos.col.languages')}</th><th>{t('repos.col.status')}</th><th>{t('repos.col.synced')}</th>
            </tr>
          </thead>
          <tbody>
            {repos.data.map((r) => (
              <tr key={r.id} data-testid={`repo-${r.fullName}`}>
                <td>▣ {r.fullName}</td>
                <td><span className="tag">{r.defaultBranch}</span></td>
                <td className="muted-a">{r.languages.join(' · ')}</td>
                <td>
                  <div><span className={`status-dot ${r.status}`} />{t(`repoStatus.${r.status}`)}{r.error && <span className="muted-a"> — {r.error}</span>}</div>
                  <div className="stages" style={{ marginTop: 6 }}>
                    {r.stages.map((s) => (
                      <span key={s.name} className={`stage ${s.status}`} data-testid={`stage-${r.fullName}-${s.name}`} title={s.detail}>
                        {STAGE_GLYPH[s.status]} {t(`stage.${s.name}`)}{s.progress !== undefined && ` ${s.progress}%`}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="muted-a">{formatRelative(r.lastSyncedAt, language) ?? t('repos.never')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
```

`apps/web/src/shell/settings/UsagePage.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { useSettingsContext } from './SettingsLayout';

type Usage = { repos: number; repoLimit: number; pieces: number };

export const UsagePage = () => {
  const { t } = useI18n();
  const { org } = useSettingsContext();
  const usage = useQuery({ queryKey: ['usage', org.id], queryFn: () => apiFetch<Usage>(`/orgs/${org.id}/usage`) });
  return (
    <section>
      <h1>{t('usage.title')}</h1>
      <div className="cards" style={{ marginTop: 18 }}>
        <div className="stat" data-testid="usage-repos">{t('usage.repos')}<b>{usage.data ? `${usage.data.repos} / ${usage.data.repoLimit}` : '—'}</b></div>
        <div className="stat">{t('usage.pieces')}<b>{usage.data?.pieces ?? '—'}</b></div>
        <div className="stat">{t('usage.agent')}<b>—</b><span className="muted-a">{t('usage.agentSoon')}</span></div>
      </div>
    </section>
  );
};
```

`apps/web/src/shell/settings/PreferencesPage.tsx`:
```tsx
import { LEVELS, type Level } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';
import { UI_LANGUAGES, type UiLanguage } from '../../i18n/messages';
import { THEMES, type ThemeId } from '../../theme/themes';
import { Segmented } from '../components/Segmented';
import { useUpdateMe } from '../session';
import { useSettingsContext } from './SettingsLayout';

export const PreferencesPage = () => {
  const { t } = useI18n();
  const { org, session } = useSettingsContext();
  const updateMe = useUpdateMe();
  const { user } = session;
  const withDefault = <T extends string>(values: readonly T[], label: (v: T) => string, orgValue: string) => [
    { value: null, label: t('prefs.orgDefault', { value: orgValue }) },
    ...values.map((v) => ({ value: v, label: label(v) })),
  ];

  return (
    <section>
      <h1>{t('prefs.title')}</h1>
      <p className="shell-sub">{t('prefs.subtitle')}</p>
      <div className="field"><span className="field-label">{t('prefs.uiLanguage')}</span>
        <Segmented<UiLanguage | null> testid="pref-ui" value={user.uiLanguage} options={withDefault(UI_LANGUAGES, (l) => t(`language.${l}`), t(`language.${org.defaultUiLanguage}`))} onChange={(uiLanguage) => updateMe.mutate({ uiLanguage })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.explanationLanguage')}</span>
        <Segmented<UiLanguage | null> testid="pref-explanation" value={user.explanationLanguage} options={withDefault(UI_LANGUAGES, (l) => t(`language.${l}`), t(`language.${org.defaultExplanationLanguage}`))} onChange={(explanationLanguage) => updateMe.mutate({ explanationLanguage })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.theme')}</span>
        <Segmented<ThemeId | null> testid="pref-theme" value={user.theme} options={withDefault(THEMES, (th) => t(`theme.${th}`), t(`theme.${org.defaultTheme}`))} onChange={(theme) => updateMe.mutate({ theme })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.level')}</span>
        <Segmented<Level | null> testid="pref-level" value={user.initialLevel} options={withDefault(LEVELS, (l) => t(`level.${l}`), t('level.architecture'))} onChange={(initialLevel) => updateMe.mutate({ initialLevel })} />
      </div>
    </section>
  );
};
```

`apps/web/src/shell/settings/SecurityPage.tsx`:
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';
import { formatRelative } from '../format';

type SessionInfo = { id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; ip: string | null; current: boolean };
const SESSIONS_KEY = ['me', 'sessions'];

export const SecurityPage = () => {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: () => apiFetch<SessionInfo[]>('/me/sessions') });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setUpdated(false);
    try {
      await apiFetch('/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setUpdated(true);
      setCurrent('');
      setNext('');
      await client.invalidateQueries({ queryKey: SESSIONS_KEY });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await apiFetch(`/me/sessions/${id}`, { method: 'DELETE' });
    await client.invalidateQueries({ queryKey: SESSIONS_KEY });
  };

  return (
    <section>
      <h1>{t('security.title')}</h1>
      <form onSubmit={change} style={{ maxWidth: 420 }}>
        <h3>{t('security.password')}</h3>
        <Field label={t('security.current')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="password-current" />
        <Field label={t('security.new')} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} value={next} onChange={(e) => setNext(e.target.value)} data-testid="password-new" />
        {error && <p className="alert error" role="alert">{error}</p>}
        {updated && <p className="alert ok" data-testid="password-updated">{t('security.updated')}</p>}
        <PrimaryButton className="btn-small" style={{ marginTop: 14 }} type="submit" loading={busy} data-testid="password-submit">{t('security.update')}</PrimaryButton>
      </form>
      <h3 style={{ marginTop: 30 }}>{t('security.sessions')}</h3>
      <table className="table">
        <tbody>
          {(sessions.data ?? []).map((s) => (
            <tr key={s.id} data-testid={`session-${s.id}`}>
              <td>{s.userAgent ?? '—'} {s.current && <span className="tag">{t('security.thisDevice')}</span>}</td>
              <td className="muted-a">{s.ip}</td>
              <td className="muted-a">{t('security.lastSeen', { date: formatRelative(s.lastSeenAt, language) ?? '' })}</td>
              <td style={{ textAlign: 'right' }}>
                {!s.current && <GhostButton data-testid={`session-revoke-${s.id}`} onClick={() => void revoke(s.id)}>{t('security.revoke')}</GhostButton>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add settings screens for organization, members, repositories and account

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: End-to-end journeys

**Files:**
- Modify: `apps/web/playwright.config.ts`, `apps/web/e2e/workspace.spec.ts`
- Create: `apps/web/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: the running API (dev routes on, database `rdi_e2e`, Redis db 2, rate limits off) and the web dev server.

- [ ] **Step 1: Playwright starts both servers**

`apps/web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5177' },
  workers: 1,
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../api',
      url: 'http://localhost:4040/health',
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        RDI_DEV_ROUTES: 'true',
        DATABASE_URL: 'postgres://rdi:rdi@localhost:5548/rdi_e2e',
        DB_ENSURE: 'true',
        REDIS_URL: 'redis://localhost:6391/2',
        RATE_LIMITS: 'off',
      },
    },
    { command: 'npm run dev', url: 'http://localhost:5177', reuseExistingServer: false, timeout: 60_000 },
  ],
});
```

- [ ] **Step 2: Workspace spec signs in with a demo session**

In `apps/web/e2e/workspace.spec.ts` replace the `test.beforeEach` block with:
```ts
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  expect(demo.ok()).toBe(true);
  await page.goto('/');
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/explore$/);
  await page.getByTestId('scene-select').selectOption('checkout-en');
  await expect(page.getByTestId('node-worker')).toBeVisible();
});
```

- [ ] **Step 3: Shell journeys**

`apps/web/e2e/shell.spec.ts`:
```ts
import { expect, test, type APIRequestContext } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

const lastLink = async (request: APIRequestContext, email: string, kind: 'verify' | 'reset' | 'invite') => {
  const res = await request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  const { messages } = (await res.json()) as { messages: { kind: string; link: string }[] };
  const link = messages.filter((m) => m.kind === kind).at(-1)?.link;
  if (!link) throw new Error(`no ${kind} mail for ${email}`);
  return new URL(link).pathname + new URL(link).search;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
});

test('sign up, verify, sign in, create an organization and land in the workspace', async ({ page }) => {
  const email = unique('ana');
  await page.goto('/signup');
  await expect(page.getByTestId('animated-logo').first()).toBeVisible();
  await page.getByTestId('signup-name').fill('Ana');
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill(PASSWORD);
  await page.getByTestId('signup-submit').click();
  await expect(page).toHaveURL(/\/check-email/);
  await page.goto(await lastLink(page.request, email, 'verify'));
  await expect(page.getByTestId('verify-status')).toContainText('Email verified');
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByTestId('onboarding-name').fill('Acme');
  await page.getByTestId('onboarding-submit').click();
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/explore$/);
  await expect(page.getByTestId('node-worker')).toBeVisible();
});

test('wrong password shows the generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(unique('nobody'));
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('form-error')).toHaveText('Email or password is incorrect.');
});

test('invitations can be sent and revoked from members', async ({ page }) => {
  await page.request.post('/api/dev/demo-session', { data: {} });
  await page.goto('/');
  await page.getByTestId('home-link').click();
  await page.getByTestId('nav-members').click();
  const invitee = unique('sofi');
  await page.getByTestId('invite-email').fill(invitee);
  await page.getByTestId('invite-submit').click();
  const row = page.locator('[data-testid^="invitation-"]', { hasText: invitee }).first();
  await expect(row).toBeVisible();
  expect(await lastLink(page.request, invitee, 'invite')).toMatch(/^\/invite\//);
  await row.locator('[data-testid^="invitation-revoke-"]').click();
  await expect(page.locator('[data-testid^="invitation-"]', { hasText: invitee })).toHaveCount(0);
});

test('preferences change the UI language and the workspace theme', async ({ page }) => {
  await page.request.post('/api/dev/demo-session', { data: {} });
  await page.goto('/');
  await page.getByTestId('home-link').click();
  await page.getByTestId('nav-preferences').click();
  await page.getByTestId('pref-ui-es').click();
  await expect(page.getByTestId('nav-preferences')).toHaveText('Preferencias');
  await page.getByTestId('pref-theme-paper').click();
  await page.reload();
  await expect(page.getByTestId('nav-preferences')).toHaveText('Preferencias');
  await page.getByTestId('nav-explore').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await expect(page.getByTestId('level-architecture')).toHaveText('Arquitectura');
});

test('repositories show indexing stages', async ({ page }) => {
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  const { orgs, csrfToken } = (await demo.json()) as { orgs: { id: string }[]; csrfToken: string };
  await page.request.post(`/api/dev/orgs/${orgs[0]!.id}/seed-repos`, { data: {}, headers: { 'x-csrf-token': csrfToken } });
  await page.goto(`/orgs/${orgs[0]!.id}/settings/repositories`);
  await expect(page.getByTestId('repo-acme/orders-api')).toBeVisible();
  await expect(page.getByTestId('stage-acme/orders-api-summarize')).toContainText('64%');
  await expect(page.getByTestId('stage-acme/ml-ranker-parse')).toHaveClass(/error/);
  await expect(page.getByTestId('connect-github')).toBeDisabled();
});

test('password change keeps this session and the new password works', async ({ page, browser }) => {
  const email = unique('pw');
  await page.request.post('/api/auth/signup', { data: { email, name: 'Pw', password: PASSWORD } });
  const verify = new URL(`http://x${await lastLink(page.request, email, 'verify')}`).searchParams.get('token');
  await page.request.post('/api/auth/verify', { data: { token: verify } });
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('onboarding-name').fill('Pw Org');
  await page.getByTestId('onboarding-submit').click();
  await page.getByTestId('home-link').click();
  await page.getByTestId('nav-security').click();
  await page.getByTestId('password-current').fill(PASSWORD);
  await page.getByTestId('password-new').fill('fresh passphrase 99');
  await page.getByTestId('password-submit').click();
  await expect(page.getByTestId('password-updated')).toBeVisible();
  const fresh = await browser.newContext({ baseURL: 'http://localhost:5177' });
  const login = await fresh.request.post('/api/auth/login', { data: { email, password: 'fresh passphrase 99' } });
  expect(login.ok()).toBe(true);
  await fresh.close();
});

test('signing out returns to the sign-in screen', async ({ page }) => {
  await page.request.post('/api/dev/demo-session', { data: {} });
  await page.goto('/');
  await page.getByTestId('home-link').click();
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 4: Run everything**

Stop any running `npm run dev` (Playwright starts its own servers), then run:
```bash
npm test && npm run typecheck
npm run test:integration -w @rdi/api
npm run e2e -w @rdi/web
```
Expected: unit tests PASS; typecheck clean; integration PASS; E2E: 10 workspace + 7 shell = `17 passed`.

- [ ] **Step 5: Visual check**

Run `RDI_DEV_ROUTES=true npm run dev`, open http://localhost:5177: the sign-in screen shows the Aurora background, animated logo and glass card; sign-up → mailbox link (`/api/dev/mailbox?to=…`) → verify → onboarding → workspace; the ⚙ link opens settings with the Aurora shell. Stop the servers.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(web): add end-to-end shell journeys and authenticate workspace tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| App-shell spec | Task |
|---|---|
| §0 Aurora visual language (palette, glass, logo, motion, reduced motion) | 11, 12, 13, 14 |
| §1 Accounts: sign-up, verification, argon2id, reset, sessions, rate limits, CSRF, generic errors | 1, 2, 3, 5, 6 |
| §2 Organizations, members, roles, invitations, last-owner guard, tenant isolation | 4, 8, 14 |
| §3 Repositories page and stage statuses (GitHub App flow is plan 3b) | 4, 8, 14 |
| §4 Preferences with org defaults | 7, 10, 13, 14 |
| §5 Organization settings | 8, 14 |
| §6 UI internationalization | 11 (+ plan 2 catalogs) |
| §7 Screens (sign in, sign up, verify, reset, invitation, settings, empty-state onboarding) | 12, 13, 14 |
| Data model | 1 |
| Testing (unit, integration, E2E) | every task + 15 |
| Out of scope: SSO, social login, billing, 2FA, GitHub App internals | — |
