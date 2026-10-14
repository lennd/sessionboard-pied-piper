import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { gitBranchCompare, gitInfo, gitRemoteUrl } from '../git/git';
import { createGh, GhFailure } from '../git/gh';
import { fail } from '../http/fail';
import type { AppDeps } from '../http/deps';
import { requireRepo } from '../http/repo';
import { overlayChanges } from '../impact/overlay';
import type { TouchedFile } from '../observer/parse';
import { repoDir, type RepoEntry } from '../store/repos';
import { readSystemMap } from '../store/scenes';

const listQuery = z.object({ refresh: z.string().optional() });
const numberParam = (params: unknown): number | null => {
  const n = Number((params as { number: string }).number);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const pullRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const withRepo = [requireRepo(deps)];
  const gh = createGh(deps.config.ghBin);
  const impact = async (repo: RepoEntry, touched: TouchedFile[], id: string, title: string, reply: FastifyReply) => {
    const map = await readSystemMap(repoDir(repo), (await gitInfo(repo.path)).head);
    return map ? overlayChanges(map, touched, { id, title }) : fail(reply, 404, 'no_system_map');
  };
  const ghFail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof GhFailure) return fail(reply, error.code === 'gh_failed' ? 502 : 409, error.code);
    throw error;
  };

  api.get('/repos/:repoId/pulls', { preHandler: withRepo }, async (req, reply) => {
    const repo = req.repo!;
    const { refresh } = listQuery.parse(req.query);
    const branch = await gitBranchCompare(repo.path);
    const remote = await gitRemoteUrl(repo.path);
    if (!remote) return { available: false, reason: 'no_remote', pulls: [], branch };
    try {
      return { available: true, pulls: await gh.listPulls(repo.path, refresh === '1'), branch };
    } catch (error) {
      if (error instanceof GhFailure) return { available: false, reason: error.code, pulls: [], branch };
      return ghFail(reply, error);
    }
  });

  api.get('/repos/:repoId/pulls/:number', { preHandler: withRepo }, async (req, reply) => {
    const number = numberParam(req.params);
    if (!number) return fail(reply, 404, 'not_found');
    try {
      const detail = await gh.pullDetail(req.repo!.path, number);
      return { ...detail, touched: detail.files.map((f) => ({ path: f.path, change: f.change })) };
    } catch (error) {
      return ghFail(reply, error);
    }
  });

  api.get('/repos/:repoId/pulls/:number/impact', { preHandler: withRepo }, async (req, reply) => {
    const number = numberParam(req.params);
    if (!number) return fail(reply, 404, 'not_found');
    try {
      const detail = await gh.pullDetail(req.repo!.path, number);
      return impact(req.repo!, detail.files.map((f) => ({ path: f.path, change: f.change })), `impact-pr-${number}`, `#${number} ${detail.pull.title}`, reply);
    } catch (error) {
      return ghFail(reply, error);
    }
  });

  api.get('/repos/:repoId/branch/impact', { preHandler: withRepo }, async (req, reply) => {
    const compare = await gitBranchCompare(req.repo!.path);
    if (!compare) return fail(reply, 404, 'no_branch_changes');
    return impact(req.repo!, compare.touched, 'impact-branch', `${compare.branch} → ${compare.base}`, reply);
  });
};
