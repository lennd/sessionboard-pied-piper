import { defineScene, type EdgeKind, type Scene, type SceneInput, type StepInput } from '@rdi/scene';
import type { EdgeType, GraphNode } from './repoGraph';
import type { OrgGraph } from './systemMap';

export type PullInput = { number: number; title: string; author: string; url: string; headRef: string; baseRef: string; additions: number; deletions: number };
export type PullFileInput = { filename: string; status: string; additions: number; deletions: number; patch?: string; previousFilename?: string };

const MAX_FILES = 60;
const MAX_ENDPOINTS = 30;
const MAX_SHARED = 20;
const MAX_CALLERS = 10;
const MAX_LABEL = 110;
const MAX_SUMMARY = 2000;
const MAX_PATCH = 4000;
const MAX_ID = 100;
const BIG_CHANGE_LINES = 500;
const CODE_PREVIEW_LINES = 80;
const SECURITY_PATH = /(auth|sso|saml|oauth|token|permission|session|password|crypto|certificate|secret)/i;
const MIGRATION_PATH = /(^|\/)(migrations?|db\/migrate)\//i;
const SHARED_EDGES: Partial<Record<EdgeType, EdgeKind>> = { PUBLISHES: 'async', CONSUMES: 'async', READS: 'read', WRITES: 'write', CALLS: 'calls' };
const SHARED_ROLE: Record<string, 'channel' | 'storage' | 'external'> = { Queue: 'channel', Table: 'storage', External: 'external' };

const clip = (text: string, max = MAX_LABEL) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const changeOf = (file: PullFileInput, known: boolean): 'added' | 'modified' | 'removed' =>
  file.status === 'removed' ? 'removed' : file.status === 'added' || !known ? 'added' : 'modified';
const list = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`);

/** Deterministic diagram of what a pull request changes and what those changes reach, built from the System Graph. */
export const buildPullRequestImpact = ({ graph, repoFullName, pull, files }: { graph: OrgGraph; repoFullName: string; pull: PullInput; files: PullFileInput[] }): Scene => {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = [...graph.edges].sort((a, b) => byText(`${a.from}|${a.type}|${a.to}`, `${b.from}|${b.type}|${b.to}`));
  const repoNode = graph.nodes.find((n) => n.label === 'Repo' && n.props.fullName === repoFullName);
  const repoId = repoNode?.repoId ?? null;
  const service = repoId ? nodesById.get(`svc:${repoId}`) : undefined;
  const serviceOfFile = new Map(edges.filter((e) => e.type === 'CONTAINS' && nodesById.get(e.to)?.label === 'File').map((e) => [e.to, e.from]));

  const ordered = [...files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || byText(a.filename, b.filename));
  const shown = ordered.slice(0, MAX_FILES);
  const graphFileOf = (file: PullFileInput) => (repoId ? [file.filename, file.previousFilename].map((p) => p && nodesById.get(`file:${repoId}:${p}`)).find(Boolean) : undefined) as GraphNode | undefined;

  const nodes: SceneInput['nodes'] = [];
  const sceneEdges: SceneInput['edges'] = [];
  const steps: StepInput[] = [];
  const addEdge = (from: string, to: string, kind: EdgeKind, label?: string) => {
    if (!sceneEdges.some((e) => e.from === from && e.to === to && e.kind === kind)) sceneEdges.push({ id: `e${sceneEdges.length + 1}`, from, to, kind, ...(label ? { label: clip(label) } : {}) });
  };

  nodes.push({
    id: 'svc', label: clip(service?.name ?? repoFullName.split('/').pop() ?? repoFullName), role: 'compute', kind: 'service', repo: clip(repoFullName), change: 'modified',
    summary: clip(service?.summary || `Repository ${repoFullName}.`, MAX_SUMMARY), ...(service ? { graphRef: service.id } : {}),
  });

  const fileScene = new Map<string, string>();
  const changedGraphFiles = new Set<string>();
  shown.forEach((file, i) => {
    const graphFile = graphFileOf(file);
    const change = changeOf(file, Boolean(graphFile));
    const id = `f${i + 1}`;
    if (graphFile) {
      fileScene.set(graphFile.id, id);
      changedGraphFiles.add(graphFile.id);
    }
    const language = typeof graphFile?.props.language === 'string' ? graphFile.props.language : 'text';
    const loc = typeof graphFile?.props.loc === 'number' ? graphFile.props.loc : CODE_PREVIEW_LINES;
    nodes.push({
      id, label: clip(file.filename), role: 'logic', kind: 'file', parent: 'svc', change,
      summary: clip(`${change} in this pull request (+${file.additions} −${file.deletions}).${file.previousFilename ? ` Renamed from ${file.previousFilename}.` : ''}`, MAX_SUMMARY),
      ...(graphFile ? { graphRef: graphFile.id } : {}),
      ...(change === 'modified' && graphFile ? { code: { repo: clip(repoFullName), path: file.filename, startLine: 1, endLine: Math.max(1, Math.min(loc, CODE_PREVIEW_LINES)), language } } : {}),
    });
  });

  const importersOf = (fileId: string) => edges.filter((e) => e.type === 'IMPORTS' && e.to === fileId).map((e) => e.from);
  const endpointScene = new Map<string, string>();
  const endpointTargets = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type !== 'HANDLES') continue;
    const endpoint = nodesById.get(e.from);
    if (!endpoint || endpoint.repoId !== repoId) continue;
    const reached = [...changedGraphFiles].filter((f) => f === e.to || importersOf(f).includes(e.to));
    if (reached.length === 0) continue;
    if (!endpointScene.has(endpoint.id) && endpointScene.size >= MAX_ENDPOINTS) continue;
    if (!endpointScene.has(endpoint.id)) {
      const id = `ep${endpointScene.size + 1}`;
      endpointScene.set(endpoint.id, id);
      nodes.push({ id, label: clip(endpoint.name), role: 'compute', kind: 'HTTP endpoint', parent: 'svc', change: 'modified', summary: clip(`Its handler depends on code changed by this pull request. ${endpoint.summary}`, MAX_SUMMARY), graphRef: endpoint.id });
    }
    endpointTargets.set(endpoint.id, [...new Set([...(endpointTargets.get(endpoint.id) ?? []), ...reached])]);
  }
  for (const [endpointId, targets] of [...endpointTargets.entries()].sort((a, b) => byText(a[0], b[0]))) {
    for (const target of targets) addEdge(endpointScene.get(endpointId)!, fileScene.get(target)!, 'calls', 'handled by');
  }

  const sharedScene = new Map<string, string>();
  for (const e of edges) {
    const kind = SHARED_EDGES[e.type];
    if (!kind) continue;
    const fileId = e.from;
    if (!changedGraphFiles.has(fileId)) continue;
    const target = nodesById.get(e.to);
    const role = target ? SHARED_ROLE[target.label] : undefined;
    if (!target || !role) continue;
    if (!sharedScene.has(target.id)) {
      if (sharedScene.size >= MAX_SHARED) continue;
      const id = `s${sharedScene.size + 1}`;
      sharedScene.set(target.id, id);
      nodes.push({ id, label: clip(target.name), role, kind: target.label.toLowerCase(), summary: clip(target.summary || target.name, MAX_SUMMARY), graphRef: target.id });
    }
    const fileNode = fileScene.get(fileId)!;
    const sharedNode = sharedScene.get(target.id)!;
    if (e.type === 'CONSUMES') addEdge(sharedNode, fileNode, kind, 'consume');
    else addEdge(fileNode, sharedNode, kind, e.type === 'PUBLISHES' ? 'publish' : undefined);
  }

  const callerScene = new Map<string, string>();
  const callerSteps: StepInput[] = [];
  for (const e of edges) {
    if (e.type !== 'CALLS_HTTP' || !endpointScene.has(e.to)) continue;
    const callerService = nodesById.get(serviceOfFile.get(e.from) ?? '');
    if (!callerService || callerService.repoId === repoId) continue;
    if (!callerScene.has(callerService.id)) {
      if (callerScene.size >= MAX_CALLERS) continue;
      const id = `c${callerScene.size + 1}`;
      callerScene.set(callerService.id, id);
      nodes.push({
        id, label: clip(callerService.name), role: 'compute', kind: 'service', summary: clip(`Calls endpoints this pull request affects. ${callerService.summary}`, MAX_SUMMARY), graphRef: callerService.id,
        ...(typeof callerService.props.repo === 'string' ? { repo: clip(callerService.props.repo) } : {}),
      });
    }
    const endpointNode = endpointScene.get(e.to)!;
    const before = sceneEdges.length;
    addEdge(callerScene.get(callerService.id)!, endpointNode, 'sync', nodesById.get(e.to)?.name);
    if (sceneEdges.length > before) {
      const edge = sceneEdges.at(-1)!;
      callerSteps.push({ id: `cs${callerSteps.length + 1}`, narration: `${callerService.name} calls ${nodesById.get(e.to)?.name ?? 'an endpoint'}, which this pull request affects. Check that the contract still holds.`, focus: [endpointNode], travel: { edgeId: edge.id } });
    }
  }

  shown.forEach((file, i) => {
    const id = `f${i + 1}`;
    const reaches = [
      ...sceneEdges.filter((e) => e.to === id && e.from.startsWith('ep')).map((e) => nodes.find((n) => n.id === e.from)!.label),
      ...sceneEdges.filter((e) => (e.from === id && e.to.startsWith('s')) || (e.to === id && e.from.startsWith('s'))).map((e) => nodes.find((n) => n.id === (e.from === id ? e.to : e.from))!.label),
    ];
    const change = nodes.find((n) => n.id === id)!.change;
    steps.push({
      id: `fs${i + 1}`,
      narration: clip(`${file.filename}: ${change} (+${file.additions} −${file.deletions}).${reaches.length > 0 ? ` It affects ${list([...new Set(reaches)])}.` : ''}`, MAX_SUMMARY),
      focus: [id],
      ...(file.patch ? { payload: { format: 'text' as const, after: file.patch.slice(0, MAX_PATCH) } } : {}),
    });
  });
  steps.push(...callerSteps);

  const risks: SceneInput['risks'] = [];
  const fileIdsMatching = (pattern: RegExp) => shown.flatMap((f, i) => (pattern.test(f.filename) ? [`f${i + 1}`] : []));
  const securityFiles = files.filter((f) => SECURITY_PATH.test(f.filename));
  if (securityFiles.length > 0) {
    risks.push({ id: 'r-security', category: 'security', severity: 'high', title: 'Touches authentication or security code', explanation: clip(`${securityFiles.length} changed file(s) handle authentication, sessions, tokens or certificates: ${list(securityFiles.map((f) => f.filename))}.`, MAX_SUMMARY), nodeIds: fileIdsMatching(SECURITY_PATH).length > 0 ? fileIdsMatching(SECURITY_PATH) : ['svc'], mitigation: 'Review these files line by line and test the login, logout and token flows.' });
  }
  const migrations = files.filter((f) => MIGRATION_PATH.test(f.filename));
  if (migrations.length > 0) {
    risks.push({ id: 'r-migration', category: 'reliability', severity: 'medium', title: 'Includes database migrations', explanation: clip(`Migrations change the schema: ${list(migrations.map((f) => f.filename))}.`, MAX_SUMMARY), nodeIds: fileIdsMatching(MIGRATION_PATH).length > 0 ? fileIdsMatching(MIGRATION_PATH) : ['svc'], mitigation: 'Check they are reversible and safe to run on production data volumes.' });
  }
  if (pull.additions + pull.deletions > BIG_CHANGE_LINES) {
    risks.push({ id: 'r-size', category: 'complexity', severity: 'medium', title: 'Large change', explanation: `${pull.additions + pull.deletions} changed lines are hard to review in one pass.`, nodeIds: ['svc'], mitigation: 'Ask for smaller pull requests or review by area.' });
  }
  const calledEndpoints = [...new Set(sceneEdges.filter((e) => e.kind === 'sync').map((e) => e.to))];
  if (calledEndpoints.length > 0) {
    risks.push({ id: 'r-contract', category: 'reliability', severity: 'high', title: 'Endpoints used by other repositories change', explanation: 'Other repositories call endpoints whose code changes here; a changed request or response breaks them.', nodeIds: calledEndpoints, mitigation: 'Keep the contract backwards compatible or update the callers in the same release.' });
  }

  return defineScene({
    id: `pr-${repoFullName.replace(/[^A-Za-z0-9]+/g, '-')}-${pull.number}`.slice(0, MAX_ID),
    title: clip(`#${pull.number} ${pull.title}`, 120),
    summary: clip(`Pull request #${pull.number} by ${pull.author} (${pull.headRef} → ${pull.baseRef}), +${pull.additions} −${pull.deletions}. Showing ${shown.length} of ${files.length} files.`, MAX_SUMMARY),
    language: 'en',
    nodes,
    edges: sceneEdges,
    steps,
    risks,
  });
};
