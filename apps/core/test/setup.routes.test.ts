import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeQuery } from '../src/agent/fakeQuery';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createRunRegistry } from '../src/runs/registry';
import { resetSetupCache } from '../src/setup/check';

let home: string;
let bins: string;
let app: FastifyInstance;

const script = async (name: string, body: string) => {
  const path = join(bins, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
};
const boot = async (claude: string, gh: string) => {
  app = buildApp({ config: loadConfig({ RDI_HOME: home, RDI_FAKE_AGENT: 'true', CLAUDE_EXECUTABLE: claude, RDI_GH_BIN: gh }), queryFn: createFakeQuery(), events: new EventEmitter(), runs: createRunRegistry() });
  await app.ready();
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rdi-home-'));
  bins = await mkdtemp(join(tmpdir(), 'rdi-bins-'));
  resetSetupCache();
});
afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
  await rm(bins, { recursive: true, force: true });
});

describe('GET /setup', () => {
  it('reports Claude and gh as ready when both answer', async () => {
    const claude = await script('claude', `case "$*" in "auth status --json") echo '{"loggedIn": true, "email": "ana@acme.com", "authMethod": "claude.ai"}';; esac`);
    const gh = await script('gh', `case "$*" in "--version") echo "gh version 2.85.0";; "api user --jq .login") echo ana;; esac`);
    await boot(claude, gh);
    const status = (await app.inject({ method: 'GET', url: '/api/setup' })).json();
    expect(status.claude).toEqual({ ok: true, loggedIn: true, email: 'ana@acme.com', method: 'claude.ai', detail: null });
    expect(status.gh).toEqual({ ok: true, installed: true, loggedIn: true, login: 'ana', detail: null });
  });

  it('explains what is missing: Claude logged out, gh absent or logged out', async () => {
    const claude = await script('claude', `echo '{"loggedIn": false}'`);
    await boot(claude, join(bins, 'nope'));
    let status = (await app.inject({ method: 'GET', url: '/api/setup' })).json();
    expect(status.claude).toMatchObject({ ok: false, loggedIn: false, detail: 'claude_not_logged_in' });
    expect(status.gh).toMatchObject({ ok: false, installed: false, detail: 'gh_missing' });
    await app.close();
    const gh = await script('gh', `case "$*" in "--version") echo "gh version 2.85.0";; *) echo "not logged in" >&2; exit 4;; esac`);
    await boot(join(bins, 'missing-claude'), gh);
    status = (await app.inject({ method: 'GET', url: '/api/setup?refresh=1' })).json();
    expect(status.claude).toMatchObject({ ok: false, detail: 'claude_binary_missing' });
    expect(status.gh).toMatchObject({ ok: false, installed: true, loggedIn: false, detail: 'gh_not_logged_in' });
  });
});
