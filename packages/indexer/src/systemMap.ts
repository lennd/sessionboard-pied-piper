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
