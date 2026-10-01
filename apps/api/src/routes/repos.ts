import { buildSystemMap } from '@rdi/indexer';
import { DEMO_REPOS } from '@rdi/providers';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPO_LIMIT } from '../domain/constants';
import { listInstallationsForOrg } from '../db/queries/github';
import { manifestAvailable, resolveGithubApp } from '../github/app';
import { countRepos, deleteRepoRow, findRepo, insertPendingRepo, listRepos, resetRepoStages } from '../db/queries/repos';
import { fail, isUuid, requireAction, requireAuth, requireMember } from '../http/auth';
import type { AppDeps } from '../http/deps';
import { publicRepo } from '../http/payloads';

type Available = { fullName: string; defaultBranch: string; source: 'github' | 'demo'; account?: string; installationRowId?: string };
const MAX_REPO_NAME = 200;

export const repoRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const manage = [...member, requireAction('repos.manage')];

  const availableFor = async (orgId: string): Promise<Available[]> => {
    const installations = await listInstallationsForOrg(deps.pool, orgId);
    const active = await resolveGithubApp(deps);
    if (installations.length > 0 && active) {
      const perInstallation = await Promise.allSettled(
        installations.map(async (installation) =>
          (await active.client.listInstallationRepos(Number(installation.installation_id))).map((r) => ({
            fullName: r.fullName, defaultBranch: r.defaultBranch, source: 'github' as const, account: installation.account_login, installationRowId: installation.id,
          }))),
      );
      return perInstallation.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    }
    return deps.config.demoRepos ? DEMO_REPOS.map((r) => ({ fullName: r.fullName, defaultBranch: r.defaultBranch, source: 'demo' as const })) : [];
  };

  api.get('/orgs/:orgId/integrations', { preHandler: member }, async (req) => {
    const installations = await listInstallationsForOrg(deps.pool, req.member!.org.id);
    const active = await resolveGithubApp(deps);
    return {
      github: {
        configured: Boolean(active),
        source: active?.source ?? null,
        appSlug: active?.config.slug ?? null,
        appUrl: active ? active.htmlUrl ?? `https://github.com/apps/${active.config.slug}` : null,
        manifestAvailable: await manifestAvailable(deps),
        installations: installations.map((i) => ({ accountLogin: i.account_login })),
      },
      demo: { available: deps.config.demoRepos },
    };
  });

  api.get('/orgs/:orgId/available-repos', { preHandler: member }, async (req) => {
    const orgId = req.member!.org.id;
    const existing = new Set((await listRepos(deps.pool, orgId)).map((r) => r.full_name));
    return (await availableFor(orgId)).filter((r) => !existing.has(r.fullName)).map(({ installationRowId: _ignored, ...repo }) => repo);
  });

  api.post('/orgs/:orgId/repos', { preHandler: manage }, async (req, reply) => {
    const { fullName } = z.object({ fullName: z.string().min(1).max(MAX_REPO_NAME) }).parse(req.body);
    const orgId = req.member!.org.id;
    const chosen = (await availableFor(orgId)).find((r) => r.fullName === fullName);
    if (!chosen) return fail(reply, 404, 'not_found');
    if ((await countRepos(deps.pool, orgId)) >= REPO_LIMIT) return fail(reply, 409, 'repo_limit');
    const repo = await insertPendingRepo(deps.pool, { orgId, fullName, defaultBranch: chosen.defaultBranch, installationRowId: chosen.installationRowId ?? null });
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
    if (deps.graph) await deps.graph.pruneOrg(orgId, (await listRepos(deps.pool, orgId)).map((r) => r.id));
    return reply.code(204).send();
  });

  api.get('/orgs/:orgId/system-map', { preHandler: member }, async (req, reply) => {
    if (!deps.graph) return fail(reply, 404, 'not_found');
    const scene = buildSystemMap(await deps.graph.readOrgGraph(req.member!.org.id));
    return scene ?? fail(reply, 404, 'not_found');
  });
};
