import Anthropic from '@anthropic-ai/sdk';
import { buildSystemMap, SYSTEM_MAP_ID } from '@rdi/indexer';
import { validateScene } from '@rdi/scene';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { windowHistory } from '../agent/history';
import { questionOf, SYSTEM_PROMPT, userTurn } from '../agent/prompt';
import { runAgent, type AgentEvent } from '../agent/runAgent';
import { translateScene, TranslateError } from '../agent/translate';
import type { ToolContext } from '../agent/tools';
import { createRateLimiter } from '../auth/rateLimit';
import { updateSolution } from '../db/queries/solutions';
import { createFromDraft, proposeVersion } from '../solutions/service';
import {
  addUsage, appendMessages, createConversation, currentMonth, DEFAULT_CONVERSATION_TITLE, findConversation, findRepoInstallation, findScene, getUsage,
  insertScene, listConversations, listConversationScenes, listMessages, readSource, renameConversation, type ConversationRow,
} from '../db/queries/agent';
import { listRepos } from '../db/queries/repos';
import { fail, isUuid, requireAuth, requireMember } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';

export const AGENT_RATE_LIMIT = 20;
const AGENT_RATE_WINDOW_SECONDS = 60;
const TITLE_LENGTH = 60;
const MAX_QUESTION = 4000;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const askBody = z.object({
  text: z.string().trim().min(1).max(MAX_QUESTION),
  language: z.string().regex(LANGUAGE_TAG).optional(),
  focus: z.object({ label: z.string().min(1).max(200), graphRef: z.string().min(1).max(500) }).nullish(),
});

const publicConversation = (c: ConversationRow) => ({ id: c.id, title: c.title, updatedAt: c.updated_at.toISOString() });
type Stored = { role: 'user' | 'assistant'; content: unknown };

const itemsOf = (messages: Stored[]) => {
  const items: { role: 'user' | 'assistant'; text: string; turn: number }[] = [];
  let turn = 0;
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as { type: string; text?: string }[]);
    if (m.role === 'user') {
      if (blocks.some((b) => b.type === 'tool_result')) continue;
      turn += 1;
      items.push({ role: 'user', text: questionOf(m) ?? '', turn });
      continue;
    }
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (text) items.push({ role: 'assistant', text, turn });
  }
  return { items, turns: turn };
};

export const agentRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const limiter = createRateLimiter(deps.redis, deps.config.rateLimitPrefix);

  const tokensUsed = async (orgId: string) => {
    const usage = await getUsage(deps.pool, orgId, currentMonth(nowOf(deps)));
    return usage.input + usage.output;
  };
  const ownConversation = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const conversation = isUuid(id) ? await findConversation(deps.pool, req.member!.org.id, req.auth!.user.id, id) : null;
    if (!conversation) {
      fail(reply, 404, 'not_found');
      return null;
    }
    return conversation;
  };

  api.get('/orgs/:orgId/agent', { preHandler: member }, async (req) => ({
    enabled: Boolean(deps.llm),
    model: deps.llm?.model ?? deps.config.agent.model,
    tokensUsed: await tokensUsed(req.member!.org.id),
    tokenBudget: deps.config.agent.monthlyTokenBudget,
  }));

  api.get('/orgs/:orgId/conversations', { preHandler: member }, async (req) =>
    (await listConversations(deps.pool, req.member!.org.id, req.auth!.user.id)).map(publicConversation));

  api.post('/orgs/:orgId/conversations', { preHandler: member }, async (req, reply) =>
    reply.code(201).send(publicConversation(await createConversation(deps.pool, { orgId: req.member!.org.id, userId: req.auth!.user.id }))));

  api.get('/orgs/:orgId/conversations/:id', { preHandler: member }, async (req, reply) => {
    const conversation = await ownConversation(req, reply);
    if (!conversation) return reply;
    const { items } = itemsOf(await listMessages(deps.pool, conversation.id));
    const scenes = (await listConversationScenes(deps.pool, conversation.id)).map((s) => ({ id: s.id, turn: s.turn, scene: s.scene }));
    return { ...publicConversation(conversation), items, scenes };
  });

  api.post('/orgs/:orgId/conversations/:id/messages', { preHandler: member }, async (req, reply) => {
    const body = askBody.parse(req.body);
    const conversation = await ownConversation(req, reply);
    if (!conversation) return reply;
    const llm = deps.llm;
    if (!llm) return fail(reply, 409, 'agent_not_configured');
    const orgId = req.member!.org.id;
    if (deps.config.rateLimitsEnabled) {
      const hit = await limiter.hit(`agent:${req.auth!.user.id}`, AGENT_RATE_LIMIT, AGENT_RATE_WINDOW_SECONDS);
      if (!hit.allowed) return fail(reply, 429, 'rate_limited', { retryAfter: hit.retryAfter });
    }
    if ((await tokensUsed(orgId)) >= deps.config.agent.monthlyTokenBudget) return fail(reply, 429, 'token_budget_exceeded');

    const stored = await listMessages(deps.pool, conversation.id);
    const turn = itemsOf(stored).turns + 1;
    const history = windowHistory(stored.filter((m) => !m.excluded).map(({ role, content }) => ({ role, content })) as Anthropic.Beta.BetaMessageParam[]);
    const language = body.language ?? req.auth!.user.explanation_language ?? req.member!.org.default_explanation_language;
    const repos = (await listRepos(deps.pool, orgId)).filter((r) => r.status === 'ready').map((r) => r.full_name);
    const user = userTurn(body.text, { language, focus: body.focus ?? null, repos });

    let graph: ReturnType<ToolContext['loadGraph']> | null = null;
    const toolContext: ToolContext = {
      loadGraph: () => (graph ??= deps.graph ? deps.graph.readOrgGraph(orgId) : Promise.resolve({ nodes: [], edges: [] })),
      readSource: (repo, path) => readSource(deps.pool, orgId, repo, path),
      upsertSolution: async ({ solutionId, title, draft }) => {
        if (solutionId) {
          const { n } = await proposeVersion(deps, { orgId, solutionId, author: 'web', input: draft });
          await updateSolution(deps.pool, solutionId, { title });
          return { id: solutionId, n, title };
        }
        const created = await createFromDraft(deps, { orgId, userId: req.auth!.user.id, title, conversationId: conversation.id, author: 'web', input: draft });
        return { ...created, title };
      },
      prFiles: async (repo, number) => {
        const installation = await findRepoInstallation(deps.pool, orgId, repo);
        return installation !== null && deps.github ? deps.github.listPullFiles(installation, repo, number) : null;
      },
    };

    const controller = new AbortController();
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const send = (event: string, data: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const sceneIds: string[] = [];
    const emit = async (event: AgentEvent) => {
      if (event.type === 'scene') {
        const row = await insertScene(deps.pool, { orgId, conversationId: conversation.id, sourceSceneId: null, turn, scene: event.scene });
        sceneIds.push(row.id);
        send('scene', { id: row.id, scene: event.scene });
        return;
      }
      const { type, ...data } = event;
      send(type, data);
    };

    const usage = { input: 0, output: 0 };
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, deps.config.agent.heartbeatMs);
    try {
      const result = await runAgent({ llm, system: SYSTEM_PROMPT, history, user, ctx: toolContext, emit, signal: controller.signal, usage });
      const refused = result.errorCode === 'refusal';
      await appendMessages(deps.pool, conversation.id, [{ ...user, excluded: refused }, ...result.appended] as Stored[]);
      if (conversation.title === DEFAULT_CONVERSATION_TITLE) await renameConversation(deps.pool, conversation.id, body.text.slice(0, TITLE_LENGTH));
    } catch (error) {
      req.log.error(error);
      send('error', { code: 'internal', message: 'The answer could not be completed.' });
    } finally {
      clearInterval(heartbeat);
      await addUsage(deps.pool, orgId, currentMonth(nowOf(deps)), usage.input, usage.output).catch((error: unknown) => req.log.error(error));
      send('done', { sceneIds, usage });
      reply.raw.end();
    }
    return reply;
  });

  api.post('/orgs/:orgId/scenes/:sceneId/translate', { preHandler: member }, async (req, reply) => {
    const { language } = z.object({ language: z.string().regex(LANGUAGE_TAG) }).parse(req.body);
    const { sceneId } = req.params as { sceneId: string };
    const orgId = req.member!.org.id;
    let source: { id: string | null; conversationId: string | null; turn: number; scene: unknown } | null = null;
    if (sceneId === SYSTEM_MAP_ID) {
      const map = deps.graph ? buildSystemMap(await deps.graph.readOrgGraph(orgId)) : null;
      source = map ? { id: null, conversationId: null, turn: 0, scene: map } : null;
    } else if (isUuid(sceneId)) {
      const row = await findScene(deps.pool, orgId, req.auth!.user.id, sceneId);
      source = row ? { id: row.id, conversationId: row.conversation_id, turn: row.turn, scene: row.scene } : null;
    }
    const valid = source ? validateScene(source.scene) : null;
    if (!source || !valid?.ok) return fail(reply, 404, 'not_found');
    const llm = deps.llm;
    if (!llm) return fail(reply, 409, 'agent_not_configured');
    if (deps.config.rateLimitsEnabled) {
      const hit = await limiter.hit(`agent:${req.auth!.user.id}`, AGENT_RATE_LIMIT, AGENT_RATE_WINDOW_SECONDS);
      if (!hit.allowed) return fail(reply, 429, 'rate_limited', { retryAfter: hit.retryAfter });
    }
    if ((await tokensUsed(orgId)) >= deps.config.agent.monthlyTokenBudget) return fail(reply, 429, 'token_budget_exceeded');
    const usage = { input: 0, output: 0 };
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    try {
      const { scene } = await translateScene(llm, valid.scene, language, { usage, signal: controller.signal });
      const row = await insertScene(deps.pool, { orgId, conversationId: source.conversationId, sourceSceneId: source.id, turn: source.turn, scene });
      return reply.code(201).send({ id: row.id, scene });
    } catch (error) {
      if (error instanceof TranslateError) return fail(reply, 422, 'translation_failed');
      if (error instanceof Anthropic.APIError || controller.signal.aborted) return fail(reply, 502, 'llm_error');
      throw error;
    } finally {
      await addUsage(deps.pool, orgId, currentMonth(nowOf(deps)), usage.input, usage.output);
    }
  });
};
