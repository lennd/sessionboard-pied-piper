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

  it('commits a repository atomically with relinking, pruning repositories that no longer exist', async () => {
    const org = newOrg();
    const [web, api] = [`${org}-web`, `${org}-api`];
    await store.commitRepoGraph(org, web, await graphOf(org, 'shop-web', web), [web, api]);
    expect(await store.commitRepoGraph(org, api, await graphOf(org, 'shop-api', api), [web, api])).toBe(2);
    expect((await store.readOrgGraph(org)).edges.filter((e) => e.type === 'CALLS_HTTP')).toHaveLength(2);
    expect(await store.pruneOrg(org, [web])).toBe(0);
    const after = await store.readOrgGraph(org);
    expect(after.nodes.some((n) => n.repoId === api)).toBe(false);
    expect(after.edges.some((e) => e.type === 'CALLS_HTTP')).toBe(false);
  });

  it('never writes a repository that is not live (deleted while indexing)', async () => {
    const org = newOrg();
    const api = `${org}-api`;
    expect(await store.commitRepoGraph(org, api, await graphOf(org, 'shop-api', api), [])).toBe(0);
    expect(await store.countOrgNodes(org)).toBe(0);
  });

  it('keeps every cross-repo link when repositories of one org commit concurrently', async () => {
    const org = newOrg();
    const [web, api] = [`${org}-web`, `${org}-api`];
    const [gWeb, gApi] = [await graphOf(org, 'shop-web', web), await graphOf(org, 'shop-api', api)];
    for (let round = 0; round < 5; round++) {
      await store.pruneOrg(org, []);
      await Promise.all([store.commitRepoGraph(org, web, gWeb, [web, api]), store.commitRepoGraph(org, api, gApi, [web, api])]);
      expect((await store.readOrgGraph(org)).edges.filter((e) => e.type === 'CALLS_HTTP')).toHaveLength(2);
    }
  });
});
