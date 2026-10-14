import { validateScene, type Scene } from '@rdi/scene';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { chatPrompt, pullContext, questionOf, systemMapPrompt } from '../agent/prompt';
import { createGh } from '../git/gh';
import { runAgent, type AgentEvent } from '../agent/sdkRunner';
import { translateScene, TranslateError } from '../agent/translate';
import type { ToolContext } from '../agent/tools';
import { gitInfo } from '../git/git';
import { fail, isUuid } from '../http/fail';
import { nowOf, type AppDeps } from '../http/deps';
import { requireScope, type Scope } from '../http/scope';
import { featureContext } from '../agent/featureContext';
import { createFromDraft, proposeVersion, updateMeta } from '../solutions/service';
import {
  appendMessages, createConversation, DEFAULT_CONVERSATION_TITLE, findConversation, listConversations, recordRun, renameConversation, totalUsage, type ConversationSummary, type StoredMessage,
} from '../store/conversations';
import { readPrefs } from '../store/prefs';
import { readRules, ruleLines } from '../store/rules';
import { readToolkit } from '../store/toolkit';
import { repoDir, type RepoEntry } from '../store/repos';
import { findScene, insertScene, listConversationScenes, readSystemMap, SYSTEM_MAP_ID, writeSystemMap } from '../store/scenes';

const TITLE_LENGTH = 60;
const MAX_QUESTION = 4000;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const DEFAULT_LANGUAGE = 'en';
const SSE_HEADERS = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' };

const MAX_CONVERSATION_TITLE = 200;
const askBody = z.object({
  text: z.string().trim().min(1).max(MAX_QUESTION),
  language: z.string().regex(LANGUAGE_TAG).optional(),
  focus: z.object({ label: z.string().min(1).max(200), graphRef: z.string().min(1).max(500) }).nullish(),
  mode: z.enum(['analyze', 'plan']).default('analyze'),
  pull: z.number().int().positive().optional(),
});
const conversationBody = z.object({ title: z.string().trim().min(1).max(MAX_CONVERSATION_TITLE).optional() });
const mapBody = z.object({ language: z.string().regex(LANGUAGE_TAG).optional(), force: z.boolean().optional() });

const publicConversation = (c: ConversationSummary) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt });

export const itemsOf = (messages: StoredMessage[]) => {
  const items: { role: 'user' | 'assistant'; text: string; turn: number }[] = [];
  let turn = 0;
  for (const m of messages) {
    if (m.role === 'user') {
      turn += 1;
      items.push({ role: 'user', text: questionOf(m) ?? '', turn });
      continue;
    }
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as { type: string; text?: string }[]);
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (text) items.push({ role: 'assistant', text, turn });
  }
  return { items, turns: turn };
};

/** Turns an HTTP reply into a server-sent events stream and returns the writer plus the abort signal of the client. */
const openSse = (reply: FastifyReply, heartbeatMs: number) => {
  const controller = new AbortController();
  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  const heartbeat = setInterval(() => {
    if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
  }, heartbeatMs);
  const send = (event: string, data: unknown) => {
    if (!reply.raw.writableEnded) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const end = () => {
    clearInterval(heartbeat);
    reply.raw.end();
  };
  return { send, end, signal: controller.signal };
};

/** Chat, scenes and system map for one scope; mounted once per prefix (`/repos/:repoId`, `/features/:featureId`). */
export const agentRoutes = (api: FastifyInstance, deps: AppDeps, prefix = '/repos/:repoId') => {
  const gh = createGh(deps.config.ghBin);
  /** Pull request facts for a chat embedded in that pull request; the diff travels only on the first turn, later turns resume the same session. */
  const pullChatContext = async (repo: RepoEntry, number: number, turn: number): Promise<string | undefined> => {
    try {
      const detail = await gh.pullDetail(repo.path, number, repo.remote);
      const diff = turn === 1 ? await gh.pullDiff(repo.path, number, undefined, repo.remote) : null;
      return pullContext({ number, title: detail.pull.title, author: detail.pull.author, headRef: detail.pull.headRef, baseRef: detail.pull.baseRef, additions: detail.pull.additions, deletions: detail.pull.deletions, files: detail.files.map((f) => f.path), body: detail.pull.body, diff });
    } catch (error) {
      api.log.warn({ err: error, number }, 'pull request context unavailable for the chat');
      return undefined;
    }
  };
  const withRepo = [requireScope(deps)];
  const url = (path: string) => `${prefix}${path}`;
  const languageFor = async (requested?: string) => requested ?? (await readPrefs(deps.config.home)).explanationLanguage ?? (await readPrefs(deps.config.home)).uiLanguage ?? DEFAULT_LANGUAGE;

  const ownConversation = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const conversation = isUuid(id) ? await findConversation(req.scope!.dir, id) : null;
    if (!conversation) {
      fail(reply, 404, 'not_found');
      return null;
    }
    return conversation;
  };

  const toolContext = (scope: Scope, conversationId: string | null): ToolContext => ({
    upsertSolution: async ({ solutionId, title, draft }) => {
      const dir = scope.dir;
      const now = nowOf(deps);
      if (solutionId) {
        const { n } = await proposeVersion({ dir, events: deps.events, now }, { solutionId, author: 'web', input: draft });
        await updateMeta({ dir, events: deps.events, now }, solutionId, { title });
        return { id: solutionId, n, title };
      }
      const created = await createFromDraft({ dir, events: deps.events, now }, { title, conversationId, author: 'web', input: draft });
      return { ...created, title };
    },
  });

  api.get(url('/agent'), { preHandler: withRepo }, async (req) => ({
    enabled: deps.queryFn !== null,
    model: deps.config.agent.fake ? 'fake-scripted' : deps.config.agent.model ?? 'default',
    usage: await totalUsage(req.scope!.dir),
  }));

  api.get(url('/conversations'), { preHandler: withRepo }, async (req) => (await listConversations(req.scope!.dir)).map(publicConversation));

  api.post(url('/conversations'), { preHandler: withRepo }, async (req, reply) => {
    const { title } = conversationBody.parse(req.body ?? {});
    return reply.code(201).send(publicConversation(await createConversation(req.scope!.dir, nowOf(deps), title)));
  });

  api.get(url('/conversations/:id'), { preHandler: withRepo }, async (req, reply) => {
    const conversation = await ownConversation(req, reply);
    if (!conversation) return reply;
    const { items } = itemsOf(conversation.messages);
    const scenes = (await listConversationScenes(req.scope!.dir, conversation.id)).map((s) => ({ id: s.id, turn: s.turn, scene: s.scene }));
    return { ...publicConversation(conversation), items, scenes, usage: conversation.usage };
  });

  api.post(url('/conversations/:id/messages'), { preHandler: withRepo }, async (req, reply) => {
    const body = askBody.parse(req.body);
    const conversation = await ownConversation(req, reply);
    if (!conversation) return reply;
    if (!deps.queryFn) return fail(reply, 409, 'agent_not_configured');
    const scope = req.scope!;
    if (scope.roots.length === 0) return fail(reply, 409, 'no_repositories');
    const dir = scope.dir;
    const turn = itemsOf(conversation.messages).turns + 1;
    const language = await languageFor(body.language);
    const repoRdi = scope.kind === 'repo' ? scope.dir : null;
    const prompt = chatPrompt(body.text, {
      language, focus: body.focus ?? null, mode: body.mode,
      rules: repoRdi ? ruleLines(await readRules(repoRdi)) : [],
      toolkit: repoRdi ? await readToolkit(repoRdi) : '',
      context: scope.kind === 'feature' && scope.feature ? await featureContext(scope.feature, scope.roots) : body.pull && scope.repo ? await pullChatContext(scope.repo, body.pull, turn) : undefined,
    });
    const { send, end, signal } = openSse(reply, deps.config.agent.heartbeatMs);
    const sceneIds: string[] = [];
    const emit = async (event: AgentEvent) => {
      if (event.type === 'scene') {
        const row = await insertScene(dir, nowOf(deps), { conversationId: conversation.id, sourceSceneId: null, turn, scene: event.scene });
        sceneIds.push(row.id);
        send('scene', { id: row.id, scene: event.scene });
        return;
      }
      const { type, ...data } = event;
      send(type, data);
    };
    let usage = { input: 0, output: 0, costUsd: 0 };
    try {
      const result = await runAgent(deps.queryFn, { cwd: scope.roots[0]!.path, roots: scope.roots, prompt, mode: body.mode, resume: conversation.sdkSessionId, signal, agent: deps.config.agent, ctx: toolContext(scope, conversation.id), emit });
      usage = result.usage;
      const answer: StoredMessage[] = result.text ? [{ role: 'assistant', content: [{ type: 'text', text: result.text }] }] : [];
      await appendMessages(dir, conversation.id, nowOf(deps), [{ role: 'user', content: body.text }, ...answer]);
      await recordRun(dir, conversation.id, nowOf(deps), { sdkSessionId: result.sessionId, usage: result.usage });
      if (conversation.title === DEFAULT_CONVERSATION_TITLE) await renameConversation(dir, conversation.id, nowOf(deps), body.text.slice(0, TITLE_LENGTH));
    } catch (error) {
      req.log.error(error);
      send('error', { code: 'internal', message: 'The answer could not be completed.' });
    } finally {
      send('done', { sceneIds, usage });
      end();
    }
    return reply;
  });

  if (prefix !== '/repos/:repoId') return;

  api.get('/repos/:repoId/system-map', { preHandler: withRepo }, async (req, reply) => {
    const repo = req.repo!;
    const map = await readSystemMap(repoDir(repo), (await gitInfo(repo.path)).head);
    return map ?? fail(reply, 404, 'not_found');
  });

  api.post('/repos/:repoId/system-map', { preHandler: withRepo }, async (req, reply) => {
    const body = mapBody.parse(req.body ?? {});
    const repo = req.repo!;
    const dir = repoDir(repo);
    const { head } = await gitInfo(repo.path);
    const cached = body.force ? null : await readSystemMap(dir, head);
    if (cached) return { scene: cached, cached: true };
    if (!deps.queryFn) return fail(reply, 409, 'agent_not_configured');
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const result = await runAgent(deps.queryFn, {
      cwd: repo.path, prompt: systemMapPrompt(await languageFor(body.language), repo.name), mode: 'map', signal: controller.signal, agent: deps.config.agent,
      ctx: toolContext(req.scope!, null), emit: () => undefined,
    });
    const scene = result.scenes.at(-1);
    if (!scene) return fail(reply, 502, result.errorCode === 'aborted' ? 'aborted' : 'map_failed', { usage: result.usage });
    const map: Scene = { ...scene, id: SYSTEM_MAP_ID };
    await writeSystemMap(dir, head, map);
    return reply.code(201).send({ scene: map, cached: false, usage: result.usage });
  });

  api.post('/repos/:repoId/scenes/:sceneId/translate', { preHandler: withRepo }, async (req, reply) => {
    const { language } = z.object({ language: z.string().regex(LANGUAGE_TAG) }).parse(req.body);
    const { sceneId } = req.params as { sceneId: string };
    const repo = req.repo!;
    const dir = repoDir(repo);
    let source: { id: string | null; conversationId: string | null; turn: number; scene: unknown } | null = null;
    if (sceneId === SYSTEM_MAP_ID) {
      const map = await readSystemMap(dir, (await gitInfo(repo.path)).head);
      source = map ? { id: null, conversationId: null, turn: 0, scene: map } : null;
    } else if (isUuid(sceneId)) {
      const row = await findScene(dir, sceneId);
      source = row ? { id: row.id, conversationId: row.conversationId, turn: row.turn, scene: row.scene } : null;
    }
    const valid = source ? validateScene(source.scene) : null;
    if (!source || !valid?.ok) return fail(reply, 404, 'not_found');
    if (!deps.queryFn) return fail(reply, 409, 'agent_not_configured');
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    try {
      const { scene } = await translateScene(deps.queryFn, { cwd: repo.path, scene: valid.scene, language, agent: deps.config.agent, signal: controller.signal });
      const row = await insertScene(dir, nowOf(deps), { conversationId: source.conversationId, sourceSceneId: source.id, turn: source.turn, scene });
      return reply.code(201).send({ id: row.id, scene });
    } catch (error) {
      if (error instanceof TranslateError) return fail(reply, 422, 'translation_failed');
      if (controller.signal.aborted) return fail(reply, 502, 'llm_error');
      throw error;
    }
  });
};
