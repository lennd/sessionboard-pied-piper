import type { Scene } from '@rdi/scene';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { explainPrompt } from '../agent/prompt';
import { runAgent } from '../agent/sdkRunner';
import { gitChanges, gitDiff, gitInfo } from '../git/git';
import { fail } from '../http/fail';
import { nowOf, type AppDeps } from '../http/deps';
import { requireRepo } from '../http/repo';
import { overlayChanges } from '../impact/overlay';
import { createSessionParser, touchedFiles, type TouchedFile } from '../observer/parse';
import { listSessions, readSession, tailSession } from '../observer/transcripts';
import { readPrefs } from '../store/prefs';
import { repoDir, type RepoEntry } from '../store/repos';
import { insertScene, readSystemMap } from '../store/scenes';

const HEARTBEAT_MS = 15_000;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const DEFAULT_LANGUAGE = 'en';
const WORKTREE_ID = 'worktree';
const IMPACT_ID = 'impact';
const explainBody = z.object({ sessionId: z.string().regex(/^[A-Za-z0-9-]+$/).optional(), language: z.string().regex(LANGUAGE_TAG).optional() });

const sse = (reply: FastifyReply) => {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (event: string, data: unknown) => {
    if (!reply.raw.writableEnded) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  return send;
};

export const sessionRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const withRepo = [requireRepo(deps)];
  const claudeHome = deps.config.claudeHome;
  const currentMap = async (repo: RepoEntry): Promise<Scene | null> => readSystemMap(repoDir(repo), (await gitInfo(repo.path)).head);
  const impactOf = async (repo: RepoEntry, touched: TouchedFile[], id: string, title: string, reply: FastifyReply) => {
    const map = await currentMap(repo);
    if (!map) return fail(reply, 404, 'no_system_map');
    return overlayChanges(map, touched, { id, title });
  };

  api.get('/repos/:repoId/sessions', { preHandler: withRepo }, async (req) => listSessions(claudeHome, req.repo!.path));

  api.get('/repos/:repoId/sessions/:sessionId', { preHandler: withRepo }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await readSession(claudeHome, req.repo!.path, sessionId);
    return session ? { session: session.meta, events: session.events, touched: touchedFiles(session.events) } : fail(reply, 404, 'not_found');
  });

  api.get('/repos/:repoId/sessions/:sessionId/events', { preHandler: withRepo }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const repo = req.repo!;
    const session = await readSession(claudeHome, repo.path, sessionId);
    if (!session) return fail(reply, 404, 'not_found');
    const send = sse(reply);
    send('snapshot', { session: session.meta, events: session.events, touched: touchedFiles(session.events) });
    const parser = createSessionParser(repo.path);
    for (const event of session.events) parser.events.push(event);
    const stop = tailSession(claudeHome, repo.path, sessionId, session.offset, (line) => {
      const changed = parser.push(line);
      for (const event of changed) send('event', event);
      if (changed.some((e) => e.kind === 'edit' || e.kind === 'write')) send('touched', touchedFiles(parser.events));
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, HEARTBEAT_MS);
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      stop();
    });
    return reply;
  });

  api.get('/repos/:repoId/sessions/:sessionId/impact', { preHandler: withRepo }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await readSession(claudeHome, req.repo!.path, sessionId);
    if (!session) return fail(reply, 404, 'not_found');
    return impactOf(req.repo!, touchedFiles(session.events), `${IMPACT_ID}-${sessionId}`, session.meta.title ?? sessionId, reply);
  });

  api.get('/repos/:repoId/changes', { preHandler: withRepo }, async (req) => ({ touched: await gitChanges(req.repo!.path) }));

  api.get('/repos/:repoId/changes/impact', { preHandler: withRepo }, async (req, reply) =>
    impactOf(req.repo!, await gitChanges(req.repo!.path), `${IMPACT_ID}-${WORKTREE_ID}`, 'Working tree changes', reply));

  api.post('/repos/:repoId/impact/explain', { preHandler: withRepo }, async (req, reply) => {
    const body = explainBody.parse(req.body ?? {});
    const repo = req.repo!;
    if (!deps.queryFn) return fail(reply, 409, 'agent_not_configured');
    const session = body.sessionId ? await readSession(claudeHome, repo.path, body.sessionId) : null;
    if (body.sessionId && !session) return fail(reply, 404, 'not_found');
    const touched = session ? touchedFiles(session.events) : await gitChanges(repo.path);
    const prefs = await readPrefs(deps.config.home);
    const language = body.language ?? prefs.explanationLanguage ?? prefs.uiLanguage ?? DEFAULT_LANGUAGE;
    const prompt = explainPrompt({ language, repoName: repo.name, source: session ? `Claude Code session "${session.meta.title ?? body.sessionId}"` : 'uncommitted working tree changes', touched, diff: await gitDiff(repo.path), systemMap: await currentMap(repo) });
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const result = await runAgent(deps.queryFn, { cwd: repo.path, prompt, mode: 'analyze', signal: controller.signal, agent: deps.config.agent, ctx: { upsertSolution: async () => { throw new Error('not available'); } }, emit: () => undefined });
    const scene = result.scenes.at(-1);
    if (!scene) return fail(reply, 502, result.errorCode === 'aborted' ? 'aborted' : 'explain_failed', { usage: result.usage });
    const row = await insertScene(repoDir(repo), nowOf(deps), { conversationId: null, sourceSceneId: null, turn: 0, scene: { ...scene, id: `${IMPACT_ID}-${body.sessionId ?? WORKTREE_ID}-explained` } });
    return reply.code(201).send({ id: row.id, scene: row.scene, text: result.text, usage: result.usage });
  });
};
