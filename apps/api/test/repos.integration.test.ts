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
