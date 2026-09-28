# Plan 3b — Repositories, Indexing and the System Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect real repositories (GitHub App, or bundled demo repositories when GitHub is not configured), index them in a background worker — clone → parse (tree-sitter, TS/JS/Python) → detect (endpoints, outbound HTTP, queues, tables, config, externals) → summarize (heuristic) → write the System Graph to Neo4j → link repos (cross-repo HTTP) — show live stage progress on the Repositories screen, and open an automatically generated **System map** scene (with an inferred walkthrough) in the workspace.

**Architecture:** Three new packages — `@rdi/indexer` (pure analysis: walk, parse, detect, repo graph, linker, system-map scene), `@rdi/graph` (Neo4j store scoped by `org_id`, relinking), `@rdi/providers` (GitHub App client, webhook/state signatures, demo sources, clone/copy) — plus `apps/worker` (BullMQ consumer running the pipeline and updating `repos.stages` in Postgres). `apps/api` enqueues jobs, handles the GitHub install callback and webhook, lists available repos and serves the system map; `apps/web` gets a live Repositories screen and loads the system map into the workspace.

**Tech Stack:** web-tree-sitter **0.25.10** + tree-sitter-wasms **0.1.13** (pinned: other versions fail to load these grammars — verified by spike), BullMQ 5/6, neo4j-driver 6, node:crypto (RS256 JWT, HMAC), git CLI.

**Spec:** `docs/superpowers/specs/2026-09-28-repository-designer-ide-design.md` §3 (indexing pipeline & System Graph) and `2026-09-28-app-shell-design.md` §3 (repositories). Summaries are heuristic here; LLM summaries and embeddings arrive with the agent (plan 4).

## Global Constraints

- Every Neo4j node carries `org_id`; repo-owned nodes carry `repo_id`; shared nodes (queues, tables, externals) have no `repo_id` and are removed when orphaned. All graph access goes through `@rdi/graph` (no free Cypher elsewhere); labels and relationship types come from whitelists.
- Node ids are globally unique strings: `repo:<repoId>`, `svc:<repoId>`, `file:<repoId>:<path>`, `ep:<repoId>:<METHOD> <path>`, `cfg:<repoId>:<NAME>`, `queue:<orgId>:<name>`, `table:<orgId>:<name>`, `ext:<orgId>:<host>`.
- Stage names and statuses are exactly those of plan 3a: `clone | parse | detect | summarize | link` × `pending | running | done | error`; repo status `pending | indexing | ready | error`.
- Limits: 500k LOC per repo (indexing continues with what fits and reports truncation), 512 KB per file, 10 repos per org (`409 repo_limit`).
- GitHub is optional: without `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`/`GITHUB_APP_SLUG`/`GITHUB_WEBHOOK_SECRET`/`GITHUB_STATE_SECRET` the API reports it as not configured and offers the demo repositories (`acme-demo/shop-web`, `acme-demo/shop-api`, `acme-demo/shop-worker`, bundled under `fixtures/repos`) outside production.
- Webhook requests are verified with HMAC-SHA256 (`X-Hub-Signature-256`) using a constant-time comparison; install-callback `state` is an HMAC-signed, 15-minute token bound to the org.
- Clone tokens never reach logs or the database.
- UI strings through `t()` (en/es/pt). Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Re-indexing a repository** must replace its nodes, not duplicate them, while shared queue/table nodes referenced by other repos survive. Pinned in Task 7.
2. **Deleting a repository** removes its graph data, orphaned shared nodes and stale cross-repo links. Pinned in Tasks 7 and 10.
3. **A webhook with a missing, malformed or wrong signature** is rejected (401) without enqueuing anything. Pinned in Tasks 8 and 10.
4. **A pipeline failure in any stage** leaves the repo in `error` with that stage marked and the message visible, and does not leave half-written graph data. Pinned in Task 9.
5. **Org isolation in the graph** — another org never sees nodes, links or system-map pieces of this org, even for shared-name queues/tables. Pinned in Task 7.

---

## File Structure

```
fixtures/repos/shop-web/{package.json, src/api.ts, src/Checkout.tsx}
fixtures/repos/shop-api/{package.json, src/server.ts, src/orders.ts, src/db.ts}
fixtures/repos/shop-worker/{pyproject.toml, worker.py}
packages/indexer/  package.json, tsconfig.json, vitest.config.ts
  src/{index,walk,parse,detect,summarize,repoGraph,link,systemMap}.ts
  test/{walk,parse,detect,repoGraph,link,systemMap}.test.ts, test/fixtures.ts
packages/graph/    package.json, tsconfig.json, vitest.config.ts, vitest.integration.config.ts
  src/{index,store,relink}.ts
  test/store.integration.test.ts
packages/providers/ package.json, tsconfig.json, vitest.config.ts
  src/{index,github,signatures,demo,materialize}.ts
  test/{github,signatures,demo,materialize}.test.ts
apps/worker/       package.json, tsconfig.json, vitest.integration.config.ts
  src/{config,repoStore,sources,pipeline,server}.ts
  test/setup/globalSetup.ts, test/pipeline.integration.test.ts
apps/api/
  src/config.ts (+ github, demo), src/http/deps.ts (+ graph, indexQueue, github)
  src/queue/indexQueue.ts, src/db/queries/{github,repos}.ts, src/routes/{repos,github}.ts, src/app.ts, src/server.ts
  test/repos.integration.test.ts, test/github.integration.test.ts
apps/web/
  src/i18n/shellMessages.ts (+ keys), src/shell/settings/RepositoriesPage.tsx, src/shell/pages/ExplorePage.tsx, src/workspace/Workspace.tsx
  test/shell/repositories.test.tsx, test/shell/explore.test.tsx, e2e/indexing.spec.ts, playwright.config.ts (+ worker)
```

---

### Task 1: Demo fixture repositories and repository walking

**Files:**
- Create: the eight fixture files above; `packages/indexer/{package.json,tsconfig.json,vitest.config.ts}`, `packages/indexer/src/{index,walk}.ts`
- Test: `packages/indexer/test/fixtures.ts`, `packages/indexer/test/walk.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type SourceLanguage = 'typescript' | 'tsx' | 'javascript' | 'python'
  LANGUAGE_BY_EXTENSION: Record<string, SourceLanguage>; MAX_FILE_BYTES = 512_000; MAX_TOTAL_LOC = 500_000
  type SourceFile = { path: string; language: SourceLanguage; loc: number; content: string }
  type WalkResult = { files: SourceFile[]; totalLoc: number; truncated: boolean; languages: string[]; packageName: string | null }
  walkRepository(root: string, limits?: { maxLoc: number; maxFileBytes: number }): Promise<WalkResult>
  // test/fixtures.ts
  FIXTURES_DIR: string; fixture(name: 'shop-web' | 'shop-api' | 'shop-worker'): string
  ```

- [ ] **Step 1: Fixture repositories**

`fixtures/repos/shop-web/package.json`:
```json
{ "name": "shop-web", "private": true, "dependencies": { "react": "^19.0.0" } }
```

`fixtures/repos/shop-web/src/api.ts`:
```ts
export type Item = { sku: string; qty: number };

export const createOrder = (items: Item[]) =>
  fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });

export const getOrder = (id: string) => fetch(`/api/orders/${id}`);
```

`fixtures/repos/shop-web/src/Checkout.tsx`:
```tsx
import { createOrder, type Item } from './api';

export function Checkout({ items }: { items: Item[] }) {
  return <button onClick={() => createOrder(items)}>Pay</button>;
}
```

`fixtures/repos/shop-api/package.json`:
```json
{ "name": "shop-api", "private": true, "dependencies": { "express": "^5.0.0", "bullmq": "^5.0.0", "pg": "^8.0.0" } }
```

`fixtures/repos/shop-api/src/server.ts`:
```ts
import express from 'express';
import { createOrderHandler, getOrderHandler } from './orders';

const app = express();
app.use(express.json());
app.post('/api/orders', createOrderHandler);
app.get('/api/orders/:id', getOrderHandler);
app.listen(Number(process.env.PORT ?? 3000));
```

`fixtures/repos/shop-api/src/orders.ts`:
```ts
import { Queue } from 'bullmq';
import { db } from './db';

const ordersQueue = new Queue('orders');

export async function createOrderHandler(req, res) {
  const { rows } = await db.query('insert into orders (items, status) values ($1, $2) returning id', [JSON.stringify(req.body.items), 'pending']);
  await ordersQueue.add('process-order', { orderId: rows[0].id });
  res.status(202).json({ orderId: rows[0].id });
}

export async function getOrderHandler(req, res) {
  const { rows } = await db.query('select id, status from orders where id = $1', [req.params.id]);
  res.json(rows[0] ?? null);
}
```

`fixtures/repos/shop-api/src/db.ts`:
```ts
import pg from 'pg';

export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
```

`fixtures/repos/shop-worker/pyproject.toml`:
```toml
[project]
name = "shop-worker"
version = "0.1.0"
dependencies = ["bullmq", "requests", "psycopg"]
```

`fixtures/repos/shop-worker/worker.py`:
```python
import os

import psycopg
import requests
from bullmq import Worker


def charge(order_id):
    response = requests.post("https://api.stripe.com/v1/charges", data={"order": order_id}, headers={"Authorization": os.environ["STRIPE_KEY"]})
    response.raise_for_status()


async def process(job, token):
    order_id = job.data["orderId"]
    charge(order_id)
    with psycopg.connect(os.getenv("DATABASE_URL")) as conn:
        conn.execute("update orders set status = 'paid' where id = %s", (order_id,))


worker = Worker("orders", process)
```

- [ ] **Step 2: Package setup**

`packages/indexer/package.json`:
```json
{
  "name": "@rdi/indexer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "@rdi/scene": "*" }
}
```
`packages/indexer/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
```
`packages/indexer/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', testTimeout: 30_000 } });
```
Run:
```bash
npm install
npm install -w @rdi/indexer web-tree-sitter@0.25.10 tree-sitter-wasms@0.1.13 --save-exact
npm install -w @rdi/indexer -D vitest @types/node
grep -E '"(web-tree-sitter|tree-sitter-wasms)"' packages/indexer/package.json
```
Expected: both pinned exactly (`"0.25.10"`, `"0.1.13"`).

- [ ] **Step 3: Write the failing tests**

`packages/indexer/test/fixtures.ts`:
```ts
import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
export const fixture = (name: 'shop-web' | 'shop-api' | 'shop-worker') => `${FIXTURES_DIR}/${name}`;
```

`packages/indexer/test/walk.test.ts`:
```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkRepository } from '../src/index';
import { fixture } from './fixtures';

describe('walkRepository', () => {
  it('lists source files deterministically with language, loc and package name', async () => {
    const result = await walkRepository(fixture('shop-api'));
    expect(result.files.map((f) => f.path)).toEqual(['src/db.ts', 'src/orders.ts', 'src/server.ts']);
    expect(result.files[0]).toMatchObject({ language: 'typescript', loc: 3 });
    expect(result.packageName).toBe('shop-api');
    expect(result.languages).toEqual(['TypeScript']);
    expect(result.truncated).toBe(false);
  });

  it('reads the python project name and tsx files', async () => {
    expect((await walkRepository(fixture('shop-worker'))).packageName).toBe('shop-worker');
    const web = await walkRepository(fixture('shop-web'));
    expect(web.files.map((f) => [f.path, f.language])).toEqual([['src/Checkout.tsx', 'tsx'], ['src/api.ts', 'typescript']]);
  });

  it('skips ignored directories, unknown extensions and huge files, and truncates by LOC', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rdi-walk-'));
    await mkdir(join(root, 'node_modules/x'), { recursive: true });
    await writeFile(join(root, 'node_modules/x/index.js'), 'export const a = 1;\n');
    await writeFile(join(root, 'notes.md'), '# hi\n');
    await writeFile(join(root, 'a.py'), 'a = 1\nb = 2\n');
    await writeFile(join(root, 'b.js'), 'const x = 1;\n'.repeat(10));
    await writeFile(join(root, 'big.js'), 'x'.repeat(600_000));
    const all = await walkRepository(root);
    expect(all.files.map((f) => f.path)).toEqual(['a.py', 'b.js']);
    const limited = await walkRepository(root, { maxLoc: 5, maxFileBytes: 512_000 });
    expect(limited.files.map((f) => f.path)).toEqual(['a.py']);
    expect(limited.truncated).toBe(true);
  });
});
```

Run: `npm test -w @rdi/indexer`
Expected: FAIL — `../src/index` not found.

- [ ] **Step 4: Implement**

`packages/indexer/src/walk.ts`:
```ts
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

export type SourceLanguage = 'typescript' | 'tsx' | 'javascript' | 'python';
export type SourceFile = { path: string; language: SourceLanguage; loc: number; content: string };
export type WalkResult = { files: SourceFile[]; totalLoc: number; truncated: boolean; languages: string[]; packageName: string | null };

export const LANGUAGE_BY_EXTENSION: Record<string, SourceLanguage> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.py': 'python',
};
export const MAX_FILE_BYTES = 512_000;
export const MAX_TOTAL_LOC = 500_000;

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', 'vendor', '__pycache__', '.venv', 'venv']);
const DISPLAY: Record<SourceLanguage, string> = { typescript: 'TypeScript', tsx: 'TypeScript', javascript: 'JavaScript', python: 'Python' };
const PYPROJECT_NAME = /^\s*name\s*=\s*["']([^"']+)["']/m;

const listFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return IGNORED_DIRS.has(entry.name) ? [] : listFiles(full);
      return entry.isFile() ? [full] : [];
    }),
  );
  return nested.flat();
};

const readPackageName = async (root: string): Promise<string | null> => {
  const json = await readFile(join(root, 'package.json'), 'utf8').catch(() => null);
  if (json) {
    try {
      const name = (JSON.parse(json) as { name?: unknown }).name;
      if (typeof name === 'string' && name) return name;
    } catch {
      // fall through to pyproject
    }
  }
  const toml = await readFile(join(root, 'pyproject.toml'), 'utf8').catch(() => null);
  return toml ? PYPROJECT_NAME.exec(toml)?.[1] ?? null : null;
};

const countLoc = (content: string) => content.split('\n').filter((line) => line.trim() !== '').length;

export const walkRepository = async (root: string, limits = { maxLoc: MAX_TOTAL_LOC, maxFileBytes: MAX_FILE_BYTES }): Promise<WalkResult> => {
  const paths = (await listFiles(root)).map((full) => relative(root, full).split(sep).join('/')).sort();
  const files: SourceFile[] = [];
  const locByLanguage = new Map<string, number>();
  let totalLoc = 0;
  let truncated = false;
  for (const path of paths) {
    const language = LANGUAGE_BY_EXTENSION[extname(path)];
    if (!language) continue;
    const full = join(root, path);
    if ((await stat(full)).size > limits.maxFileBytes) continue;
    const content = await readFile(full, 'utf8');
    const loc = countLoc(content);
    if (totalLoc + loc > limits.maxLoc) {
      truncated = true;
      continue;
    }
    totalLoc += loc;
    files.push({ path, language, loc, content });
    locByLanguage.set(DISPLAY[language], (locByLanguage.get(DISPLAY[language]) ?? 0) + loc);
  }
  const languages = [...locByLanguage.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return { files, totalLoc, truncated, languages, packageName: await readPackageName(root) };
};
```

`packages/indexer/src/index.ts`:
```ts
export * from './walk';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @rdi/indexer && npm run typecheck -w @rdi/indexer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(indexer): add demo fixture repositories and repository walking

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Tree-sitter parsing into file facts

**Files:**
- Create: `packages/indexer/src/parse.ts`
- Modify: `packages/indexer/src/index.ts`
- Test: `packages/indexer/test/parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type CallFact = { callee: string; line: number; args: (string | null)[]; options: Record<string, string>; isNew: boolean; decorator: boolean }
  type SymbolFact = { name: string; kind: 'function' | 'class'; line: number }
  type FileFacts = { path: string; language: SourceLanguage; loc: number; imports: string[]; symbols: SymbolFact[]; calls: CallFact[]; envKeys: string[] }
  parseFile(file: SourceFile): Promise<FileFacts>
  parseRepository(files: SourceFile[]): Promise<FileFacts[]>
  literalValue(text: string, type: string): string | null   // string/template literal → value (template substitutions become ${})
  ```

- [ ] **Step 1: Write the failing test**

`packages/indexer/test/parse.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { literalValue, parseFile, parseRepository, walkRepository, type FileFacts } from '../src/index';
import { fixture } from './fixtures';

const facts = async (repo: 'shop-web' | 'shop-api' | 'shop-worker') => parseRepository((await walkRepository(fixture(repo))).files);
const byPath = (all: FileFacts[], path: string) => all.find((f) => f.path === path)!;
const call = (f: FileFacts, callee: string) => f.calls.filter((c) => c.callee === callee);

describe('literalValue', () => {
  it('unquotes strings and normalizes template substitutions', () => {
    expect(literalValue("'x'", 'string')).toBe('x');
    expect(literalValue('"x y"', 'string')).toBe('x y');
    expect(literalValue('`/api/orders/${id}`', 'template_string')).toBe('/api/orders/${}');
    expect(literalValue('f"hi {x}"', 'string')).toBe('hi {x}');
    expect(literalValue('abc', 'identifier')).toBeNull();
  });
});

describe('parseFile (TypeScript)', () => {
  it('extracts imports, symbols, calls, constructors and env keys', async () => {
    const api = await facts('shop-api');
    const orders = byPath(api, 'src/orders.ts');
    expect(orders.imports).toEqual(['bullmq', './db']);
    expect(orders.symbols.map((s) => s.name)).toEqual(['createOrderHandler', 'getOrderHandler']);
    expect(call(orders, 'Queue')[0]).toMatchObject({ isNew: true, args: ['orders'] });
    expect(call(orders, 'db.query').map((c) => c.args[0])).toEqual([
      'insert into orders (items, status) values ($1, $2) returning id',
      'select id, status from orders where id = $1',
    ]);
    expect(call(orders, 'ordersQueue.add')[0]!.args[0]).toBe('process-order');
    const server = byPath(api, 'src/server.ts');
    expect(call(server, 'app.post')[0]).toMatchObject({ args: ['/api/orders', null], line: 6 });
    expect(server.envKeys).toEqual(['PORT']);
    expect(byPath(api, 'src/db.ts').envKeys).toEqual(['DATABASE_URL']);
  });

  it('reads object-literal options and template strings from fetch calls, and parses TSX', async () => {
    const web = await facts('shop-web');
    const api = byPath(web, 'src/api.ts');
    const fetches = call(api, 'fetch');
    expect(fetches.map((c) => [c.args[0], c.options.method ?? null])).toEqual([['/api/orders', 'POST'], ['/api/orders/${}', null]]);
    expect(api.symbols.map((s) => s.name)).toEqual(['createOrder', 'getOrder']);
    expect(byPath(web, 'src/Checkout.tsx').imports).toEqual(['./api']);
  });
});

describe('parseFile (Python)', () => {
  it('extracts imports, functions, calls, keyword-free args and env keys', async () => {
    const worker = byPath(await facts('shop-worker'), 'worker.py');
    expect(worker.imports).toEqual(['os', 'psycopg', 'requests', 'bullmq']);
    expect(worker.symbols.map((s) => [s.name, s.kind])).toEqual([['charge', 'function'], ['process', 'function']]);
    expect(call(worker, 'requests.post')[0]!.args[0]).toBe('https://api.stripe.com/v1/charges');
    expect(call(worker, 'Worker')[0]).toMatchObject({ isNew: false, args: ['orders', null] });
    expect(call(worker, 'conn.execute')[0]!.args[0]).toBe("update orders set status = 'paid' where id = %s");
    expect(worker.envKeys).toEqual(['STRIPE_KEY', 'DATABASE_URL']);
  });

  it('marks decorator calls (FastAPI style)', async () => {
    const f = await parseFile({ path: 'main.py', language: 'python', loc: 3, content: '@app.get("/items/{item_id}")\ndef read(item_id):\n    return item_id\n' });
    expect(f.calls[0]).toMatchObject({ callee: 'app.get', decorator: true, args: ['/items/{item_id}'] });
  });
});
```

Run: `npm test -w @rdi/indexer -- parse`
Expected: FAIL — `parseFile` not exported.

- [ ] **Step 2: Implement**

`packages/indexer/src/parse.ts`:
```ts
import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';
import type { SourceFile, SourceLanguage } from './walk';

export type CallFact = { callee: string; line: number; args: (string | null)[]; options: Record<string, string>; isNew: boolean; decorator: boolean };
export type SymbolFact = { name: string; kind: 'function' | 'class'; line: number };
export type FileFacts = { path: string; language: SourceLanguage; loc: number; imports: string[]; symbols: SymbolFact[]; calls: CallFact[]; envKeys: string[] };

const require = createRequire(import.meta.url);
const GRAMMAR: Record<SourceLanguage, string> = {
  typescript: 'tree-sitter-typescript.wasm', tsx: 'tree-sitter-tsx.wasm', javascript: 'tree-sitter-javascript.wasm', python: 'tree-sitter-python.wasm',
};
const STRING_TYPES = new Set(['string', 'template_string']);
const QUOTED = /^[a-zA-Z]*("""|'''|"|'|`)([\s\S]*)\1$/;
const TEMPLATE_SUBSTITUTION = /\$\{[^}]*\}/g;
const PROCESS_ENV = /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/;
const PY_ENV_CALLEES = new Set(['os.getenv', 'os.environ.get']);
const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function']);

let ready: Promise<void> | null = null;
const parsers = new Map<SourceLanguage, Promise<Parser>>();

const parserFor = (language: SourceLanguage): Promise<Parser> => {
  const cached = parsers.get(language);
  if (cached) return cached;
  const created = (ready ??= Parser.init()).then(async () => {
    const parser = new Parser();
    parser.setLanguage(await Language.load(require.resolve(`tree-sitter-wasms/out/${GRAMMAR[language]}`)));
    return parser;
  });
  parsers.set(language, created);
  return created;
};

export const literalValue = (text: string, type: string): string | null => {
  if (!STRING_TYPES.has(type)) return null;
  const normalized = type === 'template_string' ? text.replace(TEMPLATE_SUBSTITUTION, '${}') : text;
  return QUOTED.exec(normalized)?.[2] ?? null;
};

const valueOf = (node: Node | null | undefined): string | null => (node ? literalValue(node.text, node.type) : null);
const children = (node: Node | null | undefined): Node[] => (node ? node.namedChildren.filter((c): c is Node => c !== null) : []);
const lineOf = (node: Node) => node.startPosition.row + 1;
const compact = (text: string) => text.replace(/\s+/g, '');

const walk = (node: Node, visit: (n: Node) => void) => {
  visit(node);
  for (const child of children(node)) walk(child, visit);
};

const keyText = (node: Node | null): string | null => {
  if (!node) return null;
  return valueOf(node) ?? node.text;
};

const argumentsOf = (argsNode: Node | null) => {
  const args: (string | null)[] = [];
  const options: Record<string, string> = {};
  for (const arg of children(argsNode)) {
    if (arg.type === 'object') {
      args.push(null);
      for (const pair of children(arg).filter((p) => p.type === 'pair')) {
        const key = keyText(pair.childForFieldName('key'));
        const value = valueOf(pair.childForFieldName('value'));
        if (key && value !== null) options[key] = value;
      }
      continue;
    }
    if (arg.type === 'keyword_argument') {
      const value = valueOf(arg.childForFieldName('value'));
      const name = arg.childForFieldName('name')?.text;
      if (name && value !== null) options[name] = value;
      continue;
    }
    args.push(valueOf(arg));
  }
  return { args, options };
};

const collectScript = (root: Node, facts: FileFacts) => {
  walk(root, (node) => {
    switch (node.type) {
      case 'import_statement': {
        const source = valueOf(node.childForFieldName('source'));
        if (source) facts.imports.push(source);
        break;
      }
      case 'call_expression': {
        const fn = node.childForFieldName('function');
        if (!fn) break;
        const { args, options } = argumentsOf(node.childForFieldName('arguments'));
        const callee = compact(fn.text);
        if (callee === 'require' && args[0]) facts.imports.push(args[0]);
        facts.calls.push({ callee, line: lineOf(node), args, options, isNew: false, decorator: false });
        break;
      }
      case 'new_expression': {
        const ctor = node.childForFieldName('constructor');
        if (!ctor) break;
        const { args, options } = argumentsOf(node.childForFieldName('arguments'));
        facts.calls.push({ callee: compact(ctor.text), line: lineOf(node), args, options, isNew: true, decorator: false });
        break;
      }
      case 'member_expression': {
        const key = PROCESS_ENV.exec(compact(node.text))?.[1];
        if (key && !facts.envKeys.includes(key)) facts.envKeys.push(key);
        break;
      }
      case 'function_declaration':
      case 'class_declaration': {
        const name = node.childForFieldName('name')?.text;
        if (name) facts.symbols.push({ name, kind: node.type === 'class_declaration' ? 'class' : 'function', line: lineOf(node) });
        break;
      }
      case 'variable_declarator': {
        const value = node.childForFieldName('value');
        const name = node.childForFieldName('name')?.text;
        if (name && value && FUNCTION_VALUES.has(value.type)) facts.symbols.push({ name, kind: 'function', line: lineOf(node) });
        break;
      }
    }
  });
};

const collectPython = (root: Node, facts: FileFacts) => {
  const addEnv = (key: string | null) => {
    if (key && !facts.envKeys.includes(key)) facts.envKeys.push(key);
  };
  walk(root, (node) => {
    switch (node.type) {
      case 'import_statement':
        for (const name of children(node).filter((c) => c.type === 'dotted_name' || c.type === 'aliased_import')) {
          facts.imports.push((name.type === 'aliased_import' ? name.childForFieldName('name')?.text : name.text) ?? name.text);
        }
        break;
      case 'import_from_statement': {
        const module = node.childForFieldName('module_name')?.text;
        if (module) facts.imports.push(module);
        break;
      }
      case 'call': {
        const fn = node.childForFieldName('function');
        if (!fn) break;
        const { args, options } = argumentsOf(node.childForFieldName('arguments'));
        const callee = compact(fn.text);
        if (PY_ENV_CALLEES.has(callee)) addEnv(args[0] ?? null);
        facts.calls.push({ callee, line: lineOf(node), args, options, isNew: false, decorator: node.parent?.type === 'decorator' });
        break;
      }
      case 'subscript': {
        if (compact(node.childForFieldName('value')?.text ?? '') === 'os.environ') addEnv(valueOf(node.childForFieldName('subscript')));
        break;
      }
      case 'function_definition':
      case 'class_definition': {
        const name = node.childForFieldName('name')?.text;
        if (name) facts.symbols.push({ name, kind: node.type === 'class_definition' ? 'class' : 'function', line: lineOf(node) });
        break;
      }
    }
  });
};

export const parseFile = async (file: SourceFile): Promise<FileFacts> => {
  const facts: FileFacts = { path: file.path, language: file.language, loc: file.loc, imports: [], symbols: [], calls: [], envKeys: [] };
  const tree = (await parserFor(file.language)).parse(file.content);
  if (!tree) return facts;
  try {
    if (file.language === 'python') collectPython(tree.rootNode, facts);
    else collectScript(tree.rootNode, facts);
  } finally {
    tree.delete();
  }
  return facts;
};

export const parseRepository = async (files: SourceFile[]): Promise<FileFacts[]> => {
  const result: FileFacts[] = [];
  for (const file of files) result.push(await parseFile(file));
  return result;
};
```

Append to `packages/indexer/src/index.ts`:
```ts
export * from './parse';
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/indexer && npm run typecheck -w @rdi/indexer`
Expected: PASS. If `web-tree-sitter`'s type is named differently (e.g. `SyntaxNode`), import the exported node type under the name `Node` and ledger a ruling.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(indexer): parse TypeScript, JavaScript and Python into file facts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Detectors — endpoints, outbound HTTP, queues, tables, config

**Files:**
- Create: `packages/indexer/src/detect.ts`
- Modify: `packages/indexer/src/index.ts`
- Test: `packages/indexer/test/detect.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type EndpointFact = { method: string; path: string; file: string; line: number }
  type OutboundFact = { method: string; url: string; file: string; line: number }
  type QueueFact = { name: string; role: 'producer' | 'consumer'; file: string; line: number }
  type TableFact = { name: string; access: 'read' | 'write'; file: string; line: number }
  type ConfigFact = { name: string; file: string }
  type Detections = { endpoints: EndpointFact[]; outbound: OutboundFact[]; queues: QueueFact[]; tables: TableFact[]; config: ConfigFact[] }
  detect(files: FileFacts[]): Detections
  describeDetections(d: Detections): string   // "2 endpoints · 1 queues · 1 tables"
  ```

- [ ] **Step 1: Write the failing test**

`packages/indexer/test/detect.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { describeDetections, detect, parseRepository, walkRepository, type FileFacts } from '../src/index';
import { fixture } from './fixtures';

const detectRepo = async (repo: 'shop-web' | 'shop-api' | 'shop-worker') => detect(await parseRepository((await walkRepository(fixture(repo))).files));
const facts = (calls: Partial<FileFacts['calls'][number]>[]): FileFacts[] => [
  { path: 'x.ts', language: 'typescript', loc: 1, imports: [], symbols: [], envKeys: [], calls: calls.map((c) => ({ callee: '', line: 1, args: [], options: {}, isNew: false, decorator: false, ...c })) },
];

describe('detect', () => {
  it('finds express endpoints, the producer queue, table access and config in shop-api', async () => {
    const d = await detectRepo('shop-api');
    expect(d.endpoints.map((e) => `${e.method} ${e.path} @${e.file}`)).toEqual(['POST /api/orders @src/server.ts', 'GET /api/orders/:id @src/server.ts']);
    expect(d.queues).toEqual([{ name: 'orders', role: 'producer', file: 'src/orders.ts', line: 4 }]);
    expect(d.tables.map((t) => `${t.access}:${t.name}`)).toEqual(['write:orders', 'read:orders']);
    expect(d.config.map((c) => `${c.name}@${c.file}`)).toEqual(['DATABASE_URL@src/db.ts', 'PORT@src/server.ts']);
    expect(d.outbound).toEqual([]);
    expect(describeDetections(d)).toBe('2 endpoints · 1 queues · 1 tables');
  });

  it('finds outbound calls from the web app', async () => {
    const d = await detectRepo('shop-web');
    expect(d.outbound.map((o) => `${o.method} ${o.url}`)).toEqual(['POST /api/orders', 'GET /api/orders/${}']);
    expect(d.endpoints).toEqual([]);
  });

  it('finds the consumer, external call, table write and config in the python worker', async () => {
    const d = await detectRepo('shop-worker');
    expect(d.queues).toEqual([{ name: 'orders', role: 'consumer', file: 'worker.py', line: 20 }]);
    expect(d.outbound.map((o) => `${o.method} ${o.url}`)).toEqual(['POST https://api.stripe.com/v1/charges']);
    expect(d.tables.map((t) => `${t.access}:${t.name}`)).toEqual(['write:orders']);
    expect(d.config.map((c) => c.name)).toEqual(['STRIPE_KEY', 'DATABASE_URL']);
  });

  it('does not confuse http clients with routes, nor prose with SQL', () => {
    const d = detect(facts([
      { callee: 'axios.get', args: ['/api/users'] },
      { callee: 'router.delete', args: ['/api/users/:id'] },
      { callee: 'toast.show', args: ['update your profile'] },
      { callee: 'app.get', args: ['/items/{id}'], decorator: true },
    ]));
    expect(d.outbound.map((o) => `${o.method} ${o.url}`)).toEqual(['GET /api/users']);
    expect(d.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['DELETE /api/users/:id', 'GET /items/{id}']);
    expect(d.tables).toEqual([]);
  });
});
```

Run: `npm test -w @rdi/indexer -- detect`
Expected: FAIL — `detect` not exported.

- [ ] **Step 2: Implement**

`packages/indexer/src/detect.ts`:
```ts
import type { FileFacts } from './parse';

export type EndpointFact = { method: string; path: string; file: string; line: number };
export type OutboundFact = { method: string; url: string; file: string; line: number };
export type QueueFact = { name: string; role: 'producer' | 'consumer'; file: string; line: number };
export type TableFact = { name: string; access: 'read' | 'write'; file: string; line: number };
export type ConfigFact = { name: string; file: string };
export type Detections = { endpoints: EndpointFact[]; outbound: OutboundFact[]; queues: QueueFact[]; tables: TableFact[]; config: ConfigFact[] };

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const OUTBOUND_RECEIVERS = new Set(['axios', 'http', 'https', 'client', 'api', 'requests', 'httpx', 'session', 'got', 'ky', 'superagent']);
const SQL_START = /^\s*(select|insert|update|delete|with)\b/i;
const WRITE_SQL = /\b(?:insert\s+into|update|delete\s+from)\s+["`]?([a-z_][a-z0-9_]*)/gi;
const READ_SQL = /\bfrom\s+["`]?([a-z_][a-z0-9_]*)/gi;
const QUEUE_CTOR = /(^|\.)Queue$/;
const WORKER_CTOR = /(^|\.)Worker$/;

const methodOf = (callee: string) => {
  const last = callee.split('.').pop()?.toLowerCase() ?? '';
  return HTTP_METHODS.has(last) ? last.toUpperCase() : null;
};
const receiverOf = (callee: string) => callee.split('.').slice(-2, -1)[0]?.toLowerCase() ?? '';

const sqlTables = (sql: string): { name: string; access: 'read' | 'write' }[] => {
  if (!SQL_START.test(sql)) return [];
  const writes = [...sql.matchAll(WRITE_SQL)].map((m) => m[1]!.toLowerCase());
  if (writes.length > 0) return writes.map((name) => ({ name, access: 'write' as const }));
  return [...sql.matchAll(READ_SQL)].map((m) => ({ name: m[1]!.toLowerCase(), access: 'read' as const }));
};

export const detect = (files: FileFacts[]): Detections => {
  const result: Detections = { endpoints: [], outbound: [], queues: [], tables: [], config: [] };
  const seenTables = new Set<string>();
  for (const file of files) {
    for (const call of file.calls) {
      const arg0 = call.args[0] ?? null;
      const method = methodOf(call.callee);
      if (call.callee === 'fetch' && arg0) {
        result.outbound.push({ method: (call.options.method ?? 'GET').toUpperCase(), url: arg0, file: file.path, line: call.line });
      } else if (method && arg0 && OUTBOUND_RECEIVERS.has(receiverOf(call.callee))) {
        result.outbound.push({ method, url: arg0, file: file.path, line: call.line });
      } else if (method && arg0?.startsWith('/') && call.callee.includes('.')) {
        result.endpoints.push({ method, path: arg0, file: file.path, line: call.line });
      }
      if (arg0 && call.isNew && QUEUE_CTOR.test(call.callee)) result.queues.push({ name: arg0, role: 'producer', file: file.path, line: call.line });
      if (arg0 && WORKER_CTOR.test(call.callee)) result.queues.push({ name: arg0, role: 'consumer', file: file.path, line: call.line });
      for (const arg of call.args) {
        if (!arg) continue;
        for (const table of sqlTables(arg)) {
          const key = `${file.path}|${table.access}|${table.name}`;
          if (seenTables.has(key)) continue;
          seenTables.add(key);
          result.tables.push({ ...table, file: file.path, line: call.line });
        }
      }
    }
    for (const name of file.envKeys) result.config.push({ name, file: file.path });
  }
  return result;
};

export const describeDetections = (d: Detections): string => {
  const queues = new Set(d.queues.map((q) => q.name)).size;
  const tables = new Set(d.tables.map((t) => t.name)).size;
  return `${d.endpoints.length} endpoints · ${queues} queues · ${tables} tables`;
};
```

Append to `packages/indexer/src/index.ts`:
```ts
export * from './detect';
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/indexer && npm run typecheck -w @rdi/indexer`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(indexer): detect endpoints, outbound calls, queues, tables and config

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Repository graph and heuristic summaries

**Files:**
- Create: `packages/indexer/src/summarize.ts`, `packages/indexer/src/repoGraph.ts`
- Modify: `packages/indexer/src/index.ts`
- Test: `packages/indexer/test/repoGraph.test.ts`

**Interfaces:**
- Produces:
  ```ts
  NODE_LABELS = ['Repo','Service','File','Endpoint','Queue','Table','External','ConfigKey'] as const; type NodeLabel
  EDGE_TYPES = ['CONTAINS','IMPORTS','HANDLES','PUBLISHES','CONSUMES','READS','WRITES','CALLS','USES_CONFIG','CALLS_HTTP'] as const; type EdgeType
  type GraphNode = { id: string; label: NodeLabel; name: string; summary: string; repoId: string | null; props: Record<string, string | number | string[]> }
  type GraphEdge = { from: string; to: string; type: EdgeType; props: Record<string, string | number> }
  type RepoGraph = { nodes: GraphNode[]; edges: GraphEdge[] }
  type Summarizer = { service(i: { name: string; languages: string[]; files: number; detections: Detections }): string; endpoint(method: string, path: string, file: string): string;
                      file(f: FileFacts): string; queue(name: string): string; table(name: string): string; external(host: string): string; config(name: string): string }
  heuristicSummarizer: Summarizer
  buildRepoGraph(input: { orgId: string; repoId: string; fullName: string; walk: WalkResult; facts: FileFacts[]; detections: Detections; summarizer?: Summarizer }): RepoGraph
  ids: repoNodeId(repoId), serviceId(repoId), fileId(repoId, path), endpointId(repoId, method, path), queueId(orgId, name), tableId(orgId, name), externalId(orgId, host), configId(repoId, name)
  // File nodes carry props.outbound = ["METHOD /relative/url", …] for the linker
  ```

- [ ] **Step 1: Write the failing test**

`packages/indexer/test/repoGraph.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildRepoGraph, detect, parseRepository, walkRepository, type RepoGraph } from '../src/index';
import { fixture } from './fixtures';

const ORG = 'org-1';
export const graphFor = async (repo: 'shop-web' | 'shop-api' | 'shop-worker', repoId = repo): Promise<RepoGraph> => {
  const walk = await walkRepository(fixture(repo));
  const facts = await parseRepository(walk.files);
  return buildRepoGraph({ orgId: ORG, repoId, fullName: `acme-demo/${repo}`, walk, facts, detections: detect(facts) });
};
const edge = (g: RepoGraph, type: string) => g.edges.filter((e) => e.type === type).map((e) => `${e.from} -> ${e.to}`);

describe('buildRepoGraph', () => {
  it('creates repo, service, file and endpoint nodes with stable ids and summaries', async () => {
    const g = await graphFor('shop-api');
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['repo:shop-api', 'svc:shop-api', 'file:shop-api:src/orders.ts', 'ep:shop-api:POST /api/orders', 'ep:shop-api:GET /api/orders/:id']));
    const svc = g.nodes.find((n) => n.id === 'svc:shop-api')!;
    expect(svc).toMatchObject({ label: 'Service', name: 'shop-api', repoId: 'shop-api', props: { repo: 'acme-demo/shop-api', languages: ['TypeScript'] } });
    expect(svc.summary).toMatch(/2 HTTP endpoints/);
    expect(g.nodes.find((n) => n.id === 'ep:shop-api:POST /api/orders')!.summary).toBe('Handles POST /api/orders in src/server.ts.');
  });

  it('links files, endpoints, queues, tables and config', async () => {
    const g = await graphFor('shop-api');
    expect(edge(g, 'CONTAINS')).toEqual(expect.arrayContaining(['repo:shop-api -> svc:shop-api', 'svc:shop-api -> file:shop-api:src/db.ts', 'svc:shop-api -> ep:shop-api:POST /api/orders']));
    expect(edge(g, 'HANDLES')).toEqual(['ep:shop-api:POST /api/orders -> file:shop-api:src/server.ts', 'ep:shop-api:GET /api/orders/:id -> file:shop-api:src/server.ts']);
    expect(edge(g, 'IMPORTS')).toEqual(['file:shop-api:src/orders.ts -> file:shop-api:src/db.ts', 'file:shop-api:src/server.ts -> file:shop-api:src/orders.ts']);
    expect(edge(g, 'PUBLISHES')).toEqual(['file:shop-api:src/orders.ts -> queue:org-1:orders']);
    expect(edge(g, 'WRITES')).toEqual(['file:shop-api:src/orders.ts -> table:org-1:orders']);
    expect(edge(g, 'READS')).toEqual(['file:shop-api:src/orders.ts -> table:org-1:orders']);
    expect(edge(g, 'USES_CONFIG')).toEqual(['file:shop-api:src/db.ts -> cfg:shop-api:DATABASE_URL', 'file:shop-api:src/server.ts -> cfg:shop-api:PORT']);
  });

  it('marks shared nodes without repo id and keeps relative outbound calls on files', async () => {
    const worker = await graphFor('shop-worker');
    expect(worker.nodes.find((n) => n.id === 'queue:org-1:orders')).toMatchObject({ label: 'Queue', repoId: null });
    expect(worker.nodes.find((n) => n.id === 'ext:org-1:api.stripe.com')).toMatchObject({ label: 'External', repoId: null });
    expect(edge(worker, 'CONSUMES')).toEqual(['file:shop-worker:worker.py -> queue:org-1:orders']);
    expect(edge(worker, 'CALLS')).toEqual(['file:shop-worker:worker.py -> ext:org-1:api.stripe.com']);
    const web = await graphFor('shop-web');
    expect(web.nodes.find((n) => n.id === 'file:shop-web:src/api.ts')!.props.outbound).toEqual(['POST /api/orders', 'GET /api/orders/${}']);
    expect(new Set(web.nodes.map((n) => n.id)).size).toBe(web.nodes.length);
  });
});
```

Run: `npm test -w @rdi/indexer -- repoGraph`
Expected: FAIL — `buildRepoGraph` not exported.

- [ ] **Step 2: Implement**

`packages/indexer/src/summarize.ts`:
```ts
import type { Detections } from './detect';
import type { FileFacts } from './parse';

export type Summarizer = {
  service(input: { name: string; languages: string[]; files: number; detections: Detections }): string;
  endpoint(method: string, path: string, file: string): string;
  file(facts: FileFacts): string;
  queue(name: string): string;
  table(name: string): string;
  external(host: string): string;
  config(name: string): string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const heuristicSummarizer: Summarizer = {
  service: ({ name, languages, files, detections }) => {
    const parts = [`${name} (${languages.join(', ') || 'unknown language'}) with ${plural(files, 'source file')}`];
    if (detections.endpoints.length) parts.push(`${detections.endpoints.length} HTTP endpoints`);
    const produced = new Set(detections.queues.filter((q) => q.role === 'producer').map((q) => q.name));
    const consumed = new Set(detections.queues.filter((q) => q.role === 'consumer').map((q) => q.name));
    if (produced.size) parts.push(`publishes to ${[...produced].join(', ')}`);
    if (consumed.size) parts.push(`consumes ${[...consumed].join(', ')}`);
    const tables = new Set(detections.tables.map((t) => t.name));
    if (tables.size) parts.push(`uses ${plural(tables.size, 'table')} (${[...tables].join(', ')})`);
    return `${parts.join('; ')}.`;
  },
  endpoint: (method, path, file) => `Handles ${method} ${path} in ${file}.`,
  file: (facts) => `${facts.path}: ${plural(facts.symbols.length, 'symbol')}${facts.symbols.length ? ` (${facts.symbols.slice(0, 5).map((s) => s.name).join(', ')})` : ''}.`,
  queue: (name) => `Message queue "${name}".`,
  table: (name) => `Database table "${name}".`,
  external: (host) => `External service at ${host}.`,
  config: (name) => `Environment variable ${name}.`,
};
```

`packages/indexer/src/repoGraph.ts`:
```ts
import { posix } from 'node:path';
import type { Detections } from './detect';
import type { FileFacts } from './parse';
import { heuristicSummarizer, type Summarizer } from './summarize';
import type { WalkResult } from './walk';

export const NODE_LABELS = ['Repo', 'Service', 'File', 'Endpoint', 'Queue', 'Table', 'External', 'ConfigKey'] as const;
export const EDGE_TYPES = ['CONTAINS', 'IMPORTS', 'HANDLES', 'PUBLISHES', 'CONSUMES', 'READS', 'WRITES', 'CALLS', 'USES_CONFIG', 'CALLS_HTTP'] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type GraphNode = { id: string; label: NodeLabel; name: string; summary: string; repoId: string | null; props: Record<string, string | number | string[]> };
export type GraphEdge = { from: string; to: string; type: EdgeType; props: Record<string, string | number> };
export type RepoGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

export const repoNodeId = (repoId: string) => `repo:${repoId}`;
export const serviceId = (repoId: string) => `svc:${repoId}`;
export const fileId = (repoId: string, path: string) => `file:${repoId}:${path}`;
export const endpointId = (repoId: string, method: string, path: string) => `ep:${repoId}:${method} ${path}`;
export const configId = (repoId: string, name: string) => `cfg:${repoId}:${name}`;
export const queueId = (orgId: string, name: string) => `queue:${orgId}:${name}`;
export const tableId = (orgId: string, name: string) => `table:${orgId}:${name}`;
export const externalId = (orgId: string, host: string) => `ext:${orgId}:${host}`;

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const ABSOLUTE_URL = /^https?:\/\//i;

const resolveImport = (from: string, specifier: string, known: Set<string>): string | null => {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = [base, ...SCRIPT_EXTENSIONS.map((ext) => `${base}${ext}`), ...SCRIPT_EXTENSIONS.map((ext) => `${base}/index${ext}`)];
  return candidates.find((c) => known.has(c)) ?? null;
};

export const buildRepoGraph = (input: {
  orgId: string; repoId: string; fullName: string; walk: WalkResult; facts: FileFacts[]; detections: Detections; summarizer?: Summarizer;
}): RepoGraph => {
  const { orgId, repoId, fullName, walk, facts, detections } = input;
  const summarize = input.summarizer ?? heuristicSummarizer;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (from: string, to: string, type: EdgeType, props: Record<string, string | number> = {}) => {
    const key = `${from}|${type}|${to}`;
    if (!edges.has(key)) edges.set(key, { from, to, type, props });
  };

  const name = walk.packageName ?? fullName.split('/').pop() ?? fullName;
  const repo = repoNodeId(repoId);
  const service = serviceId(repoId);
  addNode({ id: repo, label: 'Repo', name: fullName, summary: `Repository ${fullName}.`, repoId, props: { fullName } });
  addNode({ id: service, label: 'Service', name, summary: summarize.service({ name, languages: walk.languages, files: walk.files.length, detections }), repoId, props: { repo: fullName, languages: walk.languages } });
  addEdge(repo, service, 'CONTAINS');

  const outboundByFile = new Map<string, string[]>();
  for (const call of detections.outbound) {
    if (ABSOLUTE_URL.test(call.url)) continue;
    outboundByFile.set(call.file, [...(outboundByFile.get(call.file) ?? []), `${call.method} ${call.url}`]);
  }

  const known = new Set(facts.map((f) => f.path));
  for (const file of facts) {
    const id = fileId(repoId, file.path);
    addNode({ id, label: 'File', name: file.path, summary: summarize.file(file), repoId, props: { path: file.path, language: file.language, loc: file.loc, outbound: outboundByFile.get(file.path) ?? [] } });
    addEdge(service, id, 'CONTAINS');
  }
  for (const file of facts) {
    for (const specifier of file.imports) {
      const target = resolveImport(file.path, specifier, known);
      if (target) addEdge(fileId(repoId, file.path), fileId(repoId, target), 'IMPORTS');
    }
  }
  for (const ep of detections.endpoints) {
    const id = endpointId(repoId, ep.method, ep.path);
    addNode({ id, label: 'Endpoint', name: `${ep.method} ${ep.path}`, summary: summarize.endpoint(ep.method, ep.path, ep.file), repoId, props: { method: ep.method, path: ep.path } });
    addEdge(service, id, 'CONTAINS');
    addEdge(id, fileId(repoId, ep.file), 'HANDLES');
  }
  for (const q of detections.queues) {
    const id = queueId(orgId, q.name);
    addNode({ id, label: 'Queue', name: q.name, summary: summarize.queue(q.name), repoId: null, props: {} });
    addEdge(fileId(repoId, q.file), id, q.role === 'producer' ? 'PUBLISHES' : 'CONSUMES');
  }
  for (const t of detections.tables) {
    const id = tableId(orgId, t.name);
    addNode({ id, label: 'Table', name: t.name, summary: summarize.table(t.name), repoId: null, props: {} });
    addEdge(fileId(repoId, t.file), id, t.access === 'write' ? 'WRITES' : 'READS');
  }
  for (const call of detections.outbound) {
    if (!ABSOLUTE_URL.test(call.url)) continue;
    const host = new URL(call.url).host;
    const id = externalId(orgId, host);
    addNode({ id, label: 'External', name: host, summary: summarize.external(host), repoId: null, props: {} });
    addEdge(fileId(repoId, call.file), id, 'CALLS', { method: call.method });
  }
  for (const c of detections.config) {
    const id = configId(repoId, c.name);
    addNode({ id, label: 'ConfigKey', name: c.name, summary: summarize.config(c.name), repoId, props: {} });
    addEdge(fileId(repoId, c.file), id, 'USES_CONFIG');
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
};
```

Append to `packages/indexer/src/index.ts`:
```ts
export * from './summarize';
export * from './repoGraph';
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/indexer && npm run typecheck -w @rdi/indexer`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(indexer): build per-repository graphs with heuristic summaries

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Cross-repository linker

**Files:**
- Create: `packages/indexer/src/link.ts`
- Modify: `packages/indexer/src/index.ts`
- Test: `packages/indexer/test/link.test.ts`

**Interfaces:**
- Produces:
  ```ts
  normalizePath(path: string): string          // strips origin/query/trailing slash; params (:id, {id}, ${}, <id>) → *
  type LinkInput = { repoId: string; outbound: { fileId: string; method: string; url: string }[]; endpoints: { id: string; method: string; path: string }[] }
  linkRepos(repos: LinkInput[]): GraphEdge[]    // CALLS_HTTP file → endpoint in another repo, props { method, path, confidence }
  linkInputsFromGraph(nodes: GraphNode[]): LinkInput[]
  ```

- [ ] **Step 1: Write the failing test**

`packages/indexer/test/link.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { linkInputsFromGraph, linkRepos, normalizePath } from '../src/index';
import { graphFor } from './repoGraph.test';

describe('normalizePath', () => {
  it('normalizes parameters, origins, queries and trailing slashes', () => {
    expect(normalizePath('/api/orders/:id')).toBe('/api/orders/*');
    expect(normalizePath('/api/orders/${}')).toBe('/api/orders/*');
    expect(normalizePath('/items/{item_id}/')).toBe('/items/*');
    expect(normalizePath('http://shop-api:3000/api/Orders?x=1')).toBe('/api/orders');
  });
});

describe('linkRepos', () => {
  it('links web fetches to api endpoints across repos with the same method', async () => {
    const graphs = await Promise.all([graphFor('shop-web'), graphFor('shop-api'), graphFor('shop-worker')]);
    const links = linkRepos(linkInputsFromGraph(graphs.flatMap((g) => g.nodes)));
    expect(links.map((l) => `${l.from} -> ${l.to} (${l.props.confidence})`)).toEqual([
      'file:shop-web:src/api.ts -> ep:shop-api:POST /api/orders (0.9)',
      'file:shop-web:src/api.ts -> ep:shop-api:GET /api/orders/:id (0.9)',
    ]);
    expect(links.every((l) => l.type === 'CALLS_HTTP')).toBe(true);
  });

  it('ignores method mismatches and same-repo matches, and splits confidence', () => {
    const links = linkRepos([
      { repoId: 'a', outbound: [{ fileId: 'fa', method: 'GET', url: '/x' }, { fileId: 'fa', method: 'DELETE', url: '/y' }], endpoints: [{ id: 'ea', method: 'GET', path: '/x' }] },
      { repoId: 'b', outbound: [], endpoints: [{ id: 'eb', method: 'GET', path: '/x' }, { id: 'eb2', method: 'POST', path: '/y' }] },
      { repoId: 'c', outbound: [], endpoints: [{ id: 'ec', method: 'GET', path: '/x' }] },
    ]);
    expect(links.map((l) => `${l.to}:${l.props.confidence}`)).toEqual(['eb:0.45', 'ec:0.45']);
  });
});
```

Run: `npm test -w @rdi/indexer -- link`
Expected: FAIL — `linkRepos` not exported.

- [ ] **Step 2: Implement**

`packages/indexer/src/link.ts`:
```ts
import type { GraphEdge, GraphNode } from './repoGraph';

export type LinkInput = { repoId: string; outbound: { fileId: string; method: string; url: string }[]; endpoints: { id: string; method: string; path: string }[] };

const BASE_CONFIDENCE = 0.9;
const PARAM_SEGMENT = /^(:[^/]+|\{[^/]+\}|\$\{\}|<[^/]+>)$/;
const ORIGIN = /^[a-z]+:\/\/[^/]+/i;

export const normalizePath = (path: string): string => {
  const withoutOrigin = path.replace(ORIGIN, '');
  const withoutQuery = withoutOrigin.split(/[?#]/)[0] ?? '';
  const segments = withoutQuery.split('/').filter(Boolean).map((s) => (PARAM_SEGMENT.test(s) || s.includes('${}') ? '*' : s.toLowerCase()));
  return `/${segments.join('/')}`;
};

export const linkRepos = (repos: LinkInput[]): GraphEdge[] => {
  const links: GraphEdge[] = [];
  for (const repo of repos) {
    for (const call of repo.outbound) {
      const target = normalizePath(call.url);
      const matches = repos
        .filter((other) => other.repoId !== repo.repoId)
        .flatMap((other) => other.endpoints.filter((ep) => ep.method === call.method && normalizePath(ep.path) === target));
      const confidence = Math.round((BASE_CONFIDENCE / Math.max(matches.length, 1)) * 100) / 100;
      for (const ep of matches) links.push({ from: call.fileId, to: ep.id, type: 'CALLS_HTTP', props: { method: call.method, path: ep.path, confidence } });
    }
  }
  return links;
};

export const linkInputsFromGraph = (nodes: GraphNode[]): LinkInput[] => {
  const byRepo = new Map<string, LinkInput>();
  const entry = (repoId: string) => {
    const existing = byRepo.get(repoId);
    if (existing) return existing;
    const created: LinkInput = { repoId, outbound: [], endpoints: [] };
    byRepo.set(repoId, created);
    return created;
  };
  for (const node of nodes) {
    if (!node.repoId) continue;
    if (node.label === 'Endpoint') entry(node.repoId).endpoints.push({ id: node.id, method: String(node.props.method), path: String(node.props.path) });
    if (node.label === 'File' && Array.isArray(node.props.outbound)) {
      for (const call of node.props.outbound) {
        const [method, ...rest] = call.split(' ');
        if (method && rest.length) entry(node.repoId).outbound.push({ fileId: node.id, method, url: rest.join(' ') });
      }
    }
  }
  return [...byRepo.values()];
};
```

Append to `packages/indexer/src/index.ts`:
```ts
export * from './link';
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/indexer && npm run typecheck -w @rdi/indexer`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(indexer): link outbound HTTP calls to endpoints across repositories

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: System map scene with an inferred walkthrough

**Files:**
- Create: `packages/indexer/src/systemMap.ts`
- Modify: `packages/indexer/src/index.ts`
- Test: `packages/indexer/test/systemMap.test.ts`

**Interfaces:**
- Consumes: `defineScene`, `Scene`, `SceneInput`, `StepInput` from `@rdi/scene`.
- Produces:
  ```ts
  type OrgGraph = { nodes: GraphNode[]; edges: GraphEdge[] }
  SYSTEM_MAP_ID = 'system-map'
  buildSystemMap(graph: OrgGraph): Scene | null        // null when there are no services
  ```
  Scene content: services (compute, grouped by repo) with endpoint children, queues (channel), tables (storage), externals (external); service-level edges derived from file-level edges; a walkthrough of up to 12 steps starting at a service with outgoing HTTP calls and no incoming edges.

- [ ] **Step 1: Write the failing test**

`packages/indexer/test/systemMap.test.ts`:
```ts
import { validateScene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import { buildSystemMap, linkInputsFromGraph, linkRepos, type OrgGraph } from '../src/index';
import { graphFor } from './repoGraph.test';

const orgGraph = async (): Promise<OrgGraph> => {
  const graphs = await Promise.all([graphFor('shop-web'), graphFor('shop-api'), graphFor('shop-worker')]);
  const nodes = [...new Map(graphs.flatMap((g) => g.nodes).map((n) => [n.id, n])).values()];
  return { nodes, edges: [...graphs.flatMap((g) => g.edges), ...linkRepos(linkInputsFromGraph(nodes))] };
};

describe('buildSystemMap', () => {
  it('returns null without services', () => {
    expect(buildSystemMap({ nodes: [], edges: [] })).toBeNull();
  });

  it('builds a valid scene with services, endpoints, queues, tables and externals', async () => {
    const scene = buildSystemMap(await orgGraph())!;
    expect(validateScene(scene)).toMatchObject({ ok: true });
    expect(scene).toMatchObject({ id: 'system-map', title: 'System map', language: 'en' });
    const byLabel = Object.fromEntries(scene.nodes.map((n) => [n.label, n]));
    expect(byLabel['shop-api']).toMatchObject({ role: 'compute', kind: 'service', repo: 'acme-demo/shop-api' });
    expect(byLabel['POST /api/orders']).toMatchObject({ role: 'compute', kind: 'HTTP endpoint', parent: byLabel['shop-api']!.id });
    expect(byLabel['orders']).toBeDefined();
    expect(scene.nodes.filter((n) => n.label === 'orders').map((n) => n.role).sort()).toEqual(['channel', 'storage']);
    expect(byLabel['api.stripe.com']).toMatchObject({ role: 'external' });
  });

  it('derives service-level edges including the cross-repo HTTP call', async () => {
    const scene = buildSystemMap(await orgGraph())!;
    const label = new Map(scene.nodes.map((n) => [n.id, `${n.label}${n.role === 'channel' ? '(q)' : n.role === 'storage' ? '(t)' : ''}`]));
    const edges = scene.edges.map((e) => `${label.get(e.from)} -${e.kind}-> ${label.get(e.to)}`);
    expect(edges).toEqual(expect.arrayContaining([
      'shop-web -sync-> POST /api/orders',
      'shop-web -sync-> GET /api/orders/:id',
      'shop-api -async-> orders(q)',
      'orders(q) -async-> shop-worker',
      'shop-api -write-> orders(t)',
      'shop-api -read-> orders(t)',
      'shop-worker -write-> orders(t)',
      'shop-worker -calls-> api.stripe.com',
    ]));
  });

  it('infers a walkthrough that follows the request through the system', async () => {
    const scene = buildSystemMap(await orgGraph())!;
    const narr = scene.steps.map((s) => s.narration);
    expect(narr[0]).toBe('shop-web calls POST /api/orders on shop-api.');
    expect(narr[1]).toBe('shop-api publishes a message to the "orders" queue.');
    expect(narr[2]).toBe('shop-worker picks up the message from "orders".');
    expect(narr).toContain('shop-worker calls the external service api.stripe.com.');
    expect(scene.steps.every((s) => s.travel)).toBe(true);
    expect(scene.steps.length).toBeLessThanOrEqual(12);
  });
});
```

Run: `npm test -w @rdi/indexer -- systemMap`
Expected: FAIL — `buildSystemMap` not exported.

- [ ] **Step 2: Implement**

`packages/indexer/src/systemMap.ts`:
```ts
import { createHash } from 'node:crypto';
import { defineScene, type EdgeKind, type Scene, type SceneInput, type StepInput } from '@rdi/scene';
import type { GraphEdge, GraphNode } from './repoGraph';

export type OrgGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
export const SYSTEM_MAP_ID = 'system-map';

const MAX_ID = 100;
const MAX_LABEL = 110;
const MAX_STEPS = 12;
const EDGE_ORDER: EdgeKind[] = ['sync', 'async', 'write', 'read', 'calls'];

const sceneId = (id: string) => (id.length <= MAX_ID ? id : `${id.slice(0, 80)}#${createHash('sha1').update(id).digest('hex').slice(0, 12)}`);
const clip = (text: string) => (text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 1)}…`);

type SceneEdgeDraft = { from: string; to: string; kind: EdgeKind; label?: string };

export const buildSystemMap = (graph: OrgGraph): Scene | null => {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const services = graph.nodes.filter((n) => n.label === 'Service').sort((a, b) => a.name.localeCompare(b.name));
  if (services.length === 0) return null;

  const serviceOfFile = new Map<string, string>();
  const serviceOfEndpoint = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type !== 'CONTAINS') continue;
    const target = byId.get(e.to);
    if (target?.label === 'File') serviceOfFile.set(e.to, e.from);
    if (target?.label === 'Endpoint') serviceOfEndpoint.set(e.to, e.from);
  }

  const nodes: SceneInput['nodes'] = [];
  const included = new Set<string>();
  const include = (node: GraphNode, role: 'compute' | 'channel' | 'storage' | 'external', kind: string, parent?: string) => {
    included.add(node.id);
    nodes.push({
      id: sceneId(node.id), label: clip(node.name), role, kind, summary: node.summary || node.name,
      ...(parent ? { parent: sceneId(parent) } : {}),
      ...(node.label === 'Service' && typeof node.props.repo === 'string' ? { repo: node.props.repo } : {}),
    });
  };
  for (const svc of services) include(svc, 'compute', 'service');
  for (const node of graph.nodes) {
    if (node.label === 'Endpoint' && serviceOfEndpoint.has(node.id)) include(node, 'compute', 'HTTP endpoint', serviceOfEndpoint.get(node.id));
    if (node.label === 'Queue') include(node, 'channel', 'queue');
    if (node.label === 'Table') include(node, 'storage', 'table');
    if (node.label === 'External') include(node, 'external', 'external API');
  }

  const drafts = new Map<string, SceneEdgeDraft>();
  const addEdge = (from: string | undefined, to: string | undefined, kind: EdgeKind, label?: string) => {
    if (!from || !to || from === to || !included.has(from) || !included.has(to)) return;
    const key = `${from}|${kind}|${to}`;
    if (!drafts.has(key)) drafts.set(key, { from, to, kind, label });
  };
  for (const e of graph.edges) {
    const svc = serviceOfFile.get(e.from);
    switch (e.type) {
      case 'PUBLISHES': addEdge(svc, e.to, 'async', 'publish'); break;
      case 'CONSUMES': addEdge(e.to, svc, 'async', 'consume'); break;
      case 'WRITES': addEdge(svc, e.to, 'write'); break;
      case 'READS': addEdge(svc, e.to, 'read'); break;
      case 'CALLS': addEdge(svc, e.to, 'calls'); break;
      case 'CALLS_HTTP': addEdge(svc, e.to, 'sync', byId.get(e.to)?.name); break;
    }
  }
  const edgeList = [...drafts.values()].map((d, i) => ({ id: `e${i + 1}`, from: sceneId(d.from), to: sceneId(d.to), kind: d.kind, ...(d.label ? { label: clip(d.label) } : {}) }));

  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  const parentOf = new Map(nodes.flatMap((n) => (n.parent ? [[n.id, n.parent] as const] : [])));
  const roleOf = new Map(nodes.map((n) => [n.id, n.role]));
  const outgoing = (id: string) =>
    edgeList.filter((e) => e.from === id).sort((a, b) => EDGE_ORDER.indexOf(a.kind) - EDGE_ORDER.indexOf(b.kind));
  const narrate = (e: (typeof edgeList)[number]): string => {
    const from = labelOf.get(e.from) ?? e.from;
    const to = labelOf.get(e.to) ?? e.to;
    if (e.kind === 'sync') return `${from} calls ${to} on ${labelOf.get(parentOf.get(e.to) ?? '') ?? 'another service'}.`;
    if (e.kind === 'async' && roleOf.get(e.to) === 'channel') return `${from} publishes a message to the "${to}" queue.`;
    if (e.kind === 'async') return `${to} picks up the message from "${from}".`;
    if (e.kind === 'write') return `${from} writes to the "${to}" table.`;
    if (e.kind === 'read') return `${from} reads from the "${to}" table.`;
    return `${from} calls the external service ${to}.`;
  };

  const incoming = new Set(edgeList.map((e) => e.to));
  const serviceIds = services.map((s) => sceneId(s.id));
  const entry = serviceIds.find((id) => !incoming.has(id) && outgoing(id).some((e) => e.kind === 'sync')) ?? serviceIds.find((id) => outgoing(id).length > 0);

  const steps: StepInput[] = [];
  const usedEdges = new Set<string>();
  const visit = (id: string) => {
    for (const e of outgoing(id)) {
      if (steps.length >= MAX_STEPS) return;
      if (usedEdges.has(e.id)) continue;
      usedEdges.add(e.id);
      steps.push({ id: `s${steps.length + 1}`, narration: narrate(e), focus: [e.to], travel: { edgeId: e.id } });
      const next = parentOf.get(e.to) ?? e.to;
      if (roleOf.get(next) === 'compute' || roleOf.get(next) === 'channel') visit(next);
    }
  };
  if (entry) visit(entry);

  return defineScene({
    id: SYSTEM_MAP_ID,
    title: 'System map',
    summary: `Generated from ${services.length} ${services.length === 1 ? 'repository' : 'repositories'}: ${services.map((s) => s.name).join(', ')}.`,
    language: 'en',
    nodes,
    edges: edgeList,
    steps,
  });
};
```

Append to `packages/indexer/src/index.ts`:
```ts
export * from './systemMap';
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/indexer && npm run typecheck -w @rdi/indexer`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(indexer): generate a system map scene with an inferred walkthrough

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Neo4j graph store and relinking

**Files:**
- Create: `packages/graph/{package.json,tsconfig.json,vitest.config.ts,vitest.integration.config.ts}`, `packages/graph/src/{index,store,relink}.ts`
- Test: `packages/graph/test/store.integration.test.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge`, `RepoGraph`, `OrgGraph`, `NODE_LABELS`, `EDGE_TYPES`, `linkRepos`, `linkInputsFromGraph` from `@rdi/indexer`.
- Produces:
  ```ts
  type GraphStore = {
    ensureSchema(): Promise<void>
    writeRepoGraph(orgId: string, repoId: string, graph: RepoGraph): Promise<void>   // replaces repo-owned nodes; merges shared nodes
    replaceOrgLinks(orgId: string, links: GraphEdge[]): Promise<void>
    deleteRepo(orgId: string, repoId: string): Promise<void>
    readOrgGraph(orgId: string): Promise<OrgGraph>
    countOrgNodes(orgId: string): Promise<number>
    close(): Promise<void>
  }
  createGraphStore(url: string, user: string, password: string): GraphStore
  relinkOrg(store: GraphStore, orgId: string): Promise<number>   // recomputes CALLS_HTTP, returns link count
  ```

- [ ] **Step 1: Package setup**

`packages/graph/package.json`:
```json
{
  "name": "@rdi/graph",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": { "@rdi/indexer": "*" }
}
```
`packages/graph/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
```
`packages/graph/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', exclude: ['**/node_modules/**', 'test/**/*.integration.test.ts'] } });
```
`packages/graph/vitest.integration.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', testTimeout: 60_000, include: ['test/**/*.integration.test.ts'], fileParallelism: false } });
```
Run:
```bash
npm install
npm install -w @rdi/graph neo4j-driver
npm install -w @rdi/graph -D vitest @types/node
grep -E '"neo4j-driver"' packages/graph/package.json
```

- [ ] **Step 2: Write the failing test**

`packages/graph/test/store.integration.test.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildRepoGraph, detect, parseRepository, walkRepository } from '@rdi/indexer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGraphStore, relinkOrg, type GraphStore } from '../src/index';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
const store: GraphStore = createGraphStore(process.env.NEO4J_URL ?? 'bolt://localhost:7690', 'neo4j', process.env.NEO4J_PASSWORD ?? 'rdi-dev-password');
const orgs: string[] = [];

const graphOf = async (orgId: string, repo: string, repoId: string) => {
  const walk = await walkRepository(`${FIXTURES}/${repo}`);
  const facts = await parseRepository(walk.files);
  return buildRepoGraph({ orgId, repoId, fullName: `acme-demo/${repo}`, walk, facts, detections: detect(facts) });
};
const newOrg = () => {
  const id = randomUUID();
  orgs.push(id);
  return id;
};

beforeAll(() => store.ensureSchema());
afterAll(async () => {
  for (const org of orgs) for (const repo of ['web', 'api', 'worker']) await store.deleteRepo(org, `${org}-${repo}`);
  await store.close();
});

describe('graph store', () => {
  it('writes and reads a repository graph', async () => {
    const org = newOrg();
    const graph = await graphOf(org, 'shop-api', `${org}-api`);
    await store.writeRepoGraph(org, `${org}-api`, graph);
    const read = await store.readOrgGraph(org);
    expect(read.nodes.map((n) => n.id).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
    expect(read.edges).toHaveLength(graph.edges.length);
    const svc = read.nodes.find((n) => n.label === 'Service')!;
    expect(svc).toMatchObject({ name: 'shop-api', repoId: `${org}-api`, props: { repo: 'acme-demo/shop-api', languages: ['TypeScript'] } });
    expect(read.nodes.find((n) => n.label === 'Queue')!.repoId).toBeNull();
    expect(await store.countOrgNodes(org)).toBe(graph.nodes.length);
  });

  it('replaces instead of duplicating on re-index, and keeps shared nodes referenced by other repos', async () => {
    const org = newOrg();
    await store.writeRepoGraph(org, `${org}-api`, await graphOf(org, 'shop-api', `${org}-api`));
    await store.writeRepoGraph(org, `${org}-worker`, await graphOf(org, 'shop-worker', `${org}-worker`));
    const before = await store.countOrgNodes(org);
    await store.writeRepoGraph(org, `${org}-api`, await graphOf(org, 'shop-api', `${org}-api`));
    expect(await store.countOrgNodes(org)).toBe(before);
    await store.deleteRepo(org, `${org}-api`);
    const after = await store.readOrgGraph(org);
    expect(after.nodes.some((n) => n.id === `queue:${org}:orders`)).toBe(true);
    expect(after.nodes.some((n) => n.repoId === `${org}-api`)).toBe(false);
    await store.deleteRepo(org, `${org}-worker`);
    expect(await store.countOrgNodes(org)).toBe(0);
  });

  it('relinks cross-repo calls and drops links when a repo disappears', async () => {
    const org = newOrg();
    await store.writeRepoGraph(org, `${org}-web`, await graphOf(org, 'shop-web', `${org}-web`));
    await store.writeRepoGraph(org, `${org}-api`, await graphOf(org, 'shop-api', `${org}-api`));
    expect(await relinkOrg(store, org)).toBe(2);
    expect((await store.readOrgGraph(org)).edges.filter((e) => e.type === 'CALLS_HTTP')).toHaveLength(2);
    expect(await relinkOrg(store, org)).toBe(2);
    expect((await store.readOrgGraph(org)).edges.filter((e) => e.type === 'CALLS_HTTP')).toHaveLength(2);
    await store.deleteRepo(org, `${org}-api`);
    expect(await relinkOrg(store, org)).toBe(0);
  });

  it('isolates organizations, even for shared names', async () => {
    const a = newOrg();
    const b = newOrg();
    await store.writeRepoGraph(a, `${a}-api`, await graphOf(a, 'shop-api', `${a}-api`));
    expect(await store.countOrgNodes(b)).toBe(0);
    expect((await store.readOrgGraph(b)).nodes).toEqual([]);
  });
});
```

Run: `npm run infra:up && npm run test:integration -w @rdi/graph`
Expected: FAIL — `../src/index` not found.

- [ ] **Step 3: Implement**

`packages/graph/src/store.ts`:
```ts
import { EDGE_TYPES, NODE_LABELS, type GraphEdge, type GraphNode, type NodeLabel, type OrgGraph, type RepoGraph } from '@rdi/indexer';
import neo4j, { type Driver } from 'neo4j-driver';

export type GraphStore = {
  ensureSchema(): Promise<void>;
  writeRepoGraph(orgId: string, repoId: string, graph: RepoGraph): Promise<void>;
  replaceOrgLinks(orgId: string, links: GraphEdge[]): Promise<void>;
  deleteRepo(orgId: string, repoId: string): Promise<void>;
  readOrgGraph(orgId: string): Promise<OrgGraph>;
  countOrgNodes(orgId: string): Promise<number>;
  close(): Promise<void>;
};

const RESERVED = new Set(['id', 'org_id', 'repo_id', 'label', 'name', 'summary']);
const LABELS = new Set<string>(NODE_LABELS);
const TYPES = new Set<string>(EDGE_TYPES);

const assertLabel = (label: string) => {
  if (!LABELS.has(label)) throw new Error(`unknown node label ${label}`);
};
const assertType = (type: string) => {
  if (!TYPES.has(type)) throw new Error(`unknown edge type ${type}`);
};

const groupBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce((map, item) => map.set(key(item), [...(map.get(key(item)) ?? []), item]), new Map<string, T[]>());

export const createGraphStore = (url: string, user: string, password: string): GraphStore => {
  const driver: Driver = neo4j.driver(url, neo4j.auth.basic(user, password), { disableLosslessIntegers: true });
  const run = async (query: string, params: Record<string, unknown> = {}) => {
    const session = driver.session();
    try {
      return await session.run(query, params);
    } finally {
      await session.close();
    }
  };
  const write = async (work: (tx: { run: (q: string, p?: Record<string, unknown>) => Promise<unknown> }) => Promise<void>) => {
    const session = driver.session();
    try {
      await session.executeWrite(async (tx) => work({ run: (q, p = {}) => tx.run(q, p) }));
    } finally {
      await session.close();
    }
  };
  const cleanupOrphans = "MATCH (n:Piece {org_id: $orgId}) WHERE n.repo_id IS NULL AND NOT (n)--() DELETE n";

  return {
    async ensureSchema() {
      await run('CREATE CONSTRAINT piece_id IF NOT EXISTS FOR (p:Piece) REQUIRE p.id IS UNIQUE');
      await run('CREATE INDEX piece_org IF NOT EXISTS FOR (p:Piece) ON (p.org_id)');
    },

    async writeRepoGraph(orgId, repoId, graph) {
      await write(async (tx) => {
        await tx.run('MATCH (n:Piece {org_id: $orgId, repo_id: $repoId}) DETACH DELETE n', { orgId, repoId });
        for (const [label, nodes] of groupBy(graph.nodes, (n) => n.label)) {
          assertLabel(label);
          await tx.run(
            `UNWIND $nodes AS n
             MERGE (p:Piece {id: n.id})
             SET p:${label}, p += n.props, p.org_id = $orgId, p.label = n.label, p.name = n.name, p.summary = n.summary
             FOREACH (_ IN CASE WHEN n.repoId IS NULL THEN [] ELSE [1] END | SET p.repo_id = n.repoId)`,
            { orgId, nodes: nodes.map((n) => ({ id: n.id, label: n.label, name: n.name, summary: n.summary, repoId: n.repoId, props: n.props })) },
          );
        }
        for (const [type, edges] of groupBy(graph.edges, (e) => e.type)) {
          assertType(type);
          await tx.run(
            `UNWIND $edges AS e
             MATCH (a:Piece {id: e.from}), (b:Piece {id: e.to})
             MERGE (a)-[r:${type}]->(b)
             SET r += e.props, r.org_id = $orgId, r.repo_id = $repoId`,
            { orgId, repoId, edges },
          );
        }
        await tx.run(cleanupOrphans, { orgId });
      });
    },

    async replaceOrgLinks(orgId, links) {
      await write(async (tx) => {
        await tx.run('MATCH (:Piece {org_id: $orgId})-[r:CALLS_HTTP]->() DELETE r', { orgId });
        for (const link of links) assertType(link.type);
        await tx.run(
          `UNWIND $links AS e
           MATCH (a:Piece {id: e.from, org_id: $orgId}), (b:Piece {id: e.to, org_id: $orgId})
           MERGE (a)-[r:CALLS_HTTP]->(b)
           SET r += e.props, r.org_id = $orgId`,
          { orgId, links },
        );
      });
    },

    async deleteRepo(orgId, repoId) {
      await write(async (tx) => {
        await tx.run('MATCH (n:Piece {org_id: $orgId, repo_id: $repoId}) DETACH DELETE n', { orgId, repoId });
        await tx.run(cleanupOrphans, { orgId });
      });
    },

    async readOrgGraph(orgId) {
      const nodeRows = await run('MATCH (n:Piece {org_id: $orgId}) RETURN properties(n) AS p', { orgId });
      const edgeRows = await run(
        'MATCH (a:Piece {org_id: $orgId})-[r]->(b:Piece {org_id: $orgId}) RETURN a.id AS from, type(r) AS type, b.id AS to, properties(r) AS p',
        { orgId },
      );
      const nodes: GraphNode[] = nodeRows.records.map((record) => {
        const p = record.get('p') as Record<string, string | number | string[]>;
        const props = Object.fromEntries(Object.entries(p).filter(([k]) => !RESERVED.has(k)));
        return { id: String(p.id), label: String(p.label) as NodeLabel, name: String(p.name), summary: String(p.summary ?? ''), repoId: p.repo_id ? String(p.repo_id) : null, props };
      });
      const edges: GraphEdge[] = edgeRows.records.map((record) => {
        const p = record.get('p') as Record<string, string | number>;
        const props = Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'org_id' && k !== 'repo_id'));
        return { from: record.get('from') as string, to: record.get('to') as string, type: record.get('type') as GraphEdge['type'], props };
      });
      return { nodes, edges };
    },

    async countOrgNodes(orgId) {
      const result = await run('MATCH (n:Piece {org_id: $orgId}) RETURN count(n) AS c', { orgId });
      return Number(result.records[0]?.get('c') ?? 0);
    },

    close: () => driver.close(),
  };
};
```

`packages/graph/src/relink.ts`:
```ts
import { linkInputsFromGraph, linkRepos } from '@rdi/indexer';
import type { GraphStore } from './store';

export const relinkOrg = async (store: GraphStore, orgId: string): Promise<number> => {
  const graph = await store.readOrgGraph(orgId);
  const links = linkRepos(linkInputsFromGraph(graph.nodes));
  await store.replaceOrgLinks(orgId, links);
  return links.length;
};
```

`packages/graph/src/index.ts`:
```ts
export * from './store';
export * from './relink';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/graph && npm test -w @rdi/graph && npm run typecheck -w @rdi/graph`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(graph): add org-scoped Neo4j graph store with relinking

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Providers — GitHub App client, signatures, demo sources, cloning

**Files:**
- Create: `packages/providers/{package.json,tsconfig.json,vitest.config.ts}`, `packages/providers/src/{index,github,signatures,demo,materialize}.ts`
- Test: `packages/providers/test/{github,signatures,demo,materialize}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type GitHubAppConfig = { appId: string; privateKey: string; slug: string; apiUrl?: string }
  createAppJwt(config: GitHubAppConfig, now?: Date): string
  type GitHubRepo = { fullName: string; defaultBranch: string; private: boolean }
  type GitHubClient = { installationToken(installationId: number): Promise<string>; listInstallationRepos(installationId: number): Promise<GitHubRepo[]>;
                        getInstallation(installationId: number): Promise<{ accountLogin: string }>; installUrl(state: string): string }
  createGitHubClient(config: GitHubAppConfig, fetchImpl?: typeof fetch): GitHubClient
  verifyWebhookSignature(secret: string, payload: string, header: string | undefined): boolean
  signState(secret: string, orgId: string, now?: Date): string; verifyState(secret: string, state: string, now?: Date, maxAgeMs?: number): string | null
  DEMO_REPOS: { fullName: string; dir: string; defaultBranch: string }[]   // acme-demo/shop-web|shop-api|shop-worker
  isDemoRepo(fullName: string): boolean; demoRepoPath(fixturesDir: string, fullName: string): string | null
  type CloneSource = { kind: 'git'; url: string; branch: string } | { kind: 'local'; path: string }
  materialize(source: CloneSource, dest: string): Promise<void>
  githubCloneUrl(fullName: string, token: string): string
  ```

- [ ] **Step 1: Package setup**

`packages/providers/package.json`:
```json
{
  "name": "@rdi/providers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc -p tsconfig.json" }
}
```
`packages/providers/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
```
`packages/providers/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', testTimeout: 30_000 } });
```
Run: `npm install && npm install -w @rdi/providers -D vitest @types/node`

- [ ] **Step 2: Write the failing tests**

`packages/providers/test/github.test.ts`:
```ts
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAppJwt, createGitHubClient, githubCloneUrl } from '../src/index';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = { appId: '12345', privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), slug: 'repo-designer' };
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('createAppJwt', () => {
  it('signs an RS256 JWT with the app id and a short lifetime', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    const jwt = createAppJwt(config, now);
    const [header, payload, signature] = jwt.split('.');
    expect(decode(header!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = decode(payload!);
    expect(claims.iss).toBe('12345');
    expect(claims.iat).toBe(now.getTime() / 1000 - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
});

describe('createGitHubClient', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('exchanges the app JWT for an installation token and lists repositories with it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ token: 'ghs_abc' }, 201))
      .mockResolvedValueOnce(json({ repositories: [{ full_name: 'acme/api', default_branch: 'main', private: true }] }));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    expect(await client.listInstallationRepos(77)).toEqual([{ fullName: 'acme/api', defaultBranch: 'main', private: true }]);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://api.github.com/app/installations/77/access_tokens');
    expect(tokenInit.method).toBe('POST');
    expect(tokenInit.headers.authorization).toMatch(/^Bearer ey/);
    const [listUrl, listInit] = fetchMock.mock.calls[1]!;
    expect(listUrl).toBe('https://api.github.com/installation/repositories?per_page=100');
    expect(listInit.headers.authorization).toBe('token ghs_abc');
  });

  it('reads the installation account and builds the install url', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ account: { login: 'acme' } }));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    expect(await client.getInstallation(77)).toEqual({ accountLogin: 'acme' });
    expect(client.installUrl('s t')).toBe('https://github.com/apps/repo-designer/installations/new?state=s%20t');
  });

  it('surfaces GitHub errors without leaking tokens', async () => {
    const client = createGitHubClient(config, vi.fn().mockResolvedValue(json({ message: 'Bad credentials' }, 401)) as unknown as typeof fetch);
    await expect(client.installationToken(1)).rejects.toThrow('GitHub API 401: Bad credentials');
  });

  it('builds token clone urls', () => {
    expect(githubCloneUrl('acme/api', 'ghs_x')).toBe('https://x-access-token:ghs_x@github.com/acme/api.git');
  });
});
```

`packages/providers/test/signatures.test.ts`:
```ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signState, verifyState, verifyWebhookSignature } from '../src/index';

describe('verifyWebhookSignature', () => {
  const body = '{"zen":"hi"}';
  const good = `sha256=${createHmac('sha256', 'whsec').update(body).digest('hex')}`;
  it('accepts the right signature and rejects wrong, malformed or missing ones', () => {
    expect(verifyWebhookSignature('whsec', body, good)).toBe(true);
    expect(verifyWebhookSignature('other', body, good)).toBe(false);
    expect(verifyWebhookSignature('whsec', `${body} `, good)).toBe(false);
    expect(verifyWebhookSignature('whsec', body, 'sha256=zz')).toBe(false);
    expect(verifyWebhookSignature('whsec', body, undefined)).toBe(false);
  });
});

describe('install state', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  it('round-trips the org id and rejects tampering and expiry', () => {
    const state = signState('secret', 'org-1', now);
    expect(verifyState('secret', state, now)).toBe('org-1');
    expect(verifyState('other', state, now)).toBeNull();
    expect(verifyState('secret', state.replace('org-1', 'org-2'), now)).toBeNull();
    expect(verifyState('secret', state, new Date(now.getTime() + 16 * 60_000))).toBeNull();
    expect(verifyState('secret', 'garbage', now)).toBeNull();
  });
});
```

`packages/providers/test/demo.test.ts`:
```ts
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_REPOS, demoRepoPath, isDemoRepo } from '../src/index';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));

describe('demo repositories', () => {
  it('maps demo names to bundled fixture directories', () => {
    expect(DEMO_REPOS.map((r) => r.fullName)).toEqual(['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']);
    DEMO_REPOS.forEach((r) => expect(existsSync(demoRepoPath(FIXTURES, r.fullName)!)).toBe(true));
    expect(isDemoRepo('acme-demo/shop-api')).toBe(true);
    expect(isDemoRepo('acme/api')).toBe(false);
    expect(demoRepoPath(FIXTURES, 'acme-demo/../../etc')).toBeNull();
  });
});
```

`packages/providers/test/materialize.test.ts`:
```ts
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { materialize } from '../src/index';

describe('materialize', () => {
  it('copies a local directory, replacing previous content', async () => {
    const src = await mkdtemp(join(tmpdir(), 'rdi-src-'));
    await writeFile(join(src, 'a.ts'), 'export const a = 1;\n');
    const dest = join(await mkdtemp(join(tmpdir(), 'rdi-dest-')), 'repo');
    await materialize({ kind: 'local', path: src }, dest);
    await writeFile(join(dest, 'stale.txt'), 'x');
    await materialize({ kind: 'local', path: src }, dest);
    expect(await readFile(join(dest, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(existsSync(join(dest, 'stale.txt'))).toBe(false);
  });

  it('shallow-clones a git repository branch', async () => {
    const origin = await mkdtemp(join(tmpdir(), 'rdi-origin-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: origin, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    await writeFile(join(origin, 'x.py'), 'x = 1\n');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
    const dest = join(await mkdtemp(join(tmpdir(), 'rdi-clone-')), 'repo');
    await materialize({ kind: 'git', url: `file://${origin}`, branch: 'main' }, dest);
    expect(await readFile(join(dest, 'x.py'), 'utf8')).toBe('x = 1\n');
  });

  it('fails with a message that hides credentials', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'rdi-bad-')), 'repo');
    await expect(materialize({ kind: 'git', url: 'https://x-access-token:SECRET@127.0.0.1:1/none.git', branch: 'main' }, dest)).rejects.toThrow(/^git clone failed/);
    await expect(materialize({ kind: 'git', url: 'https://x-access-token:SECRET@127.0.0.1:1/none.git', branch: 'main' }, dest)).rejects.not.toThrow(/SECRET/);
  });
});
```

Run: `npm test -w @rdi/providers`
Expected: FAIL — `../src/index` not found.

- [ ] **Step 3: Implement**

`packages/providers/src/github.ts`:
```ts
import { createSign } from 'node:crypto';

export type GitHubAppConfig = { appId: string; privateKey: string; slug: string; apiUrl?: string };
export type GitHubRepo = { fullName: string; defaultBranch: string; private: boolean };
export type GitHubClient = {
  installationToken(installationId: number): Promise<string>;
  listInstallationRepos(installationId: number): Promise<GitHubRepo[]>;
  getInstallation(installationId: number): Promise<{ accountLogin: string }>;
  installUrl(state: string): string;
};

const JWT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 540;
const DEFAULT_API = 'https://api.github.com';

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

export const createAppJwt = (config: GitHubAppConfig, now: Date = new Date()): string => {
  const iat = Math.floor(now.getTime() / 1000) - JWT_BACKDATE_SECONDS;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + JWT_LIFETIME_SECONDS, iss: config.appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(config.privateKey).toString('base64url')}`;
};

export const githubCloneUrl = (fullName: string, token: string) => `https://x-access-token:${token}@github.com/${fullName}.git`;

export const createGitHubClient = (config: GitHubAppConfig, fetchImpl: typeof fetch = fetch): GitHubClient => {
  const api = config.apiUrl ?? DEFAULT_API;
  const request = async <T>(path: string, authorization: string, method = 'GET'): Promise<T> => {
    const response = await fetchImpl(`${api}${path}`, {
      method,
      headers: { authorization, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'repository-designer' },
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.message ?? 'request failed'}`);
    return body as T;
  };
  const appAuth = () => `Bearer ${createAppJwt(config)}`;
  const installationToken = async (installationId: number) =>
    (await request<{ token: string }>(`/app/installations/${installationId}/access_tokens`, appAuth(), 'POST')).token;

  return {
    installationToken,
    async listInstallationRepos(installationId) {
      const token = await installationToken(installationId);
      const body = await request<{ repositories: { full_name: string; default_branch: string; private: boolean }[] }>('/installation/repositories?per_page=100', `token ${token}`);
      return body.repositories.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private }));
    },
    async getInstallation(installationId) {
      const body = await request<{ account: { login: string } }>(`/app/installations/${installationId}`, appAuth());
      return { accountLogin: body.account.login };
    },
    installUrl: (state) => `https://github.com/apps/${config.slug}/installations/new?state=${encodeURIComponent(state)}`,
  };
};
```

`packages/providers/src/signatures.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const STATE_MAX_AGE_MS = 15 * 60_000;
const SIGNATURE_PREFIX = 'sha256=';

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const verifyWebhookSignature = (secret: string, payload: string, header: string | undefined): boolean => {
  if (!header || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = `${SIGNATURE_PREFIX}${createHmac('sha256', secret).update(payload).digest('hex')}`;
  return safeEqual(expected, header);
};

const stateMac = (secret: string, orgId: string, issuedAt: number) => createHmac('sha256', secret).update(`${orgId}.${issuedAt}`).digest('base64url');

export const signState = (secret: string, orgId: string, now: Date = new Date()): string => {
  const issuedAt = now.getTime();
  return `${orgId}.${issuedAt}.${stateMac(secret, orgId, issuedAt)}`;
};

export const verifyState = (secret: string, state: string, now: Date = new Date(), maxAgeMs = STATE_MAX_AGE_MS): string | null => {
  const [orgId, issuedAtText, mac] = state.split('.');
  const issuedAt = Number(issuedAtText);
  if (!orgId || !mac || !Number.isFinite(issuedAt)) return null;
  if (!safeEqual(stateMac(secret, orgId, issuedAt), mac)) return null;
  return now.getTime() - issuedAt <= maxAgeMs && issuedAt <= now.getTime() ? orgId : null;
};
```

`packages/providers/src/demo.ts`:
```ts
import { join } from 'node:path';

export const DEMO_REPOS = [
  { fullName: 'acme-demo/shop-web', dir: 'shop-web', defaultBranch: 'main' },
  { fullName: 'acme-demo/shop-api', dir: 'shop-api', defaultBranch: 'main' },
  { fullName: 'acme-demo/shop-worker', dir: 'shop-worker', defaultBranch: 'main' },
];

export const isDemoRepo = (fullName: string): boolean => DEMO_REPOS.some((r) => r.fullName === fullName);

export const demoRepoPath = (fixturesDir: string, fullName: string): string | null => {
  const repo = DEMO_REPOS.find((r) => r.fullName === fullName);
  return repo ? join(fixturesDir, repo.dir) : null;
};
```

`packages/providers/src/materialize.ts`:
```ts
import { execFile } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

export type CloneSource = { kind: 'git'; url: string; branch: string } | { kind: 'local'; path: string };

const run = promisify(execFile);
const CLONE_TIMEOUT_MS = 120_000;

export const materialize = async (source: CloneSource, dest: string): Promise<void> => {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  if (source.kind === 'local') {
    await cp(source.path, dest, { recursive: true, filter: (path) => !path.includes('/node_modules/') });
    return;
  }
  try {
    await run('git', ['clone', '--quiet', '--depth', '1', '--single-branch', '--branch', source.branch, source.url, dest], {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    await rm(dest, { recursive: true, force: true });
    throw new Error('git clone failed');
  }
};
```

`packages/providers/src/index.ts`:
```ts
export * from './github';
export * from './signatures';
export * from './demo';
export * from './materialize';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/providers && npm run typecheck -w @rdi/providers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(providers): add GitHub App client, signatures, demo sources and cloning

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Indexing worker

**Files:**
- Create: `apps/worker/{package.json,tsconfig.json,vitest.integration.config.ts}`, `apps/worker/src/{config,repoStore,sources,pipeline,server}.ts`, `apps/worker/test/setup/globalSetup.ts`
- Test: `apps/worker/test/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: `@rdi/indexer`, `@rdi/graph`, `@rdi/providers`; Postgres tables from plan 3a.
- Produces:
  ```ts
  INDEX_QUEUE = 'index-repo'; type IndexJobData = { repoId: string; orgId: string; reason: 'added' | 'reindex' | 'push' }
  type WorkerConfig = { databaseUrl; redisUrl; neo4jUrl; neo4jUser; neo4jPassword; workDir: string; fixturesDir: string; github: GitHubAppConfig | null; concurrency: number }
  loadWorkerConfig(env?): WorkerConfig
  type IndexableRepo = { id; orgId; fullName; defaultBranch; githubInstallationId: number | null }
  loadRepo(pool, repoId): Promise<IndexableRepo | null>; saveProgress(pool, repoId, update: { status; stages; languages?; error?; lastSyncedAt? }): Promise<void>
  createSourceResolver({ fixturesDir, github: GitHubClient | null }): (repo: IndexableRepo) => Promise<CloneSource>
  runIndexJob(deps: { pool; graph: GraphStore; workDir: string; resolveSource }, repoId: string): Promise<'ready' | 'error' | 'missing'>
  ```

- [ ] **Step 1: Package setup**

`apps/worker/package.json`:
```json
{
  "name": "@rdi/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run --passWithNoTests",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": { "@rdi/indexer": "*", "@rdi/graph": "*", "@rdi/providers": "*" }
}
```
`apps/worker/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
```
`apps/worker/vitest.integration.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', testTimeout: 120_000, include: ['test/**/*.integration.test.ts'], globalSetup: ['./test/setup/globalSetup.ts'], fileParallelism: false },
});
```
Run:
```bash
npm install
npm install -w @rdi/worker bullmq ioredis pg
npm install -w @rdi/worker -D tsx vitest @types/node @types/pg
grep -E '"(bullmq|ioredis|pg)"' apps/worker/package.json
```

- [ ] **Step 2: Write the failing test**

`apps/worker/test/setup/globalSetup.ts`:
```ts
import { createPgPool } from '../../../api/src/checks';
import { ensureDatabase } from '../../../api/src/db/ensureDatabase';
import { runMigrations } from '../../../api/src/db/migrate';

export const WORKER_TEST_DB = process.env.WORKER_TEST_DATABASE_URL ?? 'postgres://rdi:rdi@localhost:5548/rdi_test';

export default async () => {
  await ensureDatabase(WORKER_TEST_DB);
  const pool = createPgPool(WORKER_TEST_DB);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
};
```

`apps/worker/test/pipeline.integration.test.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGraphStore } from '@rdi/graph';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runIndexJob } from '../src/pipeline';
import { createSourceResolver } from '../src/sources';
import { WORKER_TEST_DB } from './setup/globalSetup';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
const pool = new pg.Pool({ connectionString: WORKER_TEST_DB });
const graph = createGraphStore('bolt://localhost:7690', 'neo4j', 'rdi-dev-password');
let workDir: string;
let orgId: string;

const addRepo = async (fullName: string) =>
  (await pool.query<{ id: string }>("insert into repos (org_id, full_name, stages) values ($1, $2, '[]') returning id", [orgId, fullName])).rows[0]!.id;
const repoRow = async (id: string) => (await pool.query('select status, stages, languages, error, last_synced_at from repos where id = $1', [id])).rows[0];
const deps = () => ({ pool, graph, workDir, resolveSource: createSourceResolver({ fixturesDir: FIXTURES, github: null }) });

beforeAll(async () => {
  await graph.ensureSchema();
  workDir = await mkdtemp(join(tmpdir(), 'rdi-work-'));
  const user = (await pool.query<{ id: string }>("insert into users (email, name, password_hash) values ($1, 'W', 'h') returning id", [`w-${randomUUID()}@example.com`])).rows[0]!.id;
  orgId = (await pool.query<{ id: string }>("insert into orgs (name, slug) values ('W', $1) returning id", [`w-${randomUUID()}`])).rows[0]!.id;
  await pool.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')", [orgId, user]);
});

afterAll(async () => {
  const repos = (await pool.query<{ id: string }>('select id from repos where org_id = $1', [orgId])).rows;
  for (const r of repos) await graph.deleteRepo(orgId, r.id);
  await pool.query('delete from orgs where id = $1', [orgId]);
  await pool.end();
  await graph.close();
});

describe('runIndexJob', () => {
  it('indexes the demo repositories end to end and links them', async () => {
    const ids = [];
    for (const name of ['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']) ids.push(await addRepo(name));
    for (const id of ids) expect(await runIndexJob(deps(), id)).toBe('ready');
    const api = await repoRow(ids[1]!);
    expect(api.status).toBe('ready');
    expect(api.languages).toEqual(['TypeScript']);
    expect(api.stages.map((s: { name: string; status: string }) => `${s.name}:${s.status}`)).toEqual(['clone:done', 'parse:done', 'detect:done', 'summarize:done', 'link:done']);
    expect(api.stages[2].detail).toBe('2 endpoints · 1 queues · 1 tables');
    expect(api.last_synced_at).not.toBeNull();
    const org = await graph.readOrgGraph(orgId);
    expect(org.edges.filter((e) => e.type === 'CALLS_HTTP')).toHaveLength(2);
    expect(org.nodes.filter((n) => n.label === 'Service').map((n) => n.name).sort()).toEqual(['shop-api', 'shop-web', 'shop-worker']);
  });

  it('marks the failing stage and keeps no partial graph', async () => {
    const id = await addRepo('acme-demo/does-not-exist');
    expect(await runIndexJob(deps(), id)).toBe('error');
    const row = await repoRow(id);
    expect(row.status).toBe('error');
    expect(row.stages[0]).toMatchObject({ name: 'clone', status: 'error' });
    expect(row.error).toMatch(/not a known demo repository/);
    expect((await graph.readOrgGraph(orgId)).nodes.some((n) => n.repoId === id)).toBe(false);
  });

  it('reports missing repositories', async () => {
    expect(await runIndexJob(deps(), randomUUID())).toBe('missing');
  });
});
```

Run: `npm run test:integration -w @rdi/worker`
Expected: FAIL — `../src/pipeline` not found.

- [ ] **Step 3: Implement**

`apps/worker/src/config.ts`:
```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GitHubAppConfig } from '@rdi/providers';

export const INDEX_QUEUE = 'index-repo';
export type IndexJobData = { repoId: string; orgId: string; reason: 'added' | 'reindex' | 'push' };

export type WorkerConfig = {
  databaseUrl: string; redisUrl: string; neo4jUrl: string; neo4jUser: string; neo4jPassword: string;
  workDir: string; fixturesDir: string; github: GitHubAppConfig | null; concurrency: number;
};

const DEFAULT_FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
const DEFAULT_CONCURRENCY = 2;

export const loadWorkerConfig = (env: NodeJS.ProcessEnv = process.env): WorkerConfig => {
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://rdi:rdi@localhost:5548/rdi',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6391',
    neo4jUrl: env.NEO4J_URL ?? 'bolt://localhost:7690',
    neo4jUser: env.NEO4J_USER ?? 'neo4j',
    neo4jPassword: env.NEO4J_PASSWORD ?? 'rdi-dev-password',
    workDir: env.WORK_DIR ?? join(tmpdir(), 'rdi-work'),
    fixturesDir: env.FIXTURES_DIR ?? DEFAULT_FIXTURES,
    github: env.GITHUB_APP_ID && privateKey && env.GITHUB_APP_SLUG ? { appId: env.GITHUB_APP_ID, privateKey, slug: env.GITHUB_APP_SLUG } : null,
    concurrency: Number(env.WORKER_CONCURRENCY ?? DEFAULT_CONCURRENCY),
  };
};
```

`apps/worker/src/repoStore.ts`:
```ts
import type pg from 'pg';

export type StageName = 'clone' | 'parse' | 'detect' | 'summarize' | 'link';
export type Stage = { name: StageName; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string };
export type IndexableRepo = { id: string; orgId: string; fullName: string; defaultBranch: string; githubInstallationId: number | null };

export const loadRepo = async (pool: pg.Pool, repoId: string): Promise<IndexableRepo | null> => {
  const row = (
    await pool.query<{ id: string; org_id: string; full_name: string; default_branch: string; gh: string | null }>(
      'select r.id, r.org_id, r.full_name, r.default_branch, gi.installation_id::text as gh from repos r left join github_installations gi on gi.id = r.installation_id where r.id = $1',
      [repoId],
    )
  ).rows[0];
  return row ? { id: row.id, orgId: row.org_id, fullName: row.full_name, defaultBranch: row.default_branch, githubInstallationId: row.gh ? Number(row.gh) : null } : null;
};

export const saveProgress = async (
  pool: pg.Pool,
  repoId: string,
  update: { status: 'pending' | 'indexing' | 'ready' | 'error'; stages: Stage[]; languages?: string[]; error?: string | null; lastSyncedAt?: Date },
): Promise<void> => {
  await pool.query(
    `update repos set status = $2, stages = $3, languages = coalesce($4, languages), error = $5, last_synced_at = coalesce($6, last_synced_at) where id = $1`,
    [repoId, update.status, JSON.stringify(update.stages), update.languages ?? null, update.error ?? null, update.lastSyncedAt ?? null],
  );
};
```

`apps/worker/src/sources.ts`:
```ts
import { demoRepoPath, githubCloneUrl, isDemoRepo, type CloneSource, type GitHubClient } from '@rdi/providers';
import type { IndexableRepo } from './repoStore';

export const createSourceResolver = ({ fixturesDir, github }: { fixturesDir: string; github: GitHubClient | null }) =>
  async (repo: IndexableRepo): Promise<CloneSource> => {
    if (repo.githubInstallationId !== null) {
      if (!github) throw new Error('GitHub App is not configured on the worker');
      const token = await github.installationToken(repo.githubInstallationId);
      return { kind: 'git', url: githubCloneUrl(repo.fullName, token), branch: repo.defaultBranch };
    }
    const path = isDemoRepo(repo.fullName) ? demoRepoPath(fixturesDir, repo.fullName) : null;
    if (!path) throw new Error(`${repo.fullName} is not a known demo repository`);
    return { kind: 'local', path };
  };
```

`apps/worker/src/pipeline.ts`:
```ts
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { relinkOrg, type GraphStore } from '@rdi/graph';
import { buildRepoGraph, describeDetections, detect, parseRepository, walkRepository, type Detections, type FileFacts, type RepoGraph, type WalkResult } from '@rdi/indexer';
import { materialize, type CloneSource } from '@rdi/providers';
import type pg from 'pg';
import { loadRepo, saveProgress, type IndexableRepo, type Stage, type StageName } from './repoStore';

type PipelineDeps = { pool: pg.Pool; graph: GraphStore; workDir: string; resolveSource: (repo: IndexableRepo) => Promise<CloneSource> };

const STAGE_NAMES: StageName[] = ['clone', 'parse', 'detect', 'summarize', 'link'];
const TRUNCATED_NOTE = ' (truncated at 500k LOC)';

export const runIndexJob = async (deps: PipelineDeps, repoId: string): Promise<'ready' | 'error' | 'missing'> => {
  const repo = await loadRepo(deps.pool, repoId);
  if (!repo) return 'missing';
  const stages: Stage[] = STAGE_NAMES.map((name) => ({ name, status: 'pending' }));
  const dir = join(deps.workDir, repo.id);
  const save = (status: 'indexing' | 'ready' | 'error', extra: { languages?: string[]; error?: string | null; lastSyncedAt?: Date } = {}) =>
    saveProgress(deps.pool, repo.id, { status, stages: stages.map((s) => ({ ...s })), ...extra });
  const stage = async <T>(name: StageName, work: () => Promise<T>, detail?: (result: T) => string): Promise<T> => {
    const current = stages.find((s) => s.name === name)!;
    current.status = 'running';
    await save('indexing');
    const result = await work();
    current.status = 'done';
    if (detail) current.detail = detail(result);
    await save('indexing');
    return result;
  };

  try {
    await stage('clone', async () => materialize(await deps.resolveSource(repo), dir));
    const { walk, facts } = await stage('parse', async () => {
      const w: WalkResult = await walkRepository(dir);
      const f: FileFacts[] = await parseRepository(w.files);
      return { walk: w, facts: f };
    }, ({ walk: w }) => `${w.files.length} files · ${w.totalLoc} LOC${w.truncated ? TRUNCATED_NOTE : ''}`);
    const detections = await stage('detect', async (): Promise<Detections> => detect(facts), describeDetections);
    const graph = await stage('summarize', async (): Promise<RepoGraph> => buildRepoGraph({ orgId: repo.orgId, repoId: repo.id, fullName: repo.fullName, walk, facts, detections }), (g) => `${g.nodes.length} pieces`);
    await stage('link', async () => {
      await deps.graph.writeRepoGraph(repo.orgId, repo.id, graph);
      return relinkOrg(deps.graph, repo.orgId);
    }, (links) => `${links} cross-repo links`);
    await save('ready', { languages: walk.languages, error: null, lastSyncedAt: new Date() });
    return 'ready';
  } catch (error) {
    const failed = stages.find((s) => s.status === 'running');
    if (failed) failed.status = 'error';
    const message = error instanceof Error ? error.message : String(error);
    if (failed) failed.detail = message;
    await save('error', { error: message });
    return 'error';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
```

`apps/worker/src/server.ts`:
```ts
import { createGraphStore } from '@rdi/graph';
import { createGitHubClient } from '@rdi/providers';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { INDEX_QUEUE, loadWorkerConfig, type IndexJobData } from './config';
import { runIndexJob } from './pipeline';
import { createSourceResolver } from './sources';

const POOL_SIZE = 5;
const config = loadWorkerConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: POOL_SIZE });
pool.on('error', () => {});
const graph = createGraphStore(config.neo4jUrl, config.neo4jUser, config.neo4jPassword);
await graph.ensureSchema();
const resolveSource = createSourceResolver({ fixturesDir: config.fixturesDir, github: config.github ? createGitHubClient(config.github) : null });
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<IndexJobData>(
  INDEX_QUEUE,
  async (job) => {
    const result = await runIndexJob({ pool, graph, workDir: config.workDir, resolveSource }, job.data.repoId);
    console.log(`[worker] ${job.data.reason} ${job.data.repoId} → ${result}`);
    return result;
  },
  { connection, concurrency: config.concurrency },
);

const shutdown = async () => {
  await worker.close();
  await graph.close();
  await pool.end();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log(`worker listening on queue ${INDEX_QUEUE}`);
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run test:integration -w @rdi/worker && npm run typecheck -w @rdi/worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(worker): add the indexing pipeline worker

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: API — index queue, GitHub integration, repository routes, system map

**Files:**
- Create: `apps/api/src/queue/indexQueue.ts`, `apps/api/src/db/queries/github.ts`, `apps/api/src/routes/repos.ts`, `apps/api/src/routes/github.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/http/deps.ts`, `apps/api/src/db/queries/repos.ts`, `apps/api/src/routes/orgs.ts` (usage pieces), `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/helpers.ts`, `apps/api/test/health.test.ts`
- Test: `apps/api/test/repos.integration.test.ts`, `apps/api/test/github.integration.test.ts`

**Interfaces:**
- Config additions: `demoRepos: boolean` (`DEMO_REPOS`, default true, always false in production), `github: { appId; privateKey; slug; webhookSecret; stateSecret } | null`.
- Deps additions: `graph?: GraphStore; indexQueue?: IndexQueue; github?: GitHubClient | null`.
- `type IndexQueue = { enqueue(job: IndexJobData): Promise<void>; close(): Promise<void> }`; `createIndexQueue(redisUrl): IndexQueue`.
- Queries: `upsertInstallation(db, { orgId, installationId, accountLogin }): Promise<{ id: string }>`, `findInstallationForOrg(db, orgId)`, `findReposForInstallationAndName(db, installationId, fullName)`, `insertPendingRepo(db, { orgId, fullName, defaultBranch, installationRowId })`, `resetRepoStages(db, orgId, repoId)`, `deleteRepoRow(db, orgId, repoId)`, `findRepo(db, orgId, repoId)`, `PENDING_STAGES`.
- Routes:
  - `GET /api/orgs/:orgId/integrations` → `{ github: { configured, installation: { accountLogin } | null }, demo: { available } }`
  - `GET /api/orgs/:orgId/github/install-url` (repos.manage) → `{ url }` · 409 `github_not_configured`
  - `GET /api/github/setup?installation_id=&state=` (auth) → 302 to `${appUrl}/orgs/:orgId/settings/repositories?connected=github` · 400 `invalid_state`
  - `POST /api/github/webhook` (HMAC) → 202 · 401 `invalid_signature`
  - `GET /api/orgs/:orgId/available-repos` → `[{ fullName, defaultBranch, source: 'github' | 'demo' }]` (already-added excluded)
  - `POST /api/orgs/:orgId/repos {fullName}` (repos.manage) → 201 repo · 409 `repo_limit` · 404 `not_found` (not available)
  - `POST /api/orgs/:orgId/repos/:repoId/reindex` (repos.manage) → 202
  - `DELETE /api/orgs/:orgId/repos/:repoId` (repos.manage) → 204 (graph data removed, org relinked)
  - `GET /api/orgs/:orgId/system-map` → Scene v2 · 404 `not_found`
  - `GET /api/orgs/:orgId/usage` → `pieces` from the graph

- [ ] **Step 1: Dependencies**

Run:
```bash
npm install -w @rdi/api bullmq
node -e "const p=require('./apps/api/package.json');p.dependencies={...p.dependencies,'@rdi/graph':'*','@rdi/indexer':'*','@rdi/providers':'*'};require('fs').writeFileSync('apps/api/package.json',JSON.stringify(p,null,2)+'\n')"
npm install
```

- [ ] **Step 2: Write the failing tests**

Update the exact-object `loadConfig` expectation in `apps/api/test/health.test.ts` by adding `demoRepos: true, github: null,` and append:
```ts
  it('reads GitHub App settings only when complete and never offers demo repos in production', () => {
    const env = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'k\\nk', GITHUB_APP_SLUG: 's', GITHUB_WEBHOOK_SECRET: 'w', GITHUB_STATE_SECRET: 'st' };
    expect(loadConfig(env).github).toEqual({ appId: '1', privateKey: 'k\nk', slug: 's', webhookSecret: 'w', stateSecret: 'st' });
    expect(loadConfig({ GITHUB_APP_ID: '1' }).github).toBeNull();
    expect(loadConfig({ NODE_ENV: 'production', DEMO_REPOS: 'true' }).demoRepos).toBe(false);
  });
```

In `apps/api/test/helpers.ts`, extend `createTestContext` to build a real graph store and a recording queue, and expose them:
```ts
import { createGraphStore } from '@rdi/graph';
import type { IndexJobData } from '../src/queue/indexQueue';
// inside createTestContext, before buildApp:
  const graph = createGraphStore('bolt://localhost:7690', 'neo4j', 'rdi-dev-password');
  await graph.ensureSchema();
  const jobs: IndexJobData[] = [];
  const indexQueue = { enqueue: async (job: IndexJobData) => { jobs.push(job); }, close: async () => {} };
  const github = { client: null as import('@rdi/providers').GitHubClient | null };
// buildApp deps become: { config, pool, redis, mailer, graph, indexQueue, github: null }
// reset(): also `jobs.length = 0;`
// close(): also `await graph.close();`
// return: { app, pool, redis, mailer, config, graph, jobs, reset, close }
```
(Full replacement of the file is listed in Step 3 so the executor has exact text.)

`apps/api/test/repos.integration.test.ts`:
```ts
import { buildRepoGraph, detect, parseRepository, walkRepository } from '@rdi/indexer';
import { relinkOrg } from '@rdi/graph';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

type Who = Awaited<ReturnType<typeof signupVerified>>;
const call = (who: Who, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: method === 'GET' ? { cookie: who.cookie } : authed(who), ...(payload === undefined ? {} : { payload: payload as object }) });
const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await call(owner, 'POST', '/api/orgs', { name: 'Acme' })).json();
  return { owner, org };
};
const writeFixtureGraph = async (orgId: string, repoId: string, dir: string) => {
  const walk = await walkRepository(`${FIXTURES}/${dir}`);
  const facts = await parseRepository(walk.files);
  await ctx.graph.writeRepoGraph(orgId, repoId, buildRepoGraph({ orgId, repoId, fullName: `acme-demo/${dir}`, walk, facts, detections: detect(facts) }));
};

describe('integrations and available repositories', () => {
  it('reports GitHub as not configured and offers the demo repositories', async () => {
    const { owner, org } = await setup();
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/integrations`)).json()).toEqual({ github: { configured: false, installation: null }, demo: { available: true } });
    const available = (await call(owner, 'GET', `/api/orgs/${org.id}/available-repos`)).json();
    expect(available.map((r: { fullName: string }) => r.fullName)).toEqual(['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/github/install-url`)).json()).toEqual({ error: { code: 'github_not_configured' } });
  });
});

describe('adding, reindexing and removing repositories', () => {
  it('adds an available repo as pending with all stages pending and enqueues indexing', async () => {
    const { owner, org } = await setup();
    const res = await call(owner, 'POST', `/api/orgs/${org.id}/repos`, { fullName: 'acme-demo/shop-api' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ fullName: 'acme-demo/shop-api', status: 'pending', stages: [{ name: 'clone', status: 'pending' }, { name: 'parse', status: 'pending' }, { name: 'detect', status: 'pending' }, { name: 'summarize', status: 'pending' }, { name: 'link', status: 'pending' }] });
    expect(ctx.jobs).toEqual([{ repoId: res.json().id, orgId: org.id, reason: 'added' }]);
    const available = (await call(owner, 'GET', `/api/orgs/${org.id}/available-repos`)).json();
    expect(available.map((r: { fullName: string }) => r.fullName)).not.toContain('acme-demo/shop-api');
  });

  it('rejects unknown repositories and members without permission', async () => {
    const { owner, org } = await setup();
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/repos`, { fullName: 'someone/else' })).json()).toEqual({ error: { code: 'not_found' } });
    const stranger = await signupVerified(ctx);
    expect((await call(stranger, 'POST', `/api/orgs/${org.id}/repos`, { fullName: 'acme-demo/shop-api' })).statusCode).toBe(404);
  });

  it('enforces the repository limit', async () => {
    const { owner, org } = await setup();
    for (let i = 0; i < 10; i++) await ctx.pool.query("insert into repos (org_id, full_name) values ($1, $2)", [org.id, `x/r${i}`]);
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/repos`, { fullName: 'acme-demo/shop-web' })).json()).toEqual({ error: { code: 'repo_limit' } });
  });

  it('reindexes and deletes, removing graph data and stale links', async () => {
    const { owner, org } = await setup();
    const web = (await call(owner, 'POST', `/api/orgs/${org.id}/repos`, { fullName: 'acme-demo/shop-web' })).json();
    const api = (await call(owner, 'POST', `/api/orgs/${org.id}/repos`, { fullName: 'acme-demo/shop-api' })).json();
    await writeFixtureGraph(org.id, web.id, 'shop-web');
    await writeFixtureGraph(org.id, api.id, 'shop-api');
    expect(await relinkOrg(ctx.graph, org.id)).toBe(2);
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/repos/${api.id}/reindex`, {})).statusCode).toBe(202);
    expect(ctx.jobs.at(-1)).toEqual({ repoId: api.id, orgId: org.id, reason: 'reindex' });
    expect((await call(owner, 'DELETE', `/api/orgs/${org.id}/repos/${api.id}`)).statusCode).toBe(204);
    const graph = await ctx.graph.readOrgGraph(org.id);
    expect(graph.nodes.some((n) => n.repoId === api.id)).toBe(false);
    expect(graph.edges.some((e) => e.type === 'CALLS_HTTP')).toBe(false);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/repos`)).json().map((r: { id: string }) => r.id)).toEqual([web.id]);
    await ctx.graph.deleteRepo(org.id, web.id);
  });
});

describe('system map and usage', () => {
  it('serves the generated scene and counts indexed pieces', async () => {
    const { owner, org } = await setup();
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/system-map`)).statusCode).toBe(404);
    await writeFixtureGraph(org.id, `${org.id}-web`, 'shop-web');
    await writeFixtureGraph(org.id, `${org.id}-api`, 'shop-api');
    await relinkOrg(ctx.graph, org.id);
    const scene = (await call(owner, 'GET', `/api/orgs/${org.id}/system-map`)).json();
    expect(scene).toMatchObject({ id: 'system-map', language: 'en' });
    expect(scene.steps[0].narration).toBe('shop-web calls POST /api/orders on shop-api.');
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/usage`)).json().pieces).toBeGreaterThan(10);
    await ctx.graph.deleteRepo(org.id, `${org.id}-web`);
    await ctx.graph.deleteRepo(org.id, `${org.id}-api`);
  });
});
```

`apps/api/test/github.integration.test.ts`:
```ts
import { createHmac } from 'node:crypto';
import { signState } from '@rdi/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

const GITHUB = { appId: '1', privateKey: 'unused', slug: 'repo-designer', webhookSecret: 'whsec', stateSecret: 'state-secret' };
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({
    github: GITHUB,
    githubClient: {
      installationToken: async () => 'ghs_x',
      listInstallationRepos: async () => [{ fullName: 'acme/api', defaultBranch: 'main', private: true }],
      getInstallation: async () => ({ accountLogin: 'acme' }),
      installUrl: (state: string) => `https://github.com/apps/repo-designer/installations/new?state=${state}`,
    },
  });
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};
const signed = (body: string, secret = 'whsec') => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('GitHub App flow', () => {
  it('returns an install url with a signed state', async () => {
    const { owner, org } = await setup();
    const { url } = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/github/install-url`, headers: { cookie: owner.cookie } })).json();
    expect(url).toMatch(new RegExp(`^https://github.com/apps/repo-designer/installations/new\\?state=${org.id}\\.`));
  });

  it('stores the installation from the setup callback and lists its repositories', async () => {
    const { owner, org } = await setup();
    const state = signState('state-secret', org.id);
    const res = await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=4242&state=${encodeURIComponent(state)}`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`http://localhost:5177/orgs/${org.id}/settings/repositories?connected=github`);
    const integrations = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/integrations`, headers: { cookie: owner.cookie } })).json();
    expect(integrations.github).toEqual({ configured: true, installation: { accountLogin: 'acme' } });
    const available = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/available-repos`, headers: { cookie: owner.cookie } })).json();
    expect(available).toEqual([{ fullName: 'acme/api', defaultBranch: 'main', source: 'github' }]);
  });

  it('rejects forged or foreign state', async () => {
    const { owner, org } = await setup();
    const forged = await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=1&state=${org.id}.1.bad`, headers: { cookie: owner.cookie } });
    expect(forged.json()).toEqual({ error: { code: 'invalid_state' } });
    const other = await setup();
    const foreign = await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=1&state=${encodeURIComponent(signState('state-secret', other.org.id))}`, headers: { cookie: owner.cookie } });
    expect(foreign.statusCode).toBe(404);
  });

  it('verifies webhook signatures and enqueues re-indexing on pushes to the default branch', async () => {
    const { owner, org } = await setup();
    const state = signState('state-secret', org.id);
    await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=4242&state=${encodeURIComponent(state)}`, headers: { cookie: owner.cookie } });
    const repo = (await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/repos`, headers: authed(owner), payload: { fullName: 'acme/api' } })).json();
    ctx.jobs.length = 0;
    const body = JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: 'acme/api', default_branch: 'main' }, installation: { id: 4242 } });
    const headers = { 'content-type': 'application/json', 'x-github-event': 'push' };
    expect((await ctx.app.inject({ method: 'POST', url: '/api/github/webhook', headers: { ...headers, 'x-hub-signature-256': signed(body, 'wrong') }, payload: body })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/github/webhook', headers, payload: body })).statusCode).toBe(401);
    expect(ctx.jobs).toEqual([]);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/github/webhook', headers: { ...headers, 'x-hub-signature-256': signed(body) }, payload: body })).statusCode).toBe(202);
    expect(ctx.jobs).toEqual([{ repoId: repo.id, orgId: org.id, reason: 'push' }]);
    const other = JSON.stringify({ ref: 'refs/heads/feature', repository: { full_name: 'acme/api', default_branch: 'main' }, installation: { id: 4242 } });
    await ctx.app.inject({ method: 'POST', url: '/api/github/webhook', headers: { ...headers, 'x-hub-signature-256': signed(other) }, payload: other });
    expect(ctx.jobs).toHaveLength(1);
  });
});
```

Run: `npm test -w @rdi/api; npm run test:integration -w @rdi/api`
Expected: FAIL — config fields, helpers options and routes missing.

- [ ] **Step 3: Implement**

`apps/api/src/config.ts` — add to `Config`:
```ts
  demoRepos: boolean;
  github: { appId: string; privateKey: string; slug: string; webhookSecret: string; stateSecret: string } | null;
```
add to `DEFAULTS`: `DEMO_REPOS: 'true',`; and in the returned object:
```ts
    demoRepos: !production && read('DEMO_REPOS') !== 'false',
    github: readGithub(env),
```
with, above `loadConfig`:
```ts
const readGithub = (env: NodeJS.ProcessEnv): Config['github'] => {
  const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG, GITHUB_WEBHOOK_SECRET, GITHUB_STATE_SECRET } = env;
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !GITHUB_APP_SLUG || !GITHUB_WEBHOOK_SECRET || !GITHUB_STATE_SECRET) return null;
  return { appId: GITHUB_APP_ID, privateKey: GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'), slug: GITHUB_APP_SLUG, webhookSecret: GITHUB_WEBHOOK_SECRET, stateSecret: GITHUB_STATE_SECRET };
};
```

`apps/api/src/queue/indexQueue.ts`:
```ts
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const INDEX_QUEUE = 'index-repo';
export type IndexJobData = { repoId: string; orgId: string; reason: 'added' | 'reindex' | 'push' };
export type IndexQueue = { enqueue(job: IndexJobData): Promise<void>; close(): Promise<void> };

export const createIndexQueue = (redisUrl: string): IndexQueue => {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<IndexJobData>(INDEX_QUEUE, { connection });
  return {
    async enqueue(job) {
      await queue.add(job.reason, job, { jobId: `${job.repoId}-${Date.now()}`, removeOnComplete: true, removeOnFail: 100 });
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
};
```

`apps/api/src/http/deps.ts`:
```ts
import type { GraphStore } from '@rdi/graph';
import type { GitHubClient } from '@rdi/providers';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../config';
import type { Mailer } from '../mail/mailer';
import type { IndexQueue } from '../queue/indexQueue';

export type AppDeps = { config: Config; pool: pg.Pool; redis: Redis; mailer: Mailer; now?: () => Date; graph?: GraphStore; indexQueue?: IndexQueue; github?: GitHubClient | null };

export const nowOf = (deps: AppDeps): Date => deps.now?.() ?? new Date();
```

`apps/api/src/db/queries/github.ts`:
```ts
import type { Db } from './users';

export type InstallationRow = { id: string; org_id: string; installation_id: string; account_login: string };

export const upsertInstallation = async (db: Db, input: { orgId: string; installationId: number; accountLogin: string }): Promise<InstallationRow> =>
  (
    await db.query<InstallationRow>(
      `insert into github_installations (org_id, installation_id, account_login) values ($1, $2, $3)
       on conflict (installation_id) do update set org_id = excluded.org_id, account_login = excluded.account_login
       returning id, org_id, installation_id::text, account_login`,
      [input.orgId, input.installationId, input.accountLogin],
    )
  ).rows[0]!;

export const findInstallationForOrg = async (db: Db, orgId: string): Promise<InstallationRow | null> =>
  (await db.query<InstallationRow>('select id, org_id, installation_id::text, account_login from github_installations where org_id = $1 order by created_at desc limit 1', [orgId])).rows[0] ?? null;

export const findReposForInstallationAndName = async (db: Db, installationId: number, fullName: string): Promise<{ id: string; org_id: string; default_branch: string }[]> =>
  (
    await db.query<{ id: string; org_id: string; default_branch: string }>(
      'select r.id, r.org_id, r.default_branch from repos r join github_installations gi on gi.id = r.installation_id where gi.installation_id = $1 and r.full_name = $2',
      [installationId, fullName],
    )
  ).rows;
```

Append to `apps/api/src/db/queries/repos.ts`:
```ts
export const PENDING_STAGES: RepoStage[] = (['clone', 'parse', 'detect', 'summarize', 'link'] as const).map((name) => ({ name, status: 'pending' }));

export const findRepo = async (db: Db, orgId: string, repoId: string): Promise<RepoRow | null> =>
  (await db.query<RepoRow>('select * from repos where org_id = $1 and id = $2', [orgId, repoId])).rows[0] ?? null;

export const insertPendingRepo = async (db: Db, input: { orgId: string; fullName: string; defaultBranch: string; installationRowId: string | null }): Promise<RepoRow> =>
  (
    await db.query<RepoRow>(
      `insert into repos (org_id, installation_id, full_name, default_branch, status, stages)
       values ($1, $2, $3, $4, 'pending', $5)
       on conflict (org_id, full_name) do update set status = 'pending', stages = excluded.stages, error = null
       returning *`,
      [input.orgId, input.installationRowId, input.fullName, input.defaultBranch, JSON.stringify(PENDING_STAGES)],
    )
  ).rows[0]!;

export const resetRepoStages = async (db: Db, orgId: string, repoId: string): Promise<number> =>
  (await db.query("update repos set status = 'pending', stages = $3, error = null where org_id = $1 and id = $2", [orgId, repoId, JSON.stringify(PENDING_STAGES)])).rowCount ?? 0;

export const deleteRepoRow = async (db: Db, orgId: string, repoId: string): Promise<number> =>
  (await db.query('delete from repos where org_id = $1 and id = $2', [orgId, repoId])).rowCount ?? 0;
```

`apps/api/src/routes/repos.ts`:
```ts
import { relinkOrg } from '@rdi/graph';
import { buildSystemMap } from '@rdi/indexer';
import { DEMO_REPOS } from '@rdi/providers';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPO_LIMIT } from '../domain/constants';
import { findInstallationForOrg } from '../db/queries/github';
import { countRepos, deleteRepoRow, findRepo, insertPendingRepo, listRepos, resetRepoStages } from '../db/queries/repos';
import { fail, isUuid, requireAction, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';
import { publicRepo } from '../http/payloads';

type Available = { fullName: string; defaultBranch: string; source: 'github' | 'demo' };
const MAX_REPO_NAME = 200;

export const repoRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const manage = [...member, requireAction('repos.manage')];

  const availableFor = async (orgId: string): Promise<{ repos: Available[]; installationRowId: string | null }> => {
    const installation = await findInstallationForOrg(deps.pool, orgId);
    if (installation && deps.github) {
      const repos = await deps.github.listInstallationRepos(Number(installation.installation_id));
      return { repos: repos.map((r) => ({ fullName: r.fullName, defaultBranch: r.defaultBranch, source: 'github' as const })), installationRowId: installation.id };
    }
    const repos = deps.config.demoRepos ? DEMO_REPOS.map((r) => ({ fullName: r.fullName, defaultBranch: r.defaultBranch, source: 'demo' as const })) : [];
    return { repos, installationRowId: null };
  };

  api.get('/orgs/:orgId/integrations', { preHandler: member }, async (req) => {
    const installation = await findInstallationForOrg(deps.pool, req.member!.org.id);
    return {
      github: { configured: Boolean(deps.config.github && deps.github), installation: installation ? { accountLogin: installation.account_login } : null },
      demo: { available: deps.config.demoRepos },
    };
  });

  api.get('/orgs/:orgId/available-repos', { preHandler: member }, async (req) => {
    const orgId = req.member!.org.id;
    const existing = new Set((await listRepos(deps.pool, orgId)).map((r) => r.full_name));
    return (await availableFor(orgId)).repos.filter((r) => !existing.has(r.fullName));
  });

  api.post('/orgs/:orgId/repos', { preHandler: manage }, async (req, reply) => {
    const { fullName } = z.object({ fullName: z.string().min(1).max(MAX_REPO_NAME) }).parse(req.body);
    const orgId = req.member!.org.id;
    const { repos, installationRowId } = await availableFor(orgId);
    const chosen = repos.find((r) => r.fullName === fullName);
    if (!chosen) return fail(reply, 404, 'not_found');
    if ((await countRepos(deps.pool, orgId)) >= REPO_LIMIT) return fail(reply, 409, 'repo_limit');
    const repo = await insertPendingRepo(deps.pool, { orgId, fullName, defaultBranch: chosen.defaultBranch, installationRowId: chosen.source === 'github' ? installationRowId : null });
    await deps.indexQueue?.enqueue({ repoId: repo.id, orgId, reason: 'added' });
    return reply.code(201).send(publicRepo(repo));
  });

  api.post('/orgs/:orgId/repos/:repoId/reindex', { preHandler: manage }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const orgId = req.member!.org.id;
    if (!isUuid(repoId) || (await resetRepoStages(deps.pool, orgId, repoId)) === 0) return fail(reply, 404, 'not_found');
    await deps.indexQueue?.enqueue({ repoId, orgId, reason: 'reindex' });
    return reply.code(202).send({ ok: true });
  });

  api.delete('/orgs/:orgId/repos/:repoId', { preHandler: manage }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const orgId = req.member!.org.id;
    if (!isUuid(repoId) || !(await findRepo(deps.pool, orgId, repoId))) return fail(reply, 404, 'not_found');
    await deleteRepoRow(deps.pool, orgId, repoId);
    if (deps.graph) {
      await deps.graph.deleteRepo(orgId, repoId);
      await relinkOrg(deps.graph, orgId);
    }
    return reply.code(204).send();
  });

  api.get('/orgs/:orgId/system-map', { preHandler: member }, async (req, reply) => {
    if (!deps.graph) return fail(reply, 404, 'not_found');
    const scene = buildSystemMap(await deps.graph.readOrgGraph(req.member!.org.id));
    return scene ?? fail(reply, 404, 'not_found');
  });
};
```

`apps/api/src/routes/github.ts`:
```ts
import { signState, verifyState, verifyWebhookSignature } from '@rdi/providers';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can } from '../domain/roles';
import { findReposForInstallationAndName, upsertInstallation } from '../db/queries/github';
import { findMembership } from '../db/queries/orgs';
import { fail, requireAction, requireAuth, requireMember } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';

const setupQuery = z.object({ installation_id: z.coerce.number().int().positive(), state: z.string().min(1).max(500) });
const pushPayload = z.object({ ref: z.string(), repository: z.object({ full_name: z.string(), default_branch: z.string() }), installation: z.object({ id: z.number() }) });

export const githubRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/orgs/:orgId/github/install-url', { preHandler: [requireAuth, requireMember(deps), requireAction('repos.manage')] }, async (req, reply) => {
    if (!deps.config.github || !deps.github) return fail(reply, 409, 'github_not_configured');
    return { url: deps.github.installUrl(signState(deps.config.github.stateSecret, req.member!.org.id, nowOf(deps))) };
  });

  api.get('/github/setup', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.config.github || !deps.github) return fail(reply, 409, 'github_not_configured');
    const query = setupQuery.parse(req.query);
    const orgId = verifyState(deps.config.github.stateSecret, query.state, nowOf(deps));
    if (!orgId) return fail(reply, 400, 'invalid_state');
    const membership = await findMembership(deps.pool, orgId, req.auth!.user.id);
    if (!membership || !can(membership.role, 'repos.manage')) return fail(reply, 404, 'not_found');
    const installation = await deps.github.getInstallation(query.installation_id);
    await upsertInstallation(deps.pool, { orgId, installationId: query.installation_id, accountLogin: installation.accountLogin });
    return reply.redirect(`${deps.config.appUrl}/orgs/${orgId}/settings/repositories?connected=github`, 302);
  });

  api.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hooks.post('/github/webhook', async (req, reply) => {
      const secret = deps.config.github?.webhookSecret;
      const raw = typeof req.body === 'string' ? req.body : '';
      const signature = req.headers['x-hub-signature-256'];
      if (!secret || !verifyWebhookSignature(secret, raw, typeof signature === 'string' ? signature : undefined)) return fail(reply, 401, 'invalid_signature');
      if (req.headers['x-github-event'] !== 'push') return reply.code(202).send({ ok: true });
      const parsed = pushPayload.safeParse(JSON.parse(raw));
      if (!parsed.success) return reply.code(202).send({ ok: true });
      const { ref, repository, installation } = parsed.data;
      if (ref !== `refs/heads/${repository.default_branch}`) return reply.code(202).send({ ok: true });
      for (const repo of await findReposForInstallationAndName(deps.pool, installation.id, repository.full_name)) {
        await deps.indexQueue?.enqueue({ repoId: repo.id, orgId: repo.org_id, reason: 'push' });
      }
      return reply.code(202).send({ ok: true });
    });
  });
};
```

In `apps/api/src/routes/orgs.ts`, change the usage handler to:
```ts
  api.get('/orgs/:orgId/usage', { preHandler: member }, async (req) => ({
    repos: await countRepos(deps.pool, req.member!.org.id),
    repoLimit: REPO_LIMIT,
    pieces: deps.graph ? await deps.graph.countOrgNodes(req.member!.org.id) : 0,
  }));
```

In `apps/api/src/app.ts` import `repoRoutes` and `githubRoutes` and register them after `invitationRoutes(api, deps);`:
```ts
        repoRoutes(api, deps);
        githubRoutes(api, deps);
```
Also remove the now-duplicated `GET /orgs/:orgId/repos` from `orgs.ts` only if `repoRoutes` also registers it — it does not; keep the plan-3a list route in `orgs.ts`.

`apps/api/test/helpers.ts` (full replacement):
```ts
import { createGraphStore } from '@rdi/graph';
import type { GitHubClient } from '@rdi/providers';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { createPgPool, createRedisClient } from '../src/checks';
import { loadConfig, type Config } from '../src/config';
import { createDevMailer } from '../src/mail/mailer';
import type { IndexJobData } from '../src/queue/indexQueue';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './setup/env';

const TABLES = ['repos', 'github_installations', 'invitations', 'email_tokens', 'sessions', 'memberships', 'orgs', 'users'];
const RATE_PREFIX = 'rltest';

export const createTestContext = async (options: { github?: Config['github']; githubClient?: GitHubClient } = {}) => {
  const base = loadConfig({ DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL, RDI_DEV_ROUTES: 'true', RATE_LIMIT_PREFIX: RATE_PREFIX });
  const config: Config = { ...base, github: options.github ?? null };
  const pool = createPgPool(config.databaseUrl, 5);
  const redis = createRedisClient(config.redisUrl);
  const mailer = createDevMailer(() => {});
  const graph = createGraphStore('bolt://localhost:7690', 'neo4j', 'rdi-dev-password');
  await graph.ensureSchema();
  const jobs: IndexJobData[] = [];
  const indexQueue = { enqueue: async (job: IndexJobData) => { jobs.push(job); }, close: async () => {} };
  const app = buildApp({ checks: {}, deps: { config, pool, redis, mailer, graph, indexQueue, github: options.githubClient ?? null } });
  await app.ready();
  const reset = async () => {
    await pool.query(`truncate ${TABLES.join(', ')} cascade`);
    const keys = await redis.keys(`${RATE_PREFIX}:*`);
    if (keys.length) await redis.del(...keys);
    jobs.length = 0;
  };
  const close = async () => {
    await app.close();
    await pool.end();
    redis.disconnect();
    await graph.close();
  };
  return { app, pool, redis, mailer, config, graph, jobs, reset, close };
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

`apps/api/src/server.ts` — create the graph store, index queue and GitHub client, and pass them to `buildApp`:
```ts
import { createGraphStore } from '@rdi/graph';
import { createGitHubClient } from '@rdi/providers';
import { createIndexQueue } from './queue/indexQueue';
// after `const redis = …`:
const graph = createGraphStore(config.neo4jUrl, config.neo4jUser, config.neo4jPassword);
await graph.ensureSchema();
const indexQueue = createIndexQueue(config.redisUrl);
const github = config.github ? createGitHubClient({ appId: config.github.appId, privateKey: config.github.privateKey, slug: config.github.slug }) : null;
// in onClose: also `await indexQueue.close(); await graph.close();`
// deps: { config, pool, redis, mailer, graph, indexQueue, github }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/api && npm run test:integration -w @rdi/api && npm run typecheck -w @rdi/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add GitHub integration, repository indexing routes and the system map

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Web — live Repositories screen

**Files:**
- Modify: `apps/web/src/i18n/shellMessages.ts`, `apps/web/src/shell/settings/RepositoriesPage.tsx`, `apps/web/test/shell/settings.test.tsx` (RepositoriesPage case moved)
- Test: `apps/web/test/shell/repositories.test.tsx`

**Interfaces:**
- Produces testids: `connect-github`, `github-connected`, `demo-hint`, `add-repo-select`, `add-repo-submit`, `repo-reindex-<fullName>`, `repo-remove-<fullName>`, `repos-error`, `connected-toast`, plus the plan-3a ones. Polls every 2 s while any repo is `pending`/`indexing`.

- [ ] **Step 1: Catalog keys**

Add to `shellEn` in `apps/web/src/i18n/shellMessages.ts`:
```ts
  'repos.add': 'Add repository',
  'repos.addButton': 'Add',
  'repos.noneAvailable': 'Every available repository is already added.',
  'repos.reindex': 'Re-index',
  'repos.remove': 'Remove',
  'repos.demoHint': 'GitHub is not configured on this server. You can explore the bundled demo repositories.',
  'repos.connectedTo': 'Connected to {account}',
  'repos.connectedToast': 'GitHub connected ✓ Pick the repositories to explore.',
  'repos.source.github': 'GitHub',
  'repos.source.demo': 'demo',
  'errors.repo_limit': 'You reached the repository limit for this organization.',
  'errors.github_not_configured': 'GitHub is not configured on this server.',
```
Add to `shellEs`:
```ts
  'repos.add': 'Agregar repositorio',
  'repos.addButton': 'Agregar',
  'repos.noneAvailable': 'Ya agregaste todos los repositorios disponibles.',
  'repos.reindex': 'Reindexar',
  'repos.remove': 'Quitar',
  'repos.demoHint': 'GitHub no está configurado en este servidor. Podés explorar los repositorios de demo incluidos.',
  'repos.connectedTo': 'Conectado a {account}',
  'repos.connectedToast': 'GitHub conectado ✓ Elegí los repositorios a explorar.',
  'repos.source.github': 'GitHub',
  'repos.source.demo': 'demo',
  'errors.repo_limit': 'Llegaste al límite de repositorios de esta organización.',
  'errors.github_not_configured': 'GitHub no está configurado en este servidor.',
```
Add to `shellPt`:
```ts
  'repos.add': 'Adicionar repositório',
  'repos.addButton': 'Adicionar',
  'repos.noneAvailable': 'Todos os repositórios disponíveis já foram adicionados.',
  'repos.reindex': 'Reindexar',
  'repos.remove': 'Remover',
  'repos.demoHint': 'O GitHub não está configurado neste servidor. Você pode explorar os repositórios de demonstração incluídos.',
  'repos.connectedTo': 'Conectado a {account}',
  'repos.connectedToast': 'GitHub conectado ✓ Escolha os repositórios para explorar.',
  'repos.source.github': 'GitHub',
  'repos.source.demo': 'demo',
  'errors.repo_limit': 'Você atingiu o limite de repositórios desta organização.',
  'errors.github_not_configured': 'O GitHub não está configurado neste servidor.',
```

- [ ] **Step 2: Write the failing test**

Delete the `describe('RepositoriesPage', …)` block from `apps/web/test/shell/settings.test.tsx` (it moves here). Create `apps/web/test/shell/repositories.test.tsx`:
```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { ApiError, apiFetch } from '../../src/shell/api';
import { RepositoriesPage } from '../../src/shell/settings/RepositoriesPage';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

const repo = (fullName: string, status: string, stages: { name: string; status: string; progress?: number }[]) =>
  ({ id: fullName, fullName, defaultBranch: 'main', languages: ['TypeScript'], status, stages, error: null, lastSyncedAt: null });

const mockApi = (state: { integrations: object; available: object[]; repos: object[] }, onMutation: (path: string, init: { method?: string; body?: unknown }) => unknown = () => ({})) =>
  api.mockImplementation(async (path, init) => {
    if (init?.method && init.method !== 'GET') return onMutation(String(path), init) as never;
    if (String(path).endsWith('/integrations')) return state.integrations as never;
    if (String(path).endsWith('/available-repos')) return state.available as never;
    if (String(path).endsWith('/usage')) return { repos: state.repos.length, repoLimit: 10, pieces: 0 } as never;
    if (String(path).endsWith('/github/install-url')) return { url: 'https://github.com/apps/x/installations/new?state=s' } as never;
    return state.repos as never;
  });

const render = (route = '/orgs/o1/settings/repositories') =>
  renderShell(
    <Routes>
      <Route path=":orgId/settings" element={<SettingsLayout />}>
        <Route path="*" element={<RepositoriesPage />} />
      </Route>
    </Routes>,
    { route, path: '/orgs/*', session: sessionFixture() },
  );

beforeEach(() => api.mockReset());

describe('RepositoriesPage', () => {
  it('offers the demo repositories when GitHub is not configured and adds one', async () => {
    const onMutation = vi.fn(() => ({}));
    mockApi({ integrations: { github: { configured: false, installation: null }, demo: { available: true } }, available: [{ fullName: 'acme-demo/shop-api', defaultBranch: 'main', source: 'demo' }], repos: [] }, onMutation);
    render();
    expect(await screen.findByTestId('demo-hint')).toBeInTheDocument();
    expect(screen.getByTestId('connect-github')).toBeDisabled();
    await screen.findByRole('option', { name: /acme-demo\/shop-api/ });
    fireEvent.click(screen.getByTestId('add-repo-submit'));
    await waitFor(() => expect(onMutation).toHaveBeenCalledWith('/orgs/o1/repos', { method: 'POST', body: { fullName: 'acme-demo/shop-api' } }));
  });

  it('starts the GitHub install when configured and shows the connected account', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    mockApi({ integrations: { github: { configured: true, installation: null }, demo: { available: false } }, available: [], repos: [] });
    render();
    fireEvent.click(await screen.findByTestId('connect-github'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/apps/x/installations/new?state=s'));
  });

  it('shows the connected account and the post-install toast', async () => {
    mockApi({ integrations: { github: { configured: true, installation: { accountLogin: 'acme' } }, demo: { available: false } }, available: [], repos: [] });
    render('/orgs/o1/settings/repositories?connected=github');
    expect(await screen.findByTestId('github-connected')).toHaveTextContent('Connected to acme');
    expect(screen.getByTestId('connected-toast')).toBeInTheDocument();
  });

  it('renders stages, re-indexes, removes and reports errors', async () => {
    const onMutation = vi.fn((path: string, init: { method?: string }) => {
      if (init.method === 'DELETE') throw new ApiError(403, 'forbidden');
      return {};
    });
    mockApi({
      integrations: { github: { configured: false, installation: null }, demo: { available: true } },
      available: [],
      repos: [repo('acme-demo/shop-api', 'indexing', [{ name: 'clone', status: 'done' }, { name: 'summarize', status: 'running', progress: 64 }])],
    }, onMutation);
    render();
    expect(await screen.findByTestId('stage-acme-demo/shop-api-summarize')).toHaveTextContent('64%');
    expect(screen.getByText('Every available repository is already added.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('repo-reindex-acme-demo/shop-api'));
    await waitFor(() => expect(onMutation).toHaveBeenCalledWith('/orgs/o1/repos/acme-demo/shop-api/reindex', { method: 'POST', body: {} }));
    fireEvent.click(screen.getByTestId('repo-remove-acme-demo/shop-api'));
    expect(await screen.findByTestId('repos-error')).toHaveTextContent('permission');
  });
});
```

Run: `npm test -w @rdi/web -- shell/repositories`
Expected: FAIL — the page lacks the new controls.

- [ ] **Step 3: Implement**

`apps/web/src/shell/settings/RepositoriesPage.tsx` (full replacement):
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { useSettingsContext } from './SettingsLayout';

type Stage = { name: 'clone' | 'parse' | 'detect' | 'summarize' | 'link'; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string };
type Repo = { id: string; fullName: string; defaultBranch: string; languages: string[]; status: 'pending' | 'indexing' | 'ready' | 'error'; stages: Stage[]; error: string | null; lastSyncedAt: string | null };
type Usage = { repos: number; repoLimit: number; pieces: number };
type Integrations = { github: { configured: boolean; installation: { accountLogin: string } | null }; demo: { available: boolean } };
type Available = { fullName: string; defaultBranch: string; source: 'github' | 'demo' };

const STAGE_GLYPH = { done: '✓', running: '◐', error: '✕', pending: '○' } as const;
const POLL_MS = 2000;
const BUSY = new Set(['pending', 'indexing']);

export const RepositoriesPage = () => {
  const { t, language } = useI18n();
  const { org } = useSettingsContext();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canManage = org.role !== 'member';

  const repos = useQuery({
    queryKey: ['repos', org.id],
    queryFn: () => apiFetch<Repo[]>(`/orgs/${org.id}/repos`),
    refetchInterval: (query) => ((query.state.data as Repo[] | undefined)?.some((r) => BUSY.has(r.status)) ? POLL_MS : false),
  });
  const usage = useQuery({ queryKey: ['usage', org.id], queryFn: () => apiFetch<Usage>(`/orgs/${org.id}/usage`) });
  const integrations = useQuery({ queryKey: ['integrations', org.id], queryFn: () => apiFetch<Integrations>(`/orgs/${org.id}/integrations`) });
  const available = useQuery({ queryKey: ['available-repos', org.id], queryFn: () => apiFetch<Available[]>(`/orgs/${org.id}/available-repos`) });

  useEffect(() => {
    if (!selected && available.data?.[0]) setSelected(available.data[0].fullName);
  }, [available.data, selected]);

  const refresh = () => Promise.all(['repos', 'usage', 'available-repos'].map((key) => client.invalidateQueries({ queryKey: [key, org.id] })));
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const connectGithub = () =>
    run(async () => {
      const { url } = await apiFetch<{ url: string }>(`/orgs/${org.id}/github/install-url`);
      window.location.assign(url);
    });
  const add = () =>
    run(async () => {
      await apiFetch(`/orgs/${org.id}/repos`, { method: 'POST', body: { fullName: selected } });
      setSelected('');
    });

  const github = integrations.data?.github;
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
        {github?.installation ? (
          <span className="tag" data-testid="github-connected">● {t('repos.connectedTo', { account: github.installation.accountLogin })}</span>
        ) : (
          <GhostButton disabled={!github?.configured || !canManage} title={github?.configured ? undefined : t('errors.github_not_configured')} onClick={() => void connectGithub()} data-testid="connect-github">
            + {t('repos.connect')}
          </GhostButton>
        )}
      </div>
      {params.get('connected') === 'github' && <p className="alert ok" data-testid="connected-toast">{t('repos.connectedToast')}</p>}
      {!github?.configured && integrations.data?.demo.available && <p className="alert ok" data-testid="demo-hint">{t('repos.demoHint')}</p>}
      {error && <p className="alert error" role="alert" data-testid="repos-error">{error}</p>}
      {canManage && available.data && (
        <div className="row" style={{ margin: '14px 0 20px' }}>
          {available.data.length === 0 ? (
            <span className="muted-a">{t('repos.noneAvailable')}</span>
          ) : (
            <>
              <select aria-label={t('repos.add')} value={selected} onChange={(e) => setSelected(e.target.value)} data-testid="add-repo-select" style={{ maxWidth: 360 }}>
                {available.data.map((r) => <option key={r.fullName} value={r.fullName}>{r.fullName} · {t(`repos.source.${r.source}`)}</option>)}
              </select>
              <PrimaryButton className="btn-small" onClick={() => void add()} disabled={!selected} data-testid="add-repo-submit">{t('repos.addButton')}</PrimaryButton>
            </>
          )}
        </div>
      )}
      {repos.data && repos.data.length === 0 && <p className="alert ok">{t('repos.empty')}</p>}
      {repos.data && repos.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('repos.col.repo')}</th><th>{t('repos.col.branch')}</th><th>{t('repos.col.languages')}</th><th>{t('repos.col.status')}</th><th>{t('repos.col.synced')}</th><th />
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
                <td style={{ textAlign: 'right' }}>
                  {canManage && (
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <GhostButton data-testid={`repo-reindex-${r.fullName}`} disabled={BUSY.has(r.status)} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/repos/${r.id}/reindex`, { method: 'POST', body: {} }))}>{t('repos.reindex')}</GhostButton>
                      <GhostButton className="btn-danger" data-testid={`repo-remove-${r.fullName}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/repos/${r.id}`, { method: 'DELETE' }))}>{t('repos.remove')}</GhostButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
```

Note: in the test the re-index button is enabled because the fixture repo is `indexing`; change the fixture used for the re-index click to status `ready` if the executor keeps `disabled={BUSY.has(r.status)}` — the test above uses `indexing`, so **drop the `disabled` prop on re-index** (re-queueing a running repo is harmless; the worker overwrites stages). Implement without `disabled` on the re-index button.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add live repository management with GitHub and demo sources

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Web — open the system map in the workspace

**Files:**
- Modify: `apps/web/src/workspace/Workspace.tsx`, `apps/web/src/shell/pages/ExplorePage.tsx`
- Test: `apps/web/test/shell/explore.test.tsx`

**Interfaces:**
- Workspace gains `extraScenes?: Scene[]` (listed first in the scene picker and used as the initial scene).
- ExplorePage fetches `/orgs/:orgId/system-map` (404 → no extra scene), validates it with `validateScene`, shows `Splash` while loading.

- [ ] **Step 1: Write the failing test**

`apps/web/test/shell/explore.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { ApiError, apiFetch } from '../../src/shell/api';
import { ExplorePage } from '../../src/shell/pages/ExplorePage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/workspace/Workspace', () => ({
  Workspace: ({ extraScenes }: { extraScenes?: { id: string }[] }) => <div data-testid="workspace">{(extraScenes ?? []).map((s) => s.id).join(',') || 'samples-only'}</div>,
}));
const api = vi.mocked(apiFetch);
beforeEach(() => api.mockReset());

describe('ExplorePage', () => {
  it('passes the generated system map to the workspace', async () => {
    api.mockResolvedValue({ ...sampleRegistry['iot-telemetry']!, id: 'system-map', title: 'System map' } as never);
    renderShell(<ExplorePage />, { route: '/orgs/o1/explore', path: '/orgs/:orgId/explore', session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('system-map'));
    expect(api).toHaveBeenCalledWith('/orgs/o1/system-map');
  });

  it('falls back to the samples when there is no map yet', async () => {
    api.mockRejectedValue(new ApiError(404, 'not_found'));
    renderShell(<ExplorePage />, { route: '/orgs/o1/explore', path: '/orgs/:orgId/explore', session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('samples-only'));
  });

  it('ignores invalid scenes from the server', async () => {
    api.mockResolvedValue({ id: 'system-map' } as never);
    renderShell(<ExplorePage />, { route: '/orgs/o1/explore', path: '/orgs/:orgId/explore', session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('samples-only'));
  });
});
```

Run: `npm test -w @rdi/web -- shell/explore`
Expected: FAIL — ExplorePage never requests the system map.

- [ ] **Step 2: Implement**

`apps/web/src/shell/pages/ExplorePage.tsx` (full replacement):
```tsx
import { validateScene, type Scene } from '@rdi/scene';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { Workspace } from '../../workspace/Workspace';
import { ApiError, apiFetch } from '../api';
import { Splash } from '../components/Splash';
import { effectiveLevel, effectiveTheme } from '../preferences';
import { useSession, useUpdateMe } from '../session';

const NOT_FOUND = 404;
const MAP_STALE_MS = 30_000;

const fetchSystemMap = async (orgId: string): Promise<Scene | null> => {
  try {
    const result = validateScene(await apiFetch<unknown>(`/orgs/${orgId}/system-map`));
    return result.ok ? result.scene : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === NOT_FOUND) return null;
    throw error;
  }
};

export const ExplorePage = () => {
  const { orgId = '' } = useParams();
  const { data: session } = useSession();
  const updateMe = useUpdateMe();
  const { setLanguage } = useI18n();
  const systemMap = useQuery({ queryKey: ['system-map', orgId], queryFn: () => fetchSystemMap(orgId), staleTime: MAP_STALE_MS, retry: false, enabled: Boolean(orgId) });
  if (!session) return null;
  const org = session.orgs.find((o) => o.id === orgId);
  if (!org) return <Navigate to="/" replace />;
  if (systemMap.isLoading) return <Splash />;
  return (
    <Workspace
      extraScenes={systemMap.data ? [systemMap.data] : []}
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

In `apps/web/src/workspace/Workspace.tsx`:
- extend `WorkspaceProps` with `extraScenes?: Scene[]` and destructure `extraScenes = []`;
- add, right after the props are read:
```tsx
  const scenes = useMemo(() => [...extraScenes, ...sampleScenes], [extraScenes]);
  const registry = useMemo<Record<string, Scene>>(() => Object.fromEntries(scenes.map((s) => [s.id, s])), [scenes]);
  const initialScene = extraScenes[0] ?? sceneFor(language);
```
- replace every `sampleRegistry[` lookup inside the component with `registry[`, the `useReducer` initializer's `sceneFor(language).id` with `initialScene.id`, the fallback `?? sceneFor(language)` with `?? initialScene`, and `scenes={sampleScenes}` passed to `TopBar` with `scenes={scenes}`; in `loadScene`, use `registry[id]` for `next`.

Because `extraScenes` defaults to a new array each render, memoize the default: declare `const NO_SCENES: Scene[] = [];` at module level and default `extraScenes = NO_SCENES`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test -w @rdi/web && npm run typecheck -w @rdi/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): open the generated system map in the workspace

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: End-to-end indexing journey

**Files:**
- Modify: `apps/web/playwright.config.ts`, root `README.md`
- Create: `apps/web/e2e/indexing.spec.ts`

- [ ] **Step 1: Playwright also starts the worker**

In `apps/web/playwright.config.ts` add a third `webServer` entry (between the API and the web server):
```ts
    {
      command: 'npm run dev',
      cwd: '../worker',
      url: 'http://localhost:4040/health',
      reuseExistingServer: true,
      timeout: 90_000,
      env: { DATABASE_URL: 'postgres://rdi:rdi@localhost:5548/rdi_e2e', REDIS_URL: 'redis://localhost:6391/2' },
    },
```
(The worker has no HTTP port; it reuses the API health URL as its readiness signal.)

- [ ] **Step 2: Write the E2E journey**

`apps/web/e2e/indexing.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
});

test('connect the demo repositories, index them and explore the generated system map', async ({ page }) => {
  test.setTimeout(180_000);
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  const orgId = ((await demo.json()) as { orgs: { id: string }[] }).orgs[0]!.id;
  await page.goto(`/orgs/${orgId}/settings/repositories`);
  await expect(page.getByTestId('demo-hint')).toBeVisible();
  for (const name of ['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']) {
    await page.getByTestId('add-repo-select').selectOption(name);
    await page.getByTestId('add-repo-submit').click();
    await expect(page.getByTestId(`repo-${name}`)).toBeVisible();
  }
  for (const name of ['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']) {
    await expect(page.getByTestId(`stage-${name}-link`)).toHaveClass(/done/, { timeout: 120_000 });
  }
  await expect(page.getByTestId('stage-acme-demo/shop-api-detect')).toHaveAttribute('title', '2 endpoints · 1 queues · 1 tables');
  await page.getByTestId('nav-usage').click();
  await expect(page.getByTestId('usage-repos')).toContainText('3 / 10');

  await page.getByTestId('nav-explore').click();
  await expect(page.getByTestId('scene-select')).toHaveValue('system-map');
  await expect(page.getByText('shop-api', { exact: true }).first()).toBeVisible();
  await page.getByTestId('level-components').click();
  await expect(page.getByText('POST /api/orders', { exact: true }).first()).toBeVisible();
  await page.getByTestId('player-next').click();
  await expect(page.getByTestId('now')).toContainText('shop-api publishes a message to the "orders" queue.');
});

test('removing a repository updates the map', async ({ page }) => {
  test.setTimeout(180_000);
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  const { orgs, csrfToken } = (await demo.json()) as { orgs: { id: string }[]; csrfToken: string };
  const orgId = orgs[0]!.id;
  const headers = { 'x-csrf-token': csrfToken };
  const added = await page.request.post(`/api/orgs/${orgId}/repos`, { data: { fullName: 'acme-demo/shop-api' }, headers });
  const repoId = ((await added.json()) as { id: string }).id;
  await expect.poll(async () => ((await (await page.request.get(`/api/orgs/${orgId}/repos`)).json()) as { status: string }[])[0]?.status, { timeout: 120_000 }).toBe('ready');
  expect((await page.request.get(`/api/orgs/${orgId}/system-map`)).status()).toBe(200);
  await page.request.delete(`/api/orgs/${orgId}/repos/${repoId}`, { headers });
  expect((await page.request.get(`/api/orgs/${orgId}/system-map`)).status()).toBe(404);
});
```

- [ ] **Step 3: Run everything**

Stop any running dev servers, then run:
```bash
npm test && npm run typecheck
npm run test:integration -w @rdi/api && npm run test:integration -w @rdi/graph && npm run test:integration -w @rdi/worker
npm run e2e -w @rdi/web
```
Expected: all unit suites PASS; typecheck clean; integration PASS; E2E: 10 workspace + 7 shell + 2 indexing = `19 passed`.

- [ ] **Step 4: README and visual check**

Append to `README.md`:
```markdown
### Indexing

`npm run dev` also starts `apps/worker`, which consumes the `index-repo` BullMQ queue. Without GitHub App settings
(`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_STATE_SECRET`) the
Repositories screen offers the bundled demo repositories under `fixtures/repos`. The indexed graph lives in Neo4j
(browser at http://localhost:7477) and the workspace opens an automatically generated **System map**.
```

Run `RDI_DEV_ROUTES=true npm run dev`, sign in with a demo session (or sign up), add the three demo repos, watch the stages progress live, then open Explore: the System map shows the three services grouped by repo, the orders queue and table, Stripe, and the walkthrough follows web → API → queue → worker. Stop the servers.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(web): add the end-to-end indexing journey

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Triggers: install/repo added → index; push on default branch → re-index | 10 (routes, webhook) |
| Clone with installation token, ephemeral volume | 8, 9 |
| Parse (tree-sitter TS/JS + Python) | 2 |
| Detect: routes, queues, tables, outbound/external, config | 3 |
| Summarize (heuristic now; LLM in plan 4) | 4 |
| Embed | Deferred to plan 4 (agent + semantic search) |
| Cross-repo linker with confidence | 5, 7 |
| Neo4j schema, org scoping, whitelisted labels/types | 7 |
| Stage progress per repo, limits (500k LOC, 10 repos) | 1, 9, 10, 11 |
| Automatic system map after indexing | 6, 10, 12 |
| Repositories screen: connect GitHub, stages, retry, remove | 11 |
| Webhook signature verification, install state | 8, 10 |
