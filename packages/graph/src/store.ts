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
