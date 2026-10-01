import { SOLUTION_STATUSES, TASK_STATUSES } from '@rdi/scene';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { listSolutions, updateSolution } from '../db/queries/solutions';
import { fail, isUuid, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';
import { publishSolutionEvent, solutionChannel } from '../solutions/events';
import { createFromDraft, proposeVersion, reportTask, solutionDetail, SolutionError } from '../solutions/service';

const MAX_TITLE = 200;
const HEARTBEAT_MS = 15_000;
const createBody = z.object({ title: z.string().trim().min(1).max(MAX_TITLE), draft: z.record(z.string(), z.unknown()) });
const versionBody = z.object({ draft: z.record(z.string(), z.unknown()) });
const patchBody = z.object({ title: z.string().trim().min(1).max(MAX_TITLE).optional(), status: z.enum(SOLUTION_STATUSES).optional() });
const taskBody = z.object({ status: z.enum(TASK_STATUSES), note: z.string().max(2000).optional() });
const detailQuery = z.object({ version: z.coerce.number().int().positive().optional() });

export const failSolution = (reply: FastifyReply, error: unknown) => {
  if (!(error instanceof SolutionError)) throw error;
  if (error.code === 'invalid_draft') return fail(reply, 422, 'invalid_draft', { errors: error.errors });
  return fail(reply, 404, error.code);
};

export const solutionRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const idOf = (params: unknown) => (params as { id: string }).id;

  api.get('/orgs/:orgId/solutions', { preHandler: member }, async (req) =>
    (await listSolutions(deps.pool, req.member!.org.id)).map((s) => ({
      id: s.id, title: s.title, status: s.status, latestVersion: s.latest_n, progress: { done: s.tasks_done, total: s.tasks_total }, updatedAt: s.updated_at.toISOString(),
    })));

  api.post('/orgs/:orgId/solutions', { preHandler: member }, async (req, reply) => {
    const body = createBody.parse(req.body);
    try {
      return reply.code(201).send(await createFromDraft(deps, { orgId: req.member!.org.id, userId: req.auth!.user.id, title: body.title, conversationId: null, author: 'web', input: body.draft }));
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.get('/orgs/:orgId/solutions/:id', { preHandler: member }, async (req, reply) => {
    const id = idOf(req.params);
    const { version } = detailQuery.parse(req.query);
    const detail = isUuid(id) ? await solutionDetail(deps, req.member!.org.id, id, version) : null;
    return detail ?? fail(reply, 404, 'not_found');
  });

  api.post('/orgs/:orgId/solutions/:id/versions', { preHandler: member }, async (req, reply) => {
    const id = idOf(req.params);
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    try {
      return reply.code(201).send(await proposeVersion(deps, { orgId: req.member!.org.id, solutionId: id, author: 'web', input: versionBody.parse(req.body).draft }));
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.patch('/orgs/:orgId/solutions/:id', { preHandler: member }, async (req, reply) => {
    const id = idOf(req.params);
    const body = patchBody.parse(req.body);
    if (!isUuid(id) || !(await solutionDetail(deps, req.member!.org.id, id))) return fail(reply, 404, 'not_found');
    await updateSolution(deps.pool, id, body);
    await publishSolutionEvent(deps.redis, id, { type: 'meta' });
    return reply.code(204).send();
  });

  api.patch('/orgs/:orgId/solutions/:id/tasks/:taskId', { preHandler: member }, async (req, reply) => {
    const { id, taskId } = req.params as { id: string; taskId: string };
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    const body = taskBody.parse(req.body);
    try {
      await reportTask(deps, { orgId: req.member!.org.id, solutionId: id, taskId, status: body.status, note: body.note ?? null });
      return reply.code(204).send();
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.get('/orgs/:orgId/solutions/:id/events', { preHandler: member }, async (req, reply) => {
    const id = idOf(req.params);
    if (!isUuid(id) || !(await solutionDetail(deps, req.member!.org.id, id))) return fail(reply, 404, 'not_found');
    const subscriber = deps.redis.duplicate();
    await subscriber.subscribe(solutionChannel(id));
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.write(': connected\n\n');
    subscriber.on('message', (_channel, message) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: solution\ndata: ${message}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, HEARTBEAT_MS);
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      subscriber.disconnect();
    });
    return reply;
  });
};
