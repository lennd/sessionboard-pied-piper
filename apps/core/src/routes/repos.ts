import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gitInfo } from '../git/git';
import { fail } from '../http/fail';
import { nowOf, type AppDeps } from '../http/deps';
import { requireRepo } from '../http/repo';
import { mcpUrl } from '../mcp/route';
import { MCP_SERVER_NAME } from '../mcp/server';
import { addRemoteRepo, addRepo, clonePath, isFullName, listRepos, removeRepo, repoDir, RepoError, type RepoEntry } from '../store/repos';
import { createGh, GhFailure } from '../git/gh';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readSystemMap } from '../store/scenes';

const addBody = z.union([z.object({ path: z.string().trim().min(1).max(1000) }), z.object({ remote: z.string().trim().min(3).max(200), clone: z.boolean().optional() })]);

const publicRepo = async (repo: RepoEntry) => {
  const git = await gitInfo(repo.path);
  return { id: repo.id, name: repo.name, path: repo.path, addedAt: repo.addedAt, kind: repo.kind ?? 'local', remote: repo.remote ?? null, head: git.head, branch: git.branch, hasSystemMap: (await readSystemMap(repoDir(repo), git.head)) !== null };
};

export const repoRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/repos', async () => Promise.all((await listRepos(deps.config.home)).map(publicRepo)));

  const gh = createGh(deps.config.ghBin);

  api.post('/repos', async (req, reply) => {
    const body = addBody.parse(req.body);
    try {
      if ('path' in body) return reply.code(201).send(await publicRepo(await addRepo(deps.config.home, body.path, nowOf(deps))));
      if (!isFullName(body.remote)) return fail(reply, 400, 'invalid_remote');
      if (!body.clone) return reply.code(201).send(await publicRepo(await addRemoteRepo(deps.config.home, body.remote, nowOf(deps))));
      const into = clonePath(deps.config.home, body.remote);
      const already = await stat(into).then((s) => s.isDirectory()).catch(() => false);
      if (!already) {
        await mkdir(dirname(into), { recursive: true });
        await gh.cloneRepo(deps.config.home, body.remote, into);
      }
      return reply.code(201).send(await publicRepo(await addRepo(deps.config.home, into, nowOf(deps))));
    } catch (error) {
      if (error instanceof RepoError) return fail(reply, 400, error.code);
      if (error instanceof GhFailure) return fail(reply, error.code === 'gh_failed' ? 502 : 409, error.code);
      throw error;
    }
  });

  api.get('/repos/:repoId', { preHandler: [requireRepo(deps)] }, async (req) => publicRepo(req.repo!));

  api.delete('/repos/:repoId', async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    return (await removeRepo(deps.config.home, repoId)) ? reply.code(204).send() : fail(reply, 404, 'repo_not_found');
  });

  api.get('/repos/:repoId/mcp-info', { preHandler: [requireRepo(deps)] }, async (req) => ({ url: mcpUrl(deps.config, req.repo!.id), serverName: MCP_SERVER_NAME }));
};
