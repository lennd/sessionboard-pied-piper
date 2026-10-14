import { SOLUTION_STATUSES, TASK_STATUSES, type Scene } from '@rdi/scene';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EventEmitter } from 'node:events';
import { z } from 'zod';
import { listSummaries, proposeVersion, reportTask, solutionDetail, SolutionError } from '../solutions/service';

export type McpContext = { dir: string; events: EventEmitter; now: () => Date; systemMap: () => Promise<Scene | null> };
export const MCP_SERVER_NAME = 'rdi';
const SERVER_VERSION = '2.0.0';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ ...text(message), isError: true });
const solutionFailure = (error: unknown) => {
  if (!(error instanceof SolutionError)) throw error;
  if (error.code === 'not_found') return failure('Solution not found.');
  if (error.code === 'unknown_task') return failure('That task is not part of the latest version of the plan.');
  if (error.code === 'stale_version') return failure(error.errors[0] ?? 'The solution changed. Call get_solution again.');
  return failure(`The solution is invalid:\n${error.errors.join('\n')}`);
};
const sceneBrief = (scene: Scene | null) =>
  scene ? { title: scene.title, nodes: scene.nodes.map((n) => ({ id: n.id, label: n.label, role: n.role, kind: n.kind, change: n.change ?? null, parent: n.parent ?? null, code: n.code ?? null })) } : null;

export const buildMcpServer = (ctx: McpContext): McpServer => {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: SERVER_VERSION });
  const deps = () => ({ dir: ctx.dir, events: ctx.events, now: ctx.now() });

  server.registerTool('list_solutions', {
    description: 'List the Solutions of this repository (planned changes designed in Pied Pieper).',
    inputSchema: { status: z.enum(SOLUTION_STATUSES).optional() },
  }, async ({ status }) => text((await listSummaries(ctx.dir)).filter((s) => !status || s.status === status)));

  server.registerTool('get_solution', {
    description: 'Get a Solution: summary, ordered task plan with status, risks, current/proposed scenes and the code locations of every piece the tasks touch. Call this before implementing.',
    inputSchema: { id: z.string().uuid(), version: z.number().int().positive().optional() },
  }, async ({ id, version }) => {
    const detail = await solutionDetail(ctx.dir, id, version);
    if (!detail) return failure('Solution not found.');
    const { draft } = detail.version;
    const pieces = new Map([...(draft.sceneCurrent?.nodes ?? []), ...(draft.sceneProposed?.nodes ?? [])].map((n) => [n.id, n]));
    const referenced = new Set(draft.plan.flatMap((t) => t.nodeRefs));
    const context = Object.fromEntries([...referenced].flatMap((ref) => {
      const piece = pieces.get(ref);
      return piece ? [[ref, { label: piece.label, kind: piece.kind, summary: piece.summary, ...(piece.code ? { code: piece.code } : {}) }]] : [];
    }));
    return text({
      id: detail.id, title: detail.title, status: detail.status, version: detail.version.n, summary: draft.summary,
      plan: draft.plan.map((t) => ({ ...t, status: detail.tasks[t.id]?.status ?? 'todo', note: detail.tasks[t.id]?.note ?? null })),
      risks: draft.risks, scenes: { current: sceneBrief(draft.sceneCurrent), proposed: sceneBrief(draft.sceneProposed) }, context,
    });
  });

  server.registerTool('get_system_map', {
    description: 'Get the architecture map of the repository as last drawn by Pied Pieper: pieces with their code locations and the edges between them.',
    inputSchema: {},
  }, async () => {
    const map = await ctx.systemMap();
    return map ? text({ ...sceneBrief(map), edges: map.edges }) : failure('No system map has been drawn for the current commit yet.');
  });

  server.registerTool('update_solution', {
    description: 'Save a new version of a Solution as Claude Code (for example after discovering the plan must change). summary is required; the other fields you omit are kept from the latest version. Pass baseVersion (the version you read with get_solution) so concurrent changes are not overwritten.',
    inputSchema: {
      id: z.string().uuid(), baseVersion: z.number().int().positive().optional(), summary: z.string().min(1).max(4000),
      plan: z.array(z.record(z.string(), z.unknown())).optional(), risks: z.array(z.record(z.string(), z.unknown())).optional(),
      sceneProposed: z.record(z.string(), z.unknown()).optional(), sceneCurrent: z.record(z.string(), z.unknown()).optional(),
    },
  }, async ({ id, baseVersion, ...draft }) => {
    try {
      const { n } = await proposeVersion(deps(), { solutionId: id, author: 'claude-code', input: draft, merge: true, baseVersion });
      return text(`Saved version ${n}.`);
    } catch (error) {
      return solutionFailure(error);
    }
  });

  server.registerTool('report_task_progress', {
    description: 'Report progress on a task of the latest plan: in_progress when you start, done when finished (with a short note such as the commit), blocked with the reason.',
    inputSchema: { id: z.string().uuid(), taskId: z.string().min(1), status: z.enum(TASK_STATUSES), note: z.string().max(2000).optional() },
  }, async ({ id, taskId, status, note }) => {
    try {
      await reportTask(deps(), { solutionId: id, taskId, status, note: note ?? null });
      return text(`Task ${taskId} is now ${status}.`);
    } catch (error) {
      return solutionFailure(error);
    }
  });

  return server;
};
