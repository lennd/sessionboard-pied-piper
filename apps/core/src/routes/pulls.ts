import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { gitBranchCompare, gitInfo, gitRemoteUrl } from '../git/git';
import { createGh, GhFailure } from '../git/gh';
import { fail } from '../http/fail';
import type { AppDeps } from '../http/deps';
import { requireRepo } from '../http/repo';
import { anchorRisks, buildReview, diffLines } from '../impact/anchors';
import { overlayChanges } from '../impact/overlay';
import type { TouchedFile } from '../observer/parse';
import { repoDir, type RepoEntry } from '../store/repos';
import { findScene, readSystemMap } from '../store/scenes';
import { validateScene, type Scene } from '@rdi/scene';

const listQuery = z.object({ refresh: z.string().optional() });
const MAX_INTRO = 4000;
const sceneBody = z.object({ sceneId: z.string().uuid().optional(), scene: z.unknown().optional() });
const reviewBody = sceneBody.extend({ riskIds: z.array(z.string().min(1)).min(1).max(50), intro: z.string().trim().max(MAX_INTRO).optional() });
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

  const sceneOf = async (repo: RepoEntry, body: z.infer<typeof sceneBody>): Promise<Scene | null> => {
    const raw = body.sceneId ? (await findScene(repoDir(repo), body.sceneId))?.scene : body.scene;
    const valid = raw ? validateScene(raw) : null;
    return valid?.ok ? valid.scene : null;
  };

  api.post('/repos/:repoId/pulls/:number/risks', { preHandler: withRepo }, async (req, reply) => {
    const number = numberParam(req.params);
    const scene = await sceneOf(req.repo!, sceneBody.parse(req.body ?? {}));
    if (!number || !scene) return fail(reply, 404, 'not_found');
    try {
      const lines = diffLines(await gh.pullDiff(req.repo!.path, number));
      return { risks: anchorRisks(scene, lines).map((e) => ({ id: e.risk.id, title: e.risk.title, severity: e.risk.severity, category: e.risk.category, pieces: e.pieces, anchor: e.anchor })) };
    } catch (error) {
      return ghFail(reply, error);
    }
  });

  api.post('/repos/:repoId/pulls/:number/review', { preHandler: withRepo }, async (req, reply) => {
    const number = numberParam(req.params);
    const body = reviewBody.parse(req.body);
    const scene = await sceneOf(req.repo!, body);
    if (!number || !scene) return fail(reply, 404, 'not_found');
    try {
      const wanted = new Set(body.riskIds);
      const entries = anchorRisks(scene, diffLines(await gh.pullDiff(req.repo!.path, number))).filter((e) => wanted.has(e.risk.id));
      if (entries.length === 0) return fail(reply, 404, 'unknown_risk');
      const review = buildReview(entries, body.intro ?? null);
      const result = await gh.createReview(req.repo!.path, number, review);
      return reply.code(201).send({ ...result, inline: review.comments.length, summary: entries.length - review.comments.length });
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
