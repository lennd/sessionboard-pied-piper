import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from './fail';
import type { AppDeps } from './deps';
import { findRepo, type RepoEntry } from '../store/repos';

declare module 'fastify' {
  interface FastifyRequest {
    repo?: RepoEntry;
  }
}

/** Resolves `:repoId` to a registered repository or answers 404. */
export const requireRepo = (deps: AppDeps) => async (req: FastifyRequest, reply: FastifyReply) => {
  const { repoId } = req.params as { repoId?: string };
  const repo = repoId ? await findRepo(deps.config.home, repoId) : null;
  if (!repo) return fail(reply, 404, 'repo_not_found');
  req.repo = repo;
  return undefined;
};
