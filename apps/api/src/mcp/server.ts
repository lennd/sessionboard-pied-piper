import type { GraphStore } from '@rdi/graph';
import { SOLUTION_STATUSES, TASK_STATUSES, type Scene } from '@rdi/scene';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { z } from 'zod';
import { executeTool, type ToolContext } from '../agent/tools';
import { listSolutions } from '../db/queries/solutions';
import { readSource } from '../db/queries/agent';
import { MCP_SERVER_NAME } from '../routes/tokens';
import { proposeVersion, reportTask, solutionDetail, SolutionError } from '../solutions/service';

export type McpContext = { orgId: string; userId: string; pool: pg.Pool; redis: Redis; graph?: GraphStore };
const SERVER_VERSION = '1.0.0';
const MAX_NEIGHBORS = 12;

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ ...text(message), isError: true });
const solutionFailure = (error: unknown) => {
  if (!(error instanceof SolutionError)) throw error;
  if (error.code === 'not_found') return failure('Solution not found.');
  if (error.code === 'unknown_task') return failure('That task is not part of the latest version of the plan.');
  return failure(`The solution is invalid:\n${error.errors.join('\n')}`);
};

export const buildMcpServer = (ctx: McpContext): McpServer => {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: SERVER_VERSION });
  const deps = { pool: ctx.pool, redis: ctx.redis };
  const toolContext: ToolContext = {
    loadGraph: () => (ctx.graph ? ctx.graph.readOrgGraph(ctx.orgId) : Promise.resolve({ nodes: [], edges: [] })),
    readSource: (repo, path) => readSource(ctx.pool, ctx.orgId, repo, path),
    prFiles: async () => null,
    upsertSolution: async () => {
      throw new SolutionError('not_found');
    },
  };

  server.registerTool('list_solutions', {
    description: 'List the Solutions of the organization (planned changes designed in Repository Designer).',
    inputSchema: { status: z.enum(SOLUTION_STATUSES).optional() },
  }, async ({ status }) => {
    const rows = (await listSolutions(ctx.pool, ctx.orgId)).filter((s) => !status || s.status === status);
    return text(rows.map((s) => ({ id: s.id, title: s.title, status: s.status, latestVersion: s.latest_n, progress: { done: s.tasks_done, total: s.tasks_total } })));
  });

  server.registerTool('get_solution', {
    description: 'Get a Solution: summary, ordered task plan with status, risks, current/proposed scenes and context for every piece the tasks touch (graph summary, neighbours and code locations). Call this before implementing.',
    inputSchema: { id: z.string().uuid(), version: z.number().int().positive().optional() },
  }, async ({ id, version }) => {
    const detail = await solutionDetail(deps, ctx.orgId, id, version);
    if (!detail) return failure('Solution not found.');
    const { draft } = detail.version;
    const pieces = new Map([...(draft.sceneCurrent?.nodes ?? []), ...(draft.sceneProposed?.nodes ?? [])].map((n) => [n.id, n]));
    const graph = ctx.graph ? await ctx.graph.readOrgGraph(ctx.orgId) : { nodes: [], edges: [] };
    const graphNodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const referenced = new Set(draft.plan.flatMap((t) => t.nodeRefs));
    const context = Object.fromEntries([...referenced].flatMap((ref) => {
      const piece = pieces.get(ref);
      if (!piece) return [];
      const g = piece.graphRef ? graphNodes.get(piece.graphRef) : undefined;
      const neighbors = g
        ? graph.edges.filter((e) => e.from === g.id || e.to === g.id).slice(0, MAX_NEIGHBORS).map((e) => ({ type: e.type, direction: e.from === g.id ? 'out' : 'in', name: graphNodes.get(e.from === g.id ? e.to : e.from)?.name ?? '' }))
        : [];
      return [[ref, { label: piece.label, kind: piece.kind, summary: piece.summary, ...(piece.code ? { code: piece.code } : {}), ...(g ? { graph: { id: g.id, summary: g.summary, neighbors } } : {}) }]];
    }));
    const sceneBrief = (scene: Scene | null) => (scene ? { title: scene.title, nodes: scene.nodes.map((n) => ({ id: n.id, label: n.label, role: n.role, kind: n.kind, change: n.change ?? null, parent: n.parent ?? null })) } : null);
    return text({
      id: detail.id, title: detail.title, status: detail.status, version: detail.version.n, summary: draft.summary,
      plan: draft.plan.map((t) => ({ ...t, status: detail.tasks[t.id]?.status ?? 'todo', note: detail.tasks[t.id]?.note ?? null })),
      risks: draft.risks, scenes: { current: sceneBrief(draft.sceneCurrent), proposed: sceneBrief(draft.sceneProposed) }, context,
    });
  });

  server.registerTool('query_graph', {
    description: 'Query the organization System Graph: action "search" (query), "neighbors" (id) or "path" (from, to).',
    inputSchema: { action: z.enum(['search', 'neighbors', 'path']), query: z.string().optional(), id: z.string().optional(), from: z.string().optional(), to: z.string().optional() },
  }, async ({ action, query, id, from, to }) => {
    const outcome =
      action === 'search' ? await executeTool('search_graph', { query }, toolContext)
      : action === 'neighbors' ? await executeTool('get_neighbors', { id }, toolContext)
      : await executeTool('find_path', { from, to }, toolContext);
    return outcome.isError ? failure(outcome.content) : text(outcome.content);
  });

  server.registerTool('update_solution', {
    description: 'Save a new version of a Solution as Claude Code (for example after discovering the plan must change). Fields you omit are kept from the latest version.',
    inputSchema: {
      id: z.string().uuid(), summary: z.string().min(1).max(4000),
      plan: z.array(z.record(z.string(), z.unknown())).optional(), risks: z.array(z.record(z.string(), z.unknown())).optional(),
      sceneProposed: z.record(z.string(), z.unknown()).optional(), sceneCurrent: z.record(z.string(), z.unknown()).optional(),
    },
  }, async ({ id, ...draft }) => {
    try {
      const { n } = await proposeVersion(deps, { orgId: ctx.orgId, solutionId: id, author: 'claude-code', input: draft, merge: true });
      return text(`Saved version ${n}.`);
    } catch (error) {
      return solutionFailure(error);
    }
  });

  server.registerTool('report_task_progress', {
    description: 'Report progress on a task of the latest plan: in_progress when you start, done when finished (with a short note such as the PR or commit), blocked with the reason.',
    inputSchema: { id: z.string().uuid(), taskId: z.string().min(1), status: z.enum(TASK_STATUSES), note: z.string().max(2000).optional() },
  }, async ({ id, taskId, status, note }) => {
    try {
      await reportTask(deps, { orgId: ctx.orgId, solutionId: id, taskId, status, note: note ?? null });
      return text(`Task ${taskId} is now ${status}.`);
    } catch (error) {
      return solutionFailure(error);
    }
  });

  return server;
};
