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
