import { EDGE_TYPES, linkInputsFromGraph, linkRepos, NODE_LABELS, type GraphEdge, type GraphNode, type NodeLabel, type OrgGraph, type RepoGraph } from '@rdi/indexer';
import neo4j, { type Driver } from 'neo4j-driver';

export type GraphStore = {
  ensureSchema(): Promise<void>;
  writeRepoGraph(orgId: string, repoId: string, graph: RepoGraph): Promise<void>;
  commitRepoGraph(orgId: string, repoId: string, graph: RepoGraph, liveRepoIds: string[]): Promise<number>;
  pruneOrg(orgId: string, liveRepoIds: string[]): Promise<number>;
  relink(orgId: string): Promise<number>;
  replaceOrgLinks(orgId: string, links: GraphEdge[]): Promise<void>;
  deleteRepo(orgId: string, repoId: string): Promise<void>;
  readOrgGraph(orgId: string): Promise<OrgGraph>;
  countOrgNodes(orgId: string): Promise<number>;
  close(): Promise<void>;
};

type Runner = { run(query: string, params?: Record<string, unknown>): Promise<{ records: { get(key: string): unknown }[] }> };

const RESERVED = new Set(['id', 'org_id', 'repo_id', 'label', 'name', 'summary']);
const LABELS = new Set<string>(NODE_LABELS);
const TYPES = new Set<string>(EDGE_TYPES);
const CLEANUP_ORPHANS = 'MATCH (n:Piece {org_id: $orgId}) WHERE n.repo_id IS NULL AND NOT (n)--() DELETE n';

const assertLabel = (label: string) => {
  if (!LABELS.has(label)) throw new Error(`unknown node label ${label}`);
};
const assertType = (type: string) => {
  if (!TYPES.has(type)) throw new Error(`unknown edge type ${type}`);
};

const groupBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce((map, item) => map.set(key(item), [...(map.get(key(item)) ?? []), item]), new Map<string, T[]>());

/** Serializes every graph mutation of one organization: the MERGE on a uniquely constrained node takes a write lock held until commit. */
const lockOrg = (tx: Runner, orgId: string) => tx.run('MERGE (l:OrgLock {org_id: $orgId}) SET l.touched = timestamp()', { orgId });

const deleteRepoNodes = async (tx: Runner, orgId: string, repoId: string) => {
  await tx.run('MATCH (n:Piece {org_id: $orgId, repo_id: $repoId}) DETACH DELETE n', { orgId, repoId });
};

const pruneDeadRepos = (tx: Runner, orgId: string, liveRepoIds: string[]) =>
  tx.run('MATCH (n:Piece {org_id: $orgId}) WHERE n.repo_id IS NOT NULL AND NOT n.repo_id IN $live DETACH DELETE n', { orgId, live: liveRepoIds });

const writeNodesAndEdges = async (tx: Runner, orgId: string, repoId: string, graph: RepoGraph) => {
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
};

const readGraph = async (runner: Runner, orgId: string): Promise<OrgGraph> => {
  const nodeRows = await runner.run('MATCH (n:Piece {org_id: $orgId}) RETURN properties(n) AS p', { orgId });
  const edgeRows = await runner.run(
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
};

const replaceLinks = async (tx: Runner, orgId: string, links: GraphEdge[]) => {
  for (const link of links) assertType(link.type);
  await tx.run('MATCH (:Piece {org_id: $orgId})-[r:CALLS_HTTP]->() DELETE r', { orgId });
  await tx.run(
    `UNWIND $links AS e
     MATCH (a:Piece {id: e.from, org_id: $orgId}), (b:Piece {id: e.to, org_id: $orgId})
     MERGE (a)-[r:CALLS_HTTP]->(b)
     SET r += e.props, r.org_id = $orgId`,
    { orgId, links },
  );
};

const relinkIn = async (tx: Runner, orgId: string): Promise<number> => {
  const links = linkRepos(linkInputsFromGraph((await readGraph(tx, orgId)).nodes));
  await replaceLinks(tx, orgId, links);
  return links.length;
};

export const createGraphStore = (url: string, user: string, password: string): GraphStore => {
  const driver: Driver = neo4j.driver(url, neo4j.auth.basic(user, password), { disableLosslessIntegers: true });
  const session: Runner = {
    async run(query, params = {}) {
      const s = driver.session();
      try {
        return await s.run(query, params);
      } finally {
        await s.close();
      }
    },
  };
  const lockedWrite = async <T>(orgId: string, work: (tx: Runner) => Promise<T>): Promise<T> => {
    const s = driver.session();
    try {
      return await s.executeWrite(async (tx) => {
        const runner: Runner = { run: (q, p = {}) => tx.run(q, p) };
        await lockOrg(runner, orgId);
        return work(runner);
      });
    } finally {
      await s.close();
    }
  };

  return {
    async ensureSchema() {
      await session.run('CREATE CONSTRAINT piece_id IF NOT EXISTS FOR (p:Piece) REQUIRE p.id IS UNIQUE');
      await session.run('CREATE CONSTRAINT org_lock IF NOT EXISTS FOR (l:OrgLock) REQUIRE l.org_id IS UNIQUE');
      await session.run('CREATE INDEX piece_org IF NOT EXISTS FOR (p:Piece) ON (p.org_id)');
    },

    writeRepoGraph: (orgId, repoId, graph) =>
      lockedWrite(orgId, async (tx) => {
        await deleteRepoNodes(tx, orgId, repoId);
        await writeNodesAndEdges(tx, orgId, repoId, graph);
        await tx.run(CLEANUP_ORPHANS, { orgId });
      }),

    commitRepoGraph: (orgId, repoId, graph, liveRepoIds) =>
      lockedWrite(orgId, async (tx) => {
        await pruneDeadRepos(tx, orgId, liveRepoIds);
        await deleteRepoNodes(tx, orgId, repoId);
        if (liveRepoIds.includes(repoId)) await writeNodesAndEdges(tx, orgId, repoId, graph);
        await tx.run(CLEANUP_ORPHANS, { orgId });
        return relinkIn(tx, orgId);
      }),

    pruneOrg: (orgId, liveRepoIds) =>
      lockedWrite(orgId, async (tx) => {
        await pruneDeadRepos(tx, orgId, liveRepoIds);
        await tx.run(CLEANUP_ORPHANS, { orgId });
        return relinkIn(tx, orgId);
      }),

    relink: (orgId) => lockedWrite(orgId, (tx) => relinkIn(tx, orgId)),

    replaceOrgLinks: (orgId, links) => lockedWrite(orgId, (tx) => replaceLinks(tx, orgId, links)),

    deleteRepo: (orgId, repoId) =>
      lockedWrite(orgId, async (tx) => {
        await deleteRepoNodes(tx, orgId, repoId);
        await tx.run(CLEANUP_ORPHANS, { orgId });
      }),

    readOrgGraph: (orgId) => readGraph(session, orgId),

    async countOrgNodes(orgId) {
      const result = await session.run('MATCH (n:Piece {org_id: $orgId}) RETURN count(n) AS c', { orgId });
      return Number(result.records[0]?.get('c') ?? 0);
    },

    close: () => driver.close(),
  };
};
