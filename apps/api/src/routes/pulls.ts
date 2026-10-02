import { buildPullRequestImpact } from '@rdi/indexer';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findRepoInstallation } from '../db/queries/agent';
import { listRepoInstallations } from '../db/queries/github';
import { resolveGithubApp } from '../github/app';
import { fail, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';

const CACHE_PREFIX = 'rdi:pulls:';
const CACHE_TTL_SECONDS = 60;
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

const listQuery = z.object({ refresh: z.string().optional() });
const detailParams = z.object({ owner: z.string().regex(SEGMENT), repo: z.string().regex(SEGMENT), number: z.coerce.number().int().positive() });

export const pullRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];

  api.get('/orgs/:orgId/pulls', { preHandler: member }, async (req) => {
    const orgId = req.member!.org.id;
    const active = await resolveGithubApp(deps);
    if (!active) return { configured: false, repos: [] };
    const cacheKey = `${CACHE_PREFIX}${orgId}`;
    if (!listQuery.parse(req.query).refresh) {
      const cached = await deps.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as unknown;
    }
    const repos = await listRepoInstallations(deps.pool, orgId);
    const results = await Promise.allSettled(repos.map((r) => active.client.listOpenPulls(r.installation_id, r.full_name)));
    const body = {
      configured: true,
      repos: repos.map((r, i) => {
        const result = results[i]!;
        return result.status === 'fulfilled' ? { repo: r.full_name, status: 'ok', pulls: result.value } : { repo: r.full_name, status: 'unavailable', pulls: [] };
      }),
    };
    await deps.redis.set(cacheKey, JSON.stringify(body), 'EX', CACHE_TTL_SECONDS);
    return body;
  });

  api.get('/orgs/:orgId/pulls/:owner/:repo/:number', { preHandler: member }, async (req, reply) => {
    const params = detailParams.safeParse(req.params);
    if (!params.success) return fail(reply, 404, 'not_found');
    const orgId = req.member!.org.id;
    const fullName = `${params.data.owner}/${params.data.repo}`;
    const installation = await findRepoInstallation(deps.pool, orgId, fullName);
    const active = installation !== null ? await resolveGithubApp(deps) : null;
    if (installation === null || !active) return fail(reply, 404, 'not_found');
    try {
      const [pull, files] = await Promise.all([
        active.client.getPull(installation, fullName, params.data.number),
        active.client.listPullFiles(installation, fullName, params.data.number),
      ]);
      const graph = deps.graph ? await deps.graph.readOrgGraph(orgId) : { nodes: [], edges: [] };
      const scene = buildPullRequestImpact({ graph, repoFullName: fullName, pull, files });
      return { pull, files: files.map(({ patch: _patch, ...file }) => file), scene };
    } catch {
      return fail(reply, 502, 'github_failed');
    }
  });
};
