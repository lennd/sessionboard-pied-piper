import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGraphStore, type GraphStore } from '@rdi/graph';
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

  it('leaves no graph data when the repository is deleted while it is being indexed', async () => {
    const id = await addRepo('acme-demo/deleted-api');
    const resolve = createSourceResolver({ fixturesDir: FIXTURES, github: null });
    const deletingResolver = async (repo: Parameters<typeof resolve>[0]) => {
      await pool.query('delete from repos where id = $1', [repo.id]);
      return resolve({ ...repo, fullName: 'acme-demo/shop-api' });
    };
    expect(await runIndexJob({ ...deps(), resolveSource: deletingResolver }, id)).toBe('missing');
    expect((await graph.readOrgGraph(orgId)).nodes.some((n) => n.repoId === id)).toBe(false);
  });

  it('keeps the previous graph and its links when the link stage fails', async () => {
    const before = (await graph.readOrgGraph(orgId)).edges.filter((e) => e.type === 'CALLS_HTTP').length;
    expect(before).toBe(2);
    const api = (await pool.query<{ id: string }>("select id from repos where org_id = $1 and full_name = 'acme-demo/shop-api'", [orgId])).rows[0]!.id;
    const failing: GraphStore = { ...graph, commitRepoGraph: async () => { throw new Error('neo4j unavailable'); } };
    expect(await runIndexJob({ ...deps(), graph: failing }, api)).toBe('error');
    const row = await repoRow(api);
    expect(row.stages[4]).toMatchObject({ name: 'link', status: 'error', detail: 'neo4j unavailable' });
    expect((await graph.readOrgGraph(orgId)).edges.filter((e) => e.type === 'CALLS_HTTP')).toHaveLength(2);
  });

  it('runs two jobs for the same repository without clobbering each other', async () => {
    const api = (await pool.query<{ id: string }>("select id from repos where org_id = $1 and full_name = 'acme-demo/shop-api'", [orgId])).rows[0]!.id;
    const nodes = (await graph.readOrgGraph(orgId)).nodes.filter((n) => n.repoId === api).length;
    expect(await Promise.all([runIndexJob(deps(), api), runIndexJob(deps(), api)])).toEqual(['ready', 'ready']);
    expect((await graph.readOrgGraph(orgId)).nodes.filter((n) => n.repoId === api)).toHaveLength(nodes);
    expect((await graph.readOrgGraph(orgId)).edges.filter((e) => e.type === 'CALLS_HTTP')).toHaveLength(2);
  });
});
