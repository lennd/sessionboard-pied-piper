import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { fail, isUuid } from '../http/fail';
import { nowOf, type AppDeps } from '../http/deps';
import { requireScope } from '../http/scope';
import { listSummaries } from '../solutions/service';
import { createFeature, FEATURE_STATUSES, listFeatures, removeFeature, updateFeature, type FeatureFile } from '../store/features';
import { listRepos } from '../store/repos';
import { insideRepo, languageOf, MAX_CODE_LINES, sliceLines } from './code';

const MAX_TITLE = 200;
const MAX_BRIEF = 40_000;
const MAX_REPOS = 12;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const createBody = z.object({ title: z.string().trim().min(1).max(MAX_TITLE), repoIds: z.array(z.string().min(1)).min(1).max(MAX_REPOS), brief: z.string().max(MAX_BRIEF).optional() });
const patchBody = z.object({ title: z.string().trim().min(1).max(MAX_TITLE).optional(), repoIds: z.array(z.string().min(1)).min(1).max(MAX_REPOS).optional(), brief: z.string().max(MAX_BRIEF).optional(), status: z.enum(FEATURE_STATUSES).optional() });
const codeQuery = z.object({ repo: z.string().min(1), path: z.string().min(1).max(500), start: z.coerce.number().int().optional(), end: z.coerce.number().int().optional() });

export const featureRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const home = deps.config.home;
  const publicFeature = async (feature: FeatureFile) => {
    const repos = await listRepos(home);
    const [plan] = await listSummaries(`${home}/features/${feature.id}`);
    return {
      ...feature,
      repos: feature.repoIds.map((id) => {
        const repo = repos.find((r) => r.id === id);
        return repo ? { id, name: repo.name, path: repo.path, available: true } : { id, name: id, path: null, available: false };
      }),
      plan: plan ? { id: plan.id, status: plan.status, latestVersion: plan.latestVersion, progress: plan.progress } : null,
    };
  };
  const validRepoIds = async (ids: string[]) => {
    const known = new Set((await listRepos(home)).map((r) => r.id));
    return ids.every((id) => known.has(id));
  };

  api.get('/features', async () => Promise.all((await listFeatures(home)).map(publicFeature)));

  api.post('/features', async (req, reply) => {
    const body = createBody.parse(req.body);
    if (!(await validRepoIds(body.repoIds))) return fail(reply, 400, 'unknown_repo');
    return reply.code(201).send(await publicFeature(await createFeature(home, nowOf(deps), body)));
  });

  api.get('/features/:featureId', { preHandler: [requireScope(deps)] }, async (req) => publicFeature(req.scope!.feature!));

  api.patch('/features/:featureId', async (req, reply) => {
    const { featureId } = req.params as { featureId: string };
    const body = patchBody.parse(req.body);
    if (!isUuid(featureId)) return fail(reply, 404, 'feature_not_found');
    if (body.repoIds && !(await validRepoIds(body.repoIds))) return fail(reply, 400, 'unknown_repo');
    const updated = await updateFeature(home, featureId, nowOf(deps), body);
    return updated ? publicFeature(updated) : fail(reply, 404, 'feature_not_found');
  });

  api.delete('/features/:featureId', async (req, reply) => {
    const { featureId } = req.params as { featureId: string };
    return isUuid(featureId) && (await removeFeature(home, featureId)) ? reply.code(204).send() : fail(reply, 404, 'feature_not_found');
  });

  /** Code of any repository of the feature, addressed by repository name (what scenes carry in code.repo). */
  api.get('/features/:featureId/code', { preHandler: [requireScope(deps)] }, async (req, reply) => {
    const query = codeQuery.parse(req.query);
    const root = req.scope!.roots.find((r) => r.name === query.repo || r.id === query.repo);
    if (!root) return fail(reply, 404, 'not_found');
    const absolute = insideRepo(root.path, query.path);
    if (!absolute) return fail(reply, 404, 'not_found');
    let content: string;
    try {
      const buffer = await readFile(absolute);
      if (buffer.byteLength > MAX_FILE_BYTES) return fail(reply, 413, 'file_too_large');
      content = buffer.toString('utf8');
    } catch {
      return fail(reply, 404, 'not_found');
    }
    const start = query.start ?? 1;
    return { repo: root.name, path: query.path, language: languageOf(query.path), ...sliceLines(content, start, query.end ?? start + MAX_CODE_LINES - 1) };
  });

};
