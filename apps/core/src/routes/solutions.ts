import { SOLUTION_STATUSES, TASK_STATUSES } from '@rdi/scene';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { fail, isUuid } from '../http/fail';
import { nowOf, type AppDeps } from '../http/deps';
import { requireScope } from '../http/scope';
import { createFromDraft, listSummaries, proposeVersion, reportTask, SOLUTION_EVENT, solutionDetail, SolutionError, updateMeta, type SolutionEvent } from '../solutions/service';

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
  if (error.code === 'stale_version') return fail(reply, 409, 'stale_version', { errors: error.errors });
  return fail(reply, 404, error.code);
};

/** Solutions of one scope; mounted once per prefix (`/repos/:repoId`, `/features/:featureId`). */
export const solutionRoutes = (api: FastifyInstance, deps: AppDeps, prefix = '/repos/:repoId') => {
  const withRepo = [requireScope(deps)];
  const url = (path: string) => `${prefix}${path}`;
  const idOf = (params: unknown) => (params as { id: string }).id;
  const depsFor = (dir: string) => ({ dir, events: deps.events, now: nowOf(deps) });

  api.get(url('/solutions'), { preHandler: withRepo }, async (req) => listSummaries(req.scope!.dir));

  api.post(url('/solutions'), { preHandler: withRepo }, async (req, reply) => {
    const body = createBody.parse(req.body);
    try {
      return reply.code(201).send(await createFromDraft(depsFor(req.scope!.dir), { title: body.title, conversationId: null, author: 'web', input: body.draft }));
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.get(url('/solutions/:id'), { preHandler: withRepo }, async (req, reply) => {
    const id = idOf(req.params);
    const { version } = detailQuery.parse(req.query);
    const detail = isUuid(id) ? await solutionDetail(req.scope!.dir, id, version) : null;
    return detail ?? fail(reply, 404, 'not_found');
  });

  api.post(url('/solutions/:id/versions'), { preHandler: withRepo }, async (req, reply) => {
    const id = idOf(req.params);
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    try {
      return reply.code(201).send(await proposeVersion(depsFor(req.scope!.dir), { solutionId: id, author: 'web', input: versionBody.parse(req.body).draft }));
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.patch(url('/solutions/:id'), { preHandler: withRepo }, async (req, reply) => {
    const id = idOf(req.params);
    const body = patchBody.parse(req.body);
    if (!isUuid(id) || !(await updateMeta(depsFor(req.scope!.dir), id, body))) return fail(reply, 404, 'not_found');
    return reply.code(204).send();
  });

  api.patch(url('/solutions/:id/tasks/:taskId'), { preHandler: withRepo }, async (req, reply) => {
    const { id, taskId } = req.params as { id: string; taskId: string };
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    const body = taskBody.parse(req.body);
    try {
      await reportTask(depsFor(req.scope!.dir), { solutionId: id, taskId, status: body.status, note: body.note ?? null });
      return reply.code(204).send();
    } catch (error) {
      return failSolution(reply, error);
    }
  });

  api.get(url('/solutions/:id/events'), { preHandler: withRepo }, async (req, reply) => {
    const id = idOf(req.params);
    if (!isUuid(id) || !(await solutionDetail(req.scope!.dir, id))) return fail(reply, 404, 'not_found');
    const listener = (event: SolutionEvent) => {
      if (event.solutionId === id && !reply.raw.writableEnded) reply.raw.write(`event: solution\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, HEARTBEAT_MS);
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      deps.events.off(SOLUTION_EVENT, listener);
    });
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    deps.events.on(SOLUTION_EVENT, listener);
    reply.raw.write(': connected\n\n');
    return reply;
  });
};
