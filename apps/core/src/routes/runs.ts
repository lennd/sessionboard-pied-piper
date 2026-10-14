import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail, isUuid } from '../http/fail';
import { nowOf, type AppDeps } from '../http/deps';
import { requireRepo } from '../http/repo';
import { mcpUrl } from '../mcp/route';
import { solutionDetail } from '../solutions/service';
import { repoDir } from '../store/repos';
import { readToolkit } from '../store/toolkit';

const HEARTBEAT_MS = 15_000;
const decisionBody = z.object({ allow: z.boolean() });

export const runRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const withRepo = [requireRepo(deps)];

  api.post('/repos/:repoId/solutions/:id/run', { preHandler: withRepo }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = req.repo!;
    if (!isUuid(id) || !(await solutionDetail(repoDir(repo), id))) return fail(reply, 404, 'not_found');
    if (!deps.queryFn) return fail(reply, 409, 'agent_not_configured');
    const started = deps.runs.start({ repoId: repo.id, repoPath: repo.path, solutionId: id, queryFn: deps.queryFn, agent: deps.config.agent, mcpHttpUrl: mcpUrl(deps.config, repo.id), now: () => nowOf(deps), toolkit: await readToolkit(repoDir(repo)) });
    if ('error' in started) return fail(reply, 409, started.error);
    return reply.code(201).send(started);
  });

  api.get('/repos/:repoId/runs', { preHandler: withRepo }, async (req) => deps.runs.list(req.repo!.id));

  api.get('/repos/:repoId/runs/:runId', { preHandler: withRepo }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = deps.runs.get(runId);
    return run && run.repoId === req.repo!.id ? run : fail(reply, 404, 'not_found');
  });

  api.get('/repos/:repoId/runs/:runId/events', { preHandler: withRepo }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = deps.runs.get(runId);
    if (!run || run.repoId !== req.repo!.id) return fail(reply, 404, 'not_found');
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (data: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: run\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const stop = deps.runs.subscribe(runId, send);
    for (const event of run.events) send(event);
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, HEARTBEAT_MS);
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      stop?.();
    });
    return reply;
  });

  api.post('/repos/:repoId/runs/:runId/cancel', { preHandler: withRepo }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = deps.runs.get(runId);
    if (!run || run.repoId !== req.repo!.id) return fail(reply, 404, 'not_found');
    return deps.runs.cancel(runId) ? reply.code(204).send() : fail(reply, 409, 'not_running');
  });

  api.post('/repos/:repoId/runs/:runId/permissions/:permissionId', { preHandler: withRepo }, async (req, reply) => {
    const { runId, permissionId } = req.params as { runId: string; permissionId: string };
    const { allow } = decisionBody.parse(req.body);
    const run = deps.runs.get(runId);
    if (!run || run.repoId !== req.repo!.id) return fail(reply, 404, 'not_found');
    return deps.runs.resolvePermission(runId, permissionId, allow) ? reply.code(204).send() : fail(reply, 404, 'permission_not_pending');
  });
};
