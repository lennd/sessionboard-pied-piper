import { createHash } from 'node:crypto';
import { defineScene, type EdgeKind, type Scene, type SceneInput, type StepInput } from '@rdi/scene';
import type { GraphEdge, GraphNode } from './repoGraph';

export type OrgGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
export const SYSTEM_MAP_ID = 'system-map';

const MAX_ID = 100;
const MAX_LABEL = 110;
const MAX_STEPS = 12;
const MAX_SUMMARY = 2000;
const MAX_ENDPOINTS_PER_SERVICE = 8;
const MAX_SHARED_PER_KIND = 15;
const CODE_CONTEXT_BEFORE = 2;
const CODE_CONTEXT_AFTER = 12;
const EDGE_ORDER: EdgeKind[] = ['sync', 'async', 'write', 'read', 'calls'];
/** Requests that change state tell the more useful story, so they lead the walkthrough. */
const METHOD_ORDER = ['POST', 'PUT', 'PATCH', 'DELETE', 'GET'];

const sceneId = (id: string) => (id.length <= MAX_ID ? id : `${id.slice(0, 80)}#${createHash('sha1').update(id).digest('hex').slice(0, 12)}`);
const clip = (text: string, max = MAX_LABEL) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

type SceneEdgeDraft = { from: string; to: string; kind: EdgeKind; label?: string };

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Graph stores return rows in arbitrary order; sort first so the map and its walkthrough are deterministic. */
const canonical = (graph: OrgGraph): OrgGraph => ({
  nodes: [...graph.nodes].sort((a, b) => byText(a.id, b.id)),
  edges: [...graph.edges].sort((a, b) => byText(`${a.from}|${a.type}|${a.to}`, `${b.from}|${b.type}|${b.to}`)),
});

export const buildSystemMap = (input: OrgGraph): Scene | null => {
  const graph = canonical(input);
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
  const include = (node: GraphNode, role: 'compute' | 'channel' | 'storage' | 'external', kind: string, parent?: string, code?: SceneInput['nodes'][number]['code']) => {
    included.add(node.id);
    nodes.push({
      id: sceneId(node.id), label: clip(node.name), role, kind, summary: clip(node.summary || node.name, MAX_SUMMARY), graphRef: node.id,
      ...(parent ? { parent: sceneId(parent) } : {}),
      ...(node.label === 'Service' && typeof node.props.repo === 'string' ? { repo: clip(node.props.repo) } : {}),
      ...(code ? { code } : {}),
    });
  };
  const endpointCode = (ep: GraphNode, svc: GraphNode): SceneInput['nodes'][number]['code'] => {
    const file = typeof ep.props.file === 'string' ? ep.props.file : null;
    const line = typeof ep.props.line === 'number' ? ep.props.line : null;
    const repo = typeof svc.props.repo === 'string' ? svc.props.repo : null;
    if (!file || !line || !repo || !ep.repoId) return undefined;
    const language = byId.get(`file:${ep.repoId}:${file}`)?.props.language;
    return { repo: clip(repo), path: file, startLine: Math.max(1, line - CODE_CONTEXT_BEFORE), endLine: line + CODE_CONTEXT_AFTER, language: typeof language === 'string' ? language : 'text' };
  };
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type === 'CONTAINS') continue;
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
  }
  const busiest = (items: GraphNode[], limit: number) =>
    [...items].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.name.localeCompare(b.name)).slice(0, limit);
  const ofLabel = (label: GraphNode['label']) => graph.nodes.filter((n) => n.label === label);

  for (const svc of services) include(svc, 'compute', 'service');
  for (const svc of services) {
    const endpoints = ofLabel('Endpoint').filter((n) => serviceOfEndpoint.get(n.id) === svc.id);
    for (const ep of busiest(endpoints, MAX_ENDPOINTS_PER_SERVICE)) include(ep, 'compute', 'HTTP endpoint', svc.id, endpointCode(ep, svc));
  }
  for (const node of busiest(ofLabel('Queue'), MAX_SHARED_PER_KIND)) include(node, 'channel', 'queue');
  for (const node of busiest(ofLabel('Table'), MAX_SHARED_PER_KIND)) include(node, 'storage', 'table');
  for (const node of busiest(ofLabel('External'), MAX_SHARED_PER_KIND)) include(node, 'external', 'external API');
  const folded = (id: string) => (included.has(id) ? id : serviceOfEndpoint.get(id) ?? id);

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
      case 'CALLS_HTTP': addEdge(svc, folded(e.to), 'sync', byId.get(e.to)?.name); break;
    }
  }
  const edgeList = [...drafts.values()].map((d, i) => ({ id: `e${i + 1}`, from: sceneId(d.from), to: sceneId(d.to), kind: d.kind, ...(d.label ? { label: clip(d.label) } : {}) }));

  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  const parentOf = new Map(nodes.flatMap((n) => (n.parent ? [[n.id, n.parent] as const] : [])));
  const roleOf = new Map(nodes.map((n) => [n.id, n.role]));
  const methodRank = (e: (typeof edgeList)[number]) => {
    const method = (labelOf.get(e.to) ?? '').split(' ')[0] ?? '';
    const rank = METHOD_ORDER.indexOf(method);
    return rank === -1 ? METHOD_ORDER.length : rank;
  };
  const outgoing = (id: string) =>
    edgeList
      .filter((e) => e.from === id)
      .sort((a, b) => EDGE_ORDER.indexOf(a.kind) - EDGE_ORDER.indexOf(b.kind) || methodRank(a) - methodRank(b));
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
