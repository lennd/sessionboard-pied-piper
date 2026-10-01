import type Anthropic from '@anthropic-ai/sdk';
import { EDGE_TYPES, NODE_LABELS, type GraphNode, type OrgGraph } from '@rdi/indexer';
import { sceneSchema, solutionDraftInputSchema, validateScene, validateSolutionDraft, type Scene } from '@rdi/scene';
import { SolutionError } from '../solutions/service';
import { z } from 'zod';

export type ToolContext = {
  loadGraph(): Promise<OrgGraph>;
  readSource(repo: string, path: string): Promise<{ content: string; language: string } | null>;
  prFiles(repo: string, number: number): Promise<{ filename: string; status: string; patch?: string }[] | null>;
  upsertSolution(input: { solutionId?: string; title: string; draft: Record<string, unknown> }): Promise<{ id: string; n: number; title: string }>;
  searchCode(query: string, repo?: string): Promise<{ repo: string; path: string; line: number; text: string }[]>;
};
export type ToolOutcome = { content: string; isError?: boolean; scene?: Scene; solution?: { id: string; n: number; title: string }; summary: string };

export const TOOL_NAMES = ['search_code', 'search_graph', 'get_neighbors', 'find_path', 'read_code', 'get_pr_diff', 'emit_scene', 'upsert_solution'] as const;
export const MAX_READ_LINES = 400;
const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 30;
const MAX_NEIGHBORS = 60;
const DEFAULT_PATH_DEPTH = 6;
const MAX_PATH_DEPTH = 7;
const MAX_PR_FILES = 25;
const MAX_PATCH_CHARS = 4000;
const MAX_SUMMARY_CHARS = 240;
const MAX_ERRORS = 25;
const NAME_WEIGHT = 3;
const ID_WEIGHT = 2;

const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  labels: z.array(z.enum(NODE_LABELS)).optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
});
const codeSearchInput = z.object({ query: z.string().trim().min(3).max(200), repo: z.string().min(1).max(200).optional() });
const neighborsInput = z.object({
  id: z.string().min(1).max(500),
  direction: z.enum(['in', 'out', 'both']).optional(),
  types: z.array(z.enum(EDGE_TYPES)).optional(),
});
const pathInput = z.object({ from: z.string().min(1).max(500), to: z.string().min(1).max(500), maxDepth: z.number().int().min(1).max(MAX_PATH_DEPTH).optional() });
const readInput = z.object({ repo: z.string().min(1).max(200), path: z.string().min(1).max(500), startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional() });
const upsertInput = solutionDraftInputSchema.extend({ solutionId: z.string().uuid().optional(), title: z.string().trim().min(1).max(200) });
const prInput = z.object({ repo: z.string().min(1).max(200), number: z.number().int().positive() });

const jsonSchemaOf = (schema: z.ZodType): Anthropic.Beta.BetaTool['input_schema'] => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  return rest as Anthropic.Beta.BetaTool['input_schema'];
};

export const sceneInputSchema = jsonSchemaOf(sceneSchema) as Record<string, unknown>;

export const toolDefinitions: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_code',
    description: 'Search the indexed source code of every repository by text (case-insensitive), e.g. a feature name, library, route fragment or function name. Returns repository, file, line number and the matching line. Start here when the question is about a feature; then read_code around the hits.',
    input_schema: jsonSchemaOf(codeSearchInput),
  },
  {
    name: 'search_graph',
    description: 'Search the organization System Graph (services, endpoints, files, queues, tables, external APIs, config keys) by keywords. Returns the best matching pieces with their ids, which the other tools accept.',
    input_schema: jsonSchemaOf(searchInput),
  },
  {
    name: 'get_neighbors',
    description: 'List the pieces directly connected to a piece id, with the relationship type (CONTAINS, IMPORTS, HANDLES, PUBLISHES, CONSUMES, READS, WRITES, CALLS, USES_CONFIG, CALLS_HTTP) and direction.',
    input_schema: jsonSchemaOf(neighborsInput),
  },
  {
    name: 'find_path',
    description: 'Find the shortest chain of relationships between two piece ids, across repositories. Use it to explain how a request travels.',
    input_schema: jsonSchemaOf(pathInput),
  },
  {
    name: 'read_code',
    description: `Read indexed source code of a file (repo is the full name like "acme/api"). Returns numbered lines, at most ${MAX_READ_LINES}. Only read code when the graph is not enough to answer.`,
    input_schema: jsonSchemaOf(readInput),
  },
  {
    name: 'get_pr_diff',
    description: 'Get the files changed by a GitHub pull request, mapped to graph piece ids where possible. Only works for repositories connected through GitHub.',
    input_schema: jsonSchemaOf(prInput),
  },
  {
    name: 'emit_scene',
    description: 'Render an animated Scene v2 on the canvas. The input is the complete scene. Returns validation errors if the scene is invalid; fix them and call again.',
    input_schema: sceneInputSchema as Anthropic.Beta.BetaTool['input_schema'],
  },
  {
    name: 'upsert_solution',
    description: 'Save a proposed change as a versioned Solution: a short summary, the current and proposed scenes (Scene v2, same rules as emit_scene), an ordered task plan whose nodeRefs are node ids of those scenes, and risks. Pass solutionId to add a new version to an existing solution. Use it when the user wants to change or build something.',
    input_schema: jsonSchemaOf(upsertInput),
  },
];

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const clipText = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const brief = (n: GraphNode) => ({ id: n.id, label: n.label, name: n.name });

const repoNames = (graph: OrgGraph) =>
  new Map(graph.nodes.filter((n) => n.label === 'Repo' && n.repoId).map((n) => [n.repoId as string, String(n.props.fullName ?? n.name)]));

const invalid = (name: string, error: z.ZodError): ToolOutcome => ({
  content: `Invalid input for ${name}: ${error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`,
  isError: true,
  summary: `${name} (invalid input)`,
});

const searchGraph = async (input: z.infer<typeof searchInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const graph = await ctx.loadGraph();
  const repos = repoNames(graph);
  const terms = words(input.query);
  const scored = graph.nodes
    .filter((n) => !input.labels || input.labels.includes(n.label))
    .map((n) => {
      const name = n.name.toLowerCase();
      const summary = n.summary.toLowerCase();
      const id = n.id.toLowerCase();
      const score = terms.reduce((sum, term) => sum + NAME_WEIGHT * count(name, term) + ID_WEIGHT * count(id, term) + count(summary, term), 0);
      return { n, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.n.name.localeCompare(b.n.name))
    .slice(0, input.limit ?? DEFAULT_SEARCH_LIMIT);
  const result = scored.map(({ n }) => ({ ...brief(n), summary: clipText(n.summary, MAX_SUMMARY_CHARS), ...(n.repoId && repos.has(n.repoId) ? { repo: repos.get(n.repoId) } : {}) }));
  return { content: JSON.stringify(result), summary: `search_graph "${input.query}" → ${result.length}` };
};

const getNeighbors = async (input: z.infer<typeof neighborsInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const graph = await ctx.loadGraph();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(input.id);
  if (!node) return { content: `Unknown piece id "${input.id}".`, isError: true, summary: 'get_neighbors (unknown id)' };
  const direction = input.direction ?? 'both';
  const edges = graph.edges
    .filter((e) => !input.types || input.types.includes(e.type))
    .flatMap((e) => {
      const out = e.from === node.id && direction !== 'in' ? [{ type: e.type, direction: 'out' as const, other: byId.get(e.to) }] : [];
      const inc = e.to === node.id && direction !== 'out' ? [{ type: e.type, direction: 'in' as const, other: byId.get(e.from) }] : [];
      return [...out, ...inc];
    })
    .filter((e): e is { type: typeof e.type; direction: 'in' | 'out'; other: GraphNode } => e.other !== undefined)
    .slice(0, MAX_NEIGHBORS)
    .map((e) => ({ type: e.type, direction: e.direction, other: brief(e.other) }));
  return { content: JSON.stringify({ node: { ...brief(node), summary: node.summary }, edges }), summary: `get_neighbors ${node.name} → ${edges.length}` };
};

const findPath = async (input: z.infer<typeof pathInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const graph = await ctx.loadGraph();
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const id of [input.from, input.to]) {
    if (!ids.has(id)) return { content: `Unknown piece id "${id}".`, isError: true, summary: 'find_path (unknown id)' };
  }
  const adjacency = new Map<string, { to: string; type: string }[]>();
  const link = (a: string, b: string, type: string) => adjacency.set(a, [...(adjacency.get(a) ?? []), { to: b, type }]);
  for (const e of graph.edges) {
    link(e.from, e.to, e.type);
    link(e.to, e.from, e.type);
  }
  const maxDepth = input.maxDepth ?? DEFAULT_PATH_DEPTH;
  const previous = new Map<string, { from: string; type: string }>([[input.from, { from: '', type: '' }]]);
  let frontier = [input.from];
  for (let depth = 0; depth < maxDepth && !previous.has(input.to) && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const step of adjacency.get(id) ?? []) {
        if (previous.has(step.to)) continue;
        previous.set(step.to, { from: id, type: step.type });
        next.push(step.to);
      }
    }
    frontier = next;
  }
  if (!previous.has(input.to)) return { content: `No path within ${maxDepth} hops.`, summary: 'find_path → none' };
  const path: string[] = [];
  const edges: string[] = [];
  for (let at = input.to; at !== input.from; at = previous.get(at)!.from) {
    path.unshift(at);
    edges.unshift(previous.get(at)!.type);
  }
  path.unshift(input.from);
  return { content: JSON.stringify({ path, edges }), summary: `find_path → ${edges.length} hops` };
};

const readCode = async (input: z.infer<typeof readInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const source = await ctx.readSource(input.repo, input.path);
  if (!source) return { content: `No indexed file ${input.repo}/${input.path}.`, isError: true, summary: 'read_code (not found)' };
  const lines = source.content.split('\n');
  const start = Math.min(input.startLine ?? 1, lines.length);
  const end = Math.min(input.endLine ?? start + MAX_READ_LINES - 1, lines.length, start + MAX_READ_LINES - 1);
  const body = lines.slice(start - 1, Math.max(start, end)).map((line, i) => `${start + i}: ${line}`).join('\n');
  return { content: `${input.repo}/${input.path} (${source.language})\n${body}`, summary: `read_code ${input.path}:${start}-${end}` };
};

const getPrDiff = async (input: z.infer<typeof prInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const files = await ctx.prFiles(input.repo, input.number);
  if (!files) return { content: `Pull request diffs need a GitHub connection for ${input.repo}.`, isError: true, summary: 'get_pr_diff (not connected)' };
  const graph = await ctx.loadGraph();
  const repoId = [...repoNames(graph).entries()].find(([, name]) => name === input.repo)?.[0];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const mapped = files.slice(0, MAX_PR_FILES).map((f) => {
    const pieceId = repoId ? `file:${repoId}:${f.filename}` : null;
    return { filename: f.filename, status: f.status, pieceId: pieceId && ids.has(pieceId) ? pieceId : null, ...(f.patch === undefined ? {} : { patch: clipText(f.patch, MAX_PATCH_CHARS) }) };
  });
  return { content: JSON.stringify({ files: mapped, truncated: files.length > MAX_PR_FILES }), summary: `get_pr_diff #${input.number} → ${mapped.length} files` };
};

type RawNode = { id?: unknown; parent?: unknown; role?: unknown; complexity?: unknown };
type RawGroup = { nodeIds?: unknown };

/** Fixes harmless rule slips models make (grouping internal pieces, complexity on non-logic pieces) instead of rejecting the scene. */
const repairScene = (input: unknown): { scene: unknown; fixes: string[] } => {
  if (!input || typeof input !== 'object') return { scene: input, fixes: [] };
  const raw = input as { nodes?: unknown; groups?: unknown };
  const fixes: string[] = [];
  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as RawNode[]) : [];
  const topLevel = new Set(nodes.filter((n) => !n.parent).map((n) => n.id));
  const repairedNodes = nodes.map((n) => {
    if (n.complexity === undefined || n.role === 'logic') return n;
    fixes.push(`removed complexity from non-logic piece "${String(n.id)}"`);
    const { complexity: _ignored, ...rest } = n;
    return rest;
  });
  const groups = Array.isArray(raw.groups) ? (raw.groups as RawGroup[]) : undefined;
  const repairedGroups = groups
    ?.map((g) => {
      const ids = Array.isArray(g.nodeIds) ? g.nodeIds : [];
      const kept = ids.filter((id) => topLevel.has(id));
      if (kept.length < ids.length) fixes.push('removed internal pieces from groups (only top-level pieces can be grouped)');
      return { ...g, nodeIds: kept };
    })
    .filter((g) => g.nodeIds.length > 0);
  return { scene: { ...raw, nodes: repairedNodes, ...(repairedGroups ? { groups: repairedGroups } : {}) }, fixes: [...new Set(fixes)] };
};

const emitScene = (input: unknown): ToolOutcome => {
  let result = validateScene(input);
  let fixes: string[] = [];
  if (!result.ok) {
    const repaired = repairScene(input);
    const second = validateScene(repaired.scene);
    if (second.ok) {
      result = second;
      fixes = repaired.fixes;
    }
  }
  if (!result.ok) {
    return { content: `The scene is invalid:\n${result.errors.slice(0, MAX_ERRORS).join('\n')}`, isError: true, summary: 'emit_scene (invalid)' };
  }
  const { scene } = result;
  const note = fixes.length > 0 ? ` Auto-fixed: ${fixes.join('; ')}.` : '';
  return { content: `Scene "${scene.title}" rendered with ${scene.nodes.length} pieces and ${scene.steps.length} steps.${note}`, scene, summary: `emit_scene "${scene.title}"` };
};

const upsertSolution = async (input: z.infer<typeof upsertInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const { solutionId, title, ...draft } = input;
  const result = validateSolutionDraft(draft);
  if (!result.ok) return { content: `The solution is invalid:\n${result.errors.slice(0, MAX_ERRORS).join('\n')}`, isError: true, summary: 'upsert_solution (invalid)' };
  try {
    const saved = await ctx.upsertSolution({ solutionId, title, draft });
    return { content: `Solution "${saved.title}" saved as version ${saved.n} (id ${saved.id}).`, solution: saved, summary: `upsert_solution "${saved.title}" v${saved.n}` };
  } catch (error) {
    if (error instanceof SolutionError) return { content: `Could not save the solution: ${error.code} ${error.errors.join('; ')}`.trim(), isError: true, summary: 'upsert_solution (rejected)' };
    throw error;
  }
};

export const executeTool = async (name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> => {
  try {
    return await runTool(name, input, ctx);
  } catch (error) {
    return { content: `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true, summary: `${name} (failed)` };
  }
};

const searchCode = async (input: z.infer<typeof codeSearchInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const matches = await ctx.searchCode(input.query, input.repo);
  return { content: JSON.stringify({ matches }), summary: `search_code "${input.query}" → ${matches.length}` };
};

const runTool = async (name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> => {
  switch (name) {
    case 'search_code': {
      const parsed = codeSearchInput.safeParse(input);
      return parsed.success ? searchCode(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'search_graph': {
      const parsed = searchInput.safeParse(input);
      return parsed.success ? searchGraph(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'get_neighbors': {
      const parsed = neighborsInput.safeParse(input);
      return parsed.success ? getNeighbors(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'find_path': {
      const parsed = pathInput.safeParse(input);
      return parsed.success ? findPath(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'read_code': {
      const parsed = readInput.safeParse(input);
      return parsed.success ? readCode(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'get_pr_diff': {
      const parsed = prInput.safeParse(input);
      return parsed.success ? getPrDiff(parsed.data, ctx) : invalid(name, parsed.error);
    }
    case 'emit_scene':
      return emitScene(input);
    case 'upsert_solution': {
      const parsed = upsertInput.safeParse(input);
      return parsed.success ? upsertSolution(parsed.data, ctx) : invalid(name, parsed.error);
    }
    default:
      return { content: `Unknown tool "${name}".`, isError: true, summary: `${name} (unknown)` };
  }
};
