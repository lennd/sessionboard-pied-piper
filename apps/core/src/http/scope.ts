import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from './fail';
import type { AppDeps } from './deps';
import { featureDir, findFeature, type FeatureFile } from '../store/features';
import { findReview, reviewDir, type ReviewFile } from '../store/reviews';
import { findRepo, listRepos, repoDir, type RepoEntry, ensureRepoDir } from '../store/repos';
import { featureMcpUrl, mcpUrl } from '../mcp/route';

/** A directory the agent may read: one registered repository. */
export type Root = { id: string; name: string; path: string };
/** Where conversations, scenes and solutions live, and which repositories the agent can see: one repo, or a feature spanning several. */
export type Scope = { kind: 'repo' | 'feature' | 'review'; id: string; label: string; dir: string; roots: Root[]; mcpUrl: string; feature?: FeatureFile; repo?: RepoEntry; review?: ReviewFile };

declare module 'fastify' {
  interface FastifyRequest {
    scope?: Scope;
  }
}

const rootOf = (repo: RepoEntry): Root => ({ id: repo.id, name: repo.name, path: repo.path });

export const repoScope = (deps: AppDeps, repo: RepoEntry): Scope => ({ kind: 'repo', id: repo.id, label: repo.name, dir: repoDir(repo), roots: [rootOf(repo)], mcpUrl: mcpUrl(deps.config, repo.id), repo });

export const featureScope = async (deps: AppDeps, feature: FeatureFile): Promise<Scope> => {
  const repos = await listRepos(deps.config.home);
  const roots = feature.repoIds.map((id) => repos.find((r) => r.id === id)).filter((r): r is RepoEntry => r !== undefined).map(rootOf);
  return { kind: 'feature', id: feature.id, label: feature.title, dir: featureDir(deps.config.home, feature.id), roots, mcpUrl: featureMcpUrl(deps.config, feature.id), feature };
};

/** A review spans the repositories it selected; it has no MCP server and no runs, only scenes and explanations. */
export const reviewScope = async (deps: AppDeps, review: ReviewFile): Promise<Scope> => {
  const repos = await listRepos(deps.config.home);
  const roots = review.selections.map((s) => repos.find((r) => r.id === s.repoId)).filter((r): r is RepoEntry => r !== undefined).map(rootOf);
  return { kind: 'review', id: review.id, label: review.title, dir: reviewDir(deps.config.home, review.id), roots, mcpUrl: '', review };
};

/** Resolves `:repoId`, `:featureId` or `:reviewId` into `req.scope`, or answers 404. */
export const requireScope = (deps: AppDeps) => async (req: FastifyRequest, reply: FastifyReply) => {
  const { repoId, featureId, reviewId } = req.params as { repoId?: string; featureId?: string; reviewId?: string };
  if (reviewId) {
    const review = await findReview(deps.config.home, reviewId);
    if (!review) return fail(reply, 404, 'review_not_found');
    req.scope = await reviewScope(deps, review);
    return undefined;
  }
  if (featureId) {
    const feature = await findFeature(deps.config.home, featureId);
    if (!feature) return fail(reply, 404, 'feature_not_found');
    req.scope = await featureScope(deps, feature);
    return undefined;
  }
  if (repoId) {
    const repo = await findRepo(deps.config.home, repoId);
    if (!repo) return fail(reply, 404, 'repo_not_found');
    await ensureRepoDir(repo.path);
    req.repo = repo;
    req.scope = repoScope(deps, repo);
    return undefined;
  }
  return fail(reply, 404, 'not_found');
};
