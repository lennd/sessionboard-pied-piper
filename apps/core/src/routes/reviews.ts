import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { explainReviewPrompt, type ReviewPart } from '../agent/prompt';
import { runAgent, type AgentEvent } from '../agent/sdkRunner';
import { gitBranchCompare, gitBranchDiff, gitInfo, gitRemoteUrl } from '../git/git';
import { createGh, GhFailure, type PullSummary } from '../git/gh';
import { fail, isUuid } from '../http/fail';
import { nowOf, type AppDeps } from '../http/deps';
import { requireScope, type Root, type Scope } from '../http/scope';
import { combineMaps } from '../impact/combined';
import { overlayChanges, type TouchedInRepo } from '../impact/overlay';
import { readExplanation, setExplanation } from '../store/explanations';
import { readPrefs } from '../store/prefs';
import { listRepos, repoDir } from '../store/repos';
import { createReview, listReviews, removeReview, updateReview, type ReviewFile, type ReviewSelection } from '../store/reviews';
import { readRules, ruleLines } from '../store/rules';
import { findScene, insertScene, readSystemMap } from '../store/scenes';
import { insideRepo, languageOf, MAX_CODE_LINES, sliceLines } from './code';

const MAX_TITLE = 200;
const MAX_REPOS = 8;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const DIFF_BYTES_PER_REPO = 32 * 1024;
const HEARTBEAT_MS = 15_000;
const EXPLANATION_SCOPE = 'review';
const DEFAULT_LANGUAGE = 'en';
const selectionSchema = z.object({ repoId: z.string().min(1), pull: z.union([z.number().int().positive(), z.literal('branch')]) });
const createBody = z.object({ title: z.string().trim().min(1).max(MAX_TITLE).optional(), selections: z.array(selectionSchema).min(1).max(MAX_REPOS) });
const patchBody = z.object({ title: z.string().trim().min(1).max(MAX_TITLE).optional(), selections: z.array(selectionSchema).min(1).max(MAX_REPOS).optional() });
const suggestQuery = z.object({ repoIds: z.string().min(1) });
const codeQuery = z.object({ repo: z.string().min(1), path: z.string().min(1).max(500), start: z.coerce.number().int().optional(), end: z.coerce.number().int().optional() });

export type ReviewMatch = { headRef: string; pulls: { repoId: string; number: number; title: string }[] };

/** Pull requests that share a branch name across repositories: the usual shape of one change spread over several repos. */
export const matchPulls = (byRepo: { repoId: string; pulls: PullSummary[] }[]): ReviewMatch[] => {
  const groups = new Map<string, ReviewMatch['pulls']>();
  for (const { repoId, pulls } of byRepo) {
    for (const pull of pulls) {
      const list = groups.get(pull.headRef) ?? [];
      if (!list.some((p) => p.repoId === repoId)) list.push({ repoId, number: pull.number, title: pull.title });
      groups.set(pull.headRef, list);
    }
  }
  return [...groups.entries()].filter(([, pulls]) => pulls.length > 1).map(([headRef, pulls]) => ({ headRef, pulls }));
};

const sse = (reply: FastifyReply) => {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  return (event: string, data: unknown) => {
    if (!reply.raw.writableEnded) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
};

const RDI = '.rdi';
const GITHUB_REMOTE = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/;

/** owner/name of the GitHub remote a repository was registered with, or of its origin when it is a local folder. */
const githubName = async (repo: { remote?: string | null; path: string }): Promise<string | null> => {
  if (repo.remote) return repo.remote;
  const url = await gitRemoteUrl(repo.path).catch(() => null);
  return url ? GITHUB_REMOTE.exec(url.trim())?.[1] ?? null : null;
};
const defaultTitle = (parts: { name: string; pull: number | 'branch' }[]) => parts.map((p) => `${p.name} ${p.pull === 'branch' ? '(branch)' : `#${p.pull}`}`).join(' + ');

export const reviewRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const home = deps.config.home;
  const gh = createGh(deps.config.ghBin);
  const withScope = [requireScope(deps)];

  const publicReview = async (review: ReviewFile) => {
    const repos = await listRepos(home);
    const entry = await readExplanation(reviewDirOf(review), EXPLANATION_SCOPE);
    const parts = await Promise.all(review.selections.map(async (s) => {
      const repo = repos.find((r) => r.id === s.repoId);
      const name = repo ? await githubName(repo) : null;
      return { repoId: s.repoId, name: repo?.name ?? s.repoId, pull: s.pull, available: Boolean(repo), url: name && typeof s.pull === 'number' ? `https://github.com/${name}/pull/${s.pull}` : null };
    }));
    return { ...review, parts, explainedAt: entry?.at ?? null };
  };
  const reviewDirOf = (review: ReviewFile) => join(home, 'reviews', review.id);
  const repoById = async (ids: string[]) => {
    const repos = await listRepos(home);
    return new Map(ids.map((id) => [id, repos.find((r) => r.id === id)]));
  };

  api.get('/reviews', async () => Promise.all((await listReviews(home)).map(publicReview)));

  api.post('/reviews', async (req, reply) => {
    const body = createBody.parse(req.body);
    const repos = await repoById(body.selections.map((s) => s.repoId));
    if ([...repos.values()].some((r) => r === undefined)) return fail(reply, 400, 'unknown_repo');
    const title = body.title ?? defaultTitle(body.selections.map((s) => ({ name: repos.get(s.repoId)!.name, pull: s.pull })));
    return reply.code(201).send(await publicReview(await createReview(home, nowOf(deps), { title, selections: body.selections })));
  });

  /** Open pull requests of each repository, and the ones that share a branch name across repositories. */
  api.get('/reviews/suggest', async (req, reply) => {
    const { repoIds } = suggestQuery.parse(req.query);
    const ids = [...new Set(repoIds.split(',').map((s) => s.trim()).filter(Boolean))];
    const repos = await repoById(ids);
    if ([...repos.values()].some((r) => r === undefined)) return fail(reply, 400, 'unknown_repo');
    const byRepo = await Promise.all(ids.map(async (id) => {
      const repo = repos.get(id)!;
      const pulls = await gh.listPulls(repo.path, false, repo.remote).catch(() => [] as PullSummary[]);
      const branch = repo.remote ? null : await gitBranchCompare(repo.path).catch(() => null);
      return { repoId: id, name: repo.name, pulls, branch: branch ? { branch: branch.branch, base: branch.base, ahead: branch.ahead } : null };
    }));
    return { repos: byRepo, matches: matchPulls(byRepo) };
  });

  api.get('/reviews/:reviewId', { preHandler: withScope }, async (req) => publicReview(req.scope!.review!));

  api.patch('/reviews/:reviewId', async (req, reply) => {
    const { reviewId } = req.params as { reviewId: string };
    if (!isUuid(reviewId)) return fail(reply, 404, 'review_not_found');
    const body = patchBody.parse(req.body);
    const updated = await updateReview(home, reviewId, nowOf(deps), body);
    return updated ? publicReview(updated) : fail(reply, 404, 'review_not_found');
  });

  api.delete('/reviews/:reviewId', async (req, reply) => {
    const { reviewId } = req.params as { reviewId: string };
    return isUuid(reviewId) && (await removeReview(home, reviewId)) ? reply.code(204).send() : fail(reply, 404, 'review_not_found');
  });

  const combinedMap = async (scope: Scope) => {
    const maps = (await Promise.all(scope.roots.map(async (root) => {
      const scene = await readSystemMap(join(root.path, RDI), (await gitInfo(root.path)).head);
      return scene ? [{ root, scene }] : [];
    }))).flat();
    const prefs = await readPrefs(home);
    const language = prefs.explanationLanguage ?? prefs.uiLanguage ?? DEFAULT_LANGUAGE;
    return { maps, language, scene: combineMaps(maps, { id: `review-map-${scope.id}`, title: scope.label, language }) };
  };

  /** What each selected pull request or branch touches, with the repository name scenes use. */
  const partsOf = async (scope: Scope, withDiff: boolean): Promise<{ parts: ReviewPart[]; touched: TouchedInRepo[] }> => {
    const repos = await listRepos(home);
    const parts: ReviewPart[] = [];
    const touched: TouchedInRepo[] = [];
    for (const selection of scope.review!.selections) {
      const repo = repos.find((r) => r.id === selection.repoId);
      if (!repo) continue;
      const rules = ruleLines(await readRules(repoDir(repo)));
      if (selection.pull === 'branch') {
        const compare = await gitBranchCompare(repo.path);
        if (!compare) continue;
        touched.push(...compare.touched.map((t) => ({ ...t, repo: repo.name })));
        parts.push({ repoName: repo.name, repoPath: repo.path, source: `branch ${compare.branch} compared with ${compare.base}`, touched: compare.touched, diff: withDiff ? await gitBranchDiff(repo.path, compare.base) : '', rules });
      } else {
        const detail = await gh.pullDetail(repo.path, selection.pull, repo.remote);
        const files = detail.files.map((f) => ({ path: f.path, change: f.change }));
        touched.push(...files.map((f) => ({ ...f, repo: repo.name })));
        parts.push({ repoName: repo.name, repoPath: repo.path, source: `pull request #${selection.pull} "${detail.pull.title}" (${detail.pull.headRef} → ${detail.pull.baseRef})`, touched: files, diff: withDiff ? await gh.pullDiff(repo.path, selection.pull, DIFF_BYTES_PER_REPO, repo.remote) : '', rules });
      }
    }
    return { parts, touched };
  };
  const ghFail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof GhFailure) return fail(reply, error.code === 'gh_failed' ? 502 : 409, error.code, error.detail ? { detail: error.detail } : {});
    throw error;
  };

  /** The selected pull requests and branches overlaid on the combined map of their repositories. */
  api.get('/reviews/:reviewId/impact', { preHandler: withScope }, async (req, reply) => {
    const scope = req.scope!;
    const { maps, scene } = await combinedMap(scope);
    const missing = scope.roots.filter((r) => !maps.some((m) => m.root.id === r.id)).map((r) => ({ id: r.id, name: r.name }));
    if (!scene) return fail(reply, 404, 'no_system_map', { missing });
    try {
      const { touched } = await partsOf(scope, false);
      return { scene: overlayChanges(scene, touched, { id: `review-impact-${scope.id}`, title: `${scope.label} · changes` }), touched, missing };
    } catch (error) {
      return ghFail(reply, error);
    }
  });

  api.get('/reviews/:reviewId/explanation', { preHandler: withScope }, async (req, reply) => {
    const entry = await readExplanation(req.scope!.dir, EXPLANATION_SCOPE);
    const row = entry ? await findScene(req.scope!.dir, entry.sceneId) : null;
    return entry && row ? { ...entry, scene: row.scene } : fail(reply, 404, 'not_found');
  });

  /** Asks Claude for one impact scene across every selected repository, with the contracts between them as risks. */
  api.post('/reviews/:reviewId/impact/explain', { preHandler: withScope }, async (req, reply) => {
    const scope = req.scope!;
    if (!deps.queryFn) return fail(reply, 409, 'agent_not_configured');
    if (scope.roots.length === 0) return fail(reply, 409, 'no_repositories');
    let parts: ReviewPart[];
    try {
      parts = (await partsOf(scope, true)).parts;
    } catch (error) {
      return ghFail(reply, error);
    }
    if (parts.length === 0) return fail(reply, 404, 'no_branch_changes');
    const { scene: systemMap, language } = await combinedMap(scope);
    const prompt = explainReviewPrompt({ language, parts, systemMap });
    const send = sse(reply);
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, HEARTBEAT_MS);
    const emit = (event: AgentEvent) => {
      if (event.type === 'scene') return;
      const { type, ...data } = event;
      send(type, data);
    };
    try {
      const result = await runAgent(deps.queryFn, { cwd: scope.roots[0]!.path, roots: scope.roots, prompt, mode: 'explain', signal: controller.signal, agent: deps.config.agent, ctx: { upsertSolution: async () => { throw new Error('not available'); } }, emit });
      const scene = result.scenes.at(-1);
      if (!scene) {
        if (result.stop !== 'error') send('error', { code: 'explain_failed', message: 'Claude finished without drawing the impact scene.' });
        send('done', { usage: result.usage });
      } else {
        const row = await insertScene(scope.dir, nowOf(deps), { conversationId: null, sourceSceneId: null, turn: 0, scene: { ...scene, id: `review-impact-${scope.id}-explained` } });
        await setExplanation(scope.dir, EXPLANATION_SCOPE, { sceneId: row.id, text: result.text, at: nowOf(deps).toISOString() });
        send('scene', { id: row.id, scene: row.scene });
        send('done', { id: row.id, text: result.text, usage: result.usage });
      }
    } catch (error) {
      req.log.error(error);
      send('error', { code: 'internal', message: 'The explanation could not be completed.' });
      send('done', {});
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
    return reply;
  });

  /** Code of any repository of the review, addressed by repository name (what scenes carry in code.repo). */
  api.get('/reviews/:reviewId/code', { preHandler: withScope }, async (req, reply) => {
    const query = codeQuery.parse(req.query);
    const root: Root | undefined = req.scope!.roots.find((r) => r.name === query.repo || r.id === query.repo);
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
