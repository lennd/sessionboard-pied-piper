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
const REFRESH_MIN_INTERVAL_MS = 10_000;
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
    const cachedRaw = await deps.redis.get(cacheKey);
    const cached = cachedRaw ? (JSON.parse(cachedRaw) as { fetchedAt?: number }) : null;
    const refresh = Boolean(listQuery.parse(req.query).refresh);
    if (cached && (!refresh || Date.now() - (cached.fetchedAt ?? 0) < REFRESH_MIN_INTERVAL_MS)) {
      const { fetchedAt: _ignored, ...body } = cached;
      return body;
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
    await deps.redis.set(cacheKey, JSON.stringify({ ...body, fetchedAt: Date.now() }), 'EX', CACHE_TTL_SECONDS);
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
    let pull: Awaited<ReturnType<typeof active.client.getPull>>;
    let files: Awaited<ReturnType<typeof active.client.listPullFiles>>;
    try {
      [pull, files] = await Promise.all([
        active.client.getPull(installation, fullName, params.data.number),
        active.client.listPullFiles(installation, fullName, params.data.number),
      ]);
    } catch {
      return fail(reply, 502, 'github_failed');
    }
    let scene: unknown = null;
    try {
      const graph = deps.graph ? await deps.graph.readOrgGraph(orgId) : { nodes: [], edges: [] };
      scene = buildPullRequestImpact({ graph, repoFullName: fullName, pull, files });
    } catch (error) {
      req.log.error(error);
    }
    return { pull, files: files.map(({ patch: _patch, ...file }) => file), scene };
  });
};
