import { relinkOrg } from '@rdi/graph';
import { buildSystemMap } from '@rdi/indexer';
import { DEMO_REPOS } from '@rdi/providers';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPO_LIMIT } from '../domain/constants';
import { findInstallationForOrg } from '../db/queries/github';
import { countRepos, deleteRepoRow, findRepo, insertPendingRepo, listRepos, resetRepoStages } from '../db/queries/repos';
import { fail, isUuid, requireAction, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';
import { publicRepo } from '../http/payloads';

type Available = { fullName: string; defaultBranch: string; source: 'github' | 'demo' };
const MAX_REPO_NAME = 200;

export const repoRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const manage = [...member, requireAction('repos.manage')];

  const availableFor = async (orgId: string): Promise<{ repos: Available[]; installationRowId: string | null }> => {
    const installation = await findInstallationForOrg(deps.pool, orgId);
    if (installation && deps.github) {
      const repos = await deps.github.listInstallationRepos(Number(installation.installation_id));
      return { repos: repos.map((r) => ({ fullName: r.fullName, defaultBranch: r.defaultBranch, source: 'github' as const })), installationRowId: installation.id };
    }
    const repos = deps.config.demoRepos ? DEMO_REPOS.map((r) => ({ fullName: r.fullName, defaultBranch: r.defaultBranch, source: 'demo' as const })) : [];
    return { repos, installationRowId: null };
  };

  api.get('/orgs/:orgId/integrations', { preHandler: member }, async (req) => {
    const installation = await findInstallationForOrg(deps.pool, req.member!.org.id);
    return {
      github: { configured: Boolean(deps.config.github && deps.github), installation: installation ? { accountLogin: installation.account_login } : null },
      demo: { available: deps.config.demoRepos },
    };
  });

  api.get('/orgs/:orgId/available-repos', { preHandler: member }, async (req) => {
    const orgId = req.member!.org.id;
    const existing = new Set((await listRepos(deps.pool, orgId)).map((r) => r.full_name));
    return (await availableFor(orgId)).repos.filter((r) => !existing.has(r.fullName));
  });

  api.post('/orgs/:orgId/repos', { preHandler: manage }, async (req, reply) => {
    const { fullName } = z.object({ fullName: z.string().min(1).max(MAX_REPO_NAME) }).parse(req.body);
    const orgId = req.member!.org.id;
    const { repos, installationRowId } = await availableFor(orgId);
    const chosen = repos.find((r) => r.fullName === fullName);
    if (!chosen) return fail(reply, 404, 'not_found');
    if ((await countRepos(deps.pool, orgId)) >= REPO_LIMIT) return fail(reply, 409, 'repo_limit');
    const repo = await insertPendingRepo(deps.pool, { orgId, fullName, defaultBranch: chosen.defaultBranch, installationRowId: chosen.source === 'github' ? installationRowId : null });
    await deps.indexQueue?.enqueue({ repoId: repo.id, orgId, reason: 'added' });
    return reply.code(201).send(publicRepo(repo));
  });

  api.post('/orgs/:orgId/repos/:repoId/reindex', { preHandler: manage }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const orgId = req.member!.org.id;
    if (!isUuid(repoId) || (await resetRepoStages(deps.pool, orgId, repoId)) === 0) return fail(reply, 404, 'not_found');
    await deps.indexQueue?.enqueue({ repoId, orgId, reason: 'reindex' });
    return reply.code(202).send({ ok: true });
  });

  api.delete('/orgs/:orgId/repos/:repoId', { preHandler: manage }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const orgId = req.member!.org.id;
    if (!isUuid(repoId) || !(await findRepo(deps.pool, orgId, repoId))) return fail(reply, 404, 'not_found');
    await deleteRepoRow(deps.pool, orgId, repoId);
    if (deps.graph) {
      await deps.graph.deleteRepo(orgId, repoId);
      await relinkOrg(deps.graph, orgId);
    }
    return reply.code(204).send();
  });

  api.get('/orgs/:orgId/system-map', { preHandler: member }, async (req, reply) => {
    if (!deps.graph) return fail(reply, 404, 'not_found');
    const scene = buildSystemMap(await deps.graph.readOrgGraph(req.member!.org.id));
    return scene ?? fail(reply, 404, 'not_found');
  });
};
