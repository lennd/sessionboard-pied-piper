import { fileURLToPath } from 'node:url';
import { buildRepoGraph, detect, parseRepository, walkRepository } from '@rdi/indexer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeLlm } from '../src/agent/fakeLlm';
import type { LlmClient, LlmTurnInput } from '../src/agent/llm';
import Anthropic from '@anthropic-ai/sdk';
import { addUsage, currentMonth } from '../src/db/queries/agent';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
let ctx: TestContext;
let disabled: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ llm: createFakeLlm() });
  disabled = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(async () => {
  await ctx.close();
  await disabled.close();
});

type Who = Awaited<ReturnType<typeof signupVerified>>;
const setup = async (c: TestContext = ctx) => {
  const owner = await signupVerified(c);
  const org = (await c.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};
const indexApi = async (orgId: string) => {
  const repoId = (await ctx.pool.query<{ id: string }>("insert into repos (org_id, full_name, status) values ($1, 'acme-demo/shop-api', 'ready') returning id", [orgId])).rows[0]!.id;
  const walk = await walkRepository(`${FIXTURES}/shop-api`);
  const facts = await parseRepository(walk.files);
  await ctx.graph.commitRepoGraph(orgId, repoId, buildRepoGraph({ orgId, repoId, fullName: 'acme-demo/shop-api', walk, facts, detections: detect(facts) }), [repoId]);
  return repoId;
};
const newConversation = async (who: Who, orgId: string, c: TestContext = ctx) =>
  (await c.app.inject({ method: 'POST', url: `/api/orgs/${orgId}/conversations`, headers: authed(who), payload: {} })).json();
const ask = (who: Who, orgId: string, id: string, payload: object, c: TestContext = ctx) =>
  c.app.inject({ method: 'POST', url: `/api/orgs/${orgId}/conversations/${id}/messages`, headers: authed(who), payload });
const events = (body: string) =>
  body.split('\n\n').filter(Boolean).map((chunk) => {
    const [eventLine, dataLine] = chunk.split('\n');
    return { event: eventLine!.replace('event: ', ''), data: JSON.parse(dataLine!.replace('data: ', '')) };
  });

describe('agent status', () => {
  it('reports whether the agent is configured and the token budget', async () => {
    const { owner, org } = await setup();
    await addUsage(ctx.pool, org.id, currentMonth(new Date()), 1000, 200);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/agent`, headers: { cookie: owner.cookie } })).json()).toEqual({ enabled: true, model: 'fake-scripted', tokensUsed: 1200, tokenBudget: 2_000_000 });
    const off = await setup(disabled);
    expect((await disabled.app.inject({ method: 'GET', url: `/api/orgs/${off.org.id}/agent`, headers: { cookie: off.owner.cookie } })).json()).toMatchObject({ enabled: false });
    const conv = await newConversation(off.owner, off.org.id, disabled);
    expect((await ask(off.owner, off.org.id, conv.id, { text: 'hi' }, disabled)).json()).toEqual({ error: { code: 'agent_not_configured' } });
  });
});

describe('chatting', () => {
  it('streams tool progress, a validated scene and the answer, and persists the turn', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    expect(conv.title).toBe('New conversation');
    const res = await ask(owner, org.id, conv.id, { text: 'orders', language: 'es' });
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    const stream = events(res.body);
    expect(stream.map((e) => e.event)).toEqual(['tool', 'tool', 'tool', 'tool', 'scene', 'text', 'done']);
    const scene = stream.find((e) => e.event === 'scene')!.data;
    expect(scene.scene.language).toBe('es');
    expect(stream.at(-1)!.data).toMatchObject({ sceneIds: [scene.id], usage: { input: 300, output: 60 } });

    const detail = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/conversations/${conv.id}`, headers: { cookie: owner.cookie } })).json();
    expect(detail.title).toBe('orders');
    expect(detail.items).toEqual([{ role: 'user', text: 'orders', turn: 1 }, { role: 'assistant', text: expect.stringMatching(/^Here is how it fits together/), turn: 1 }]);
    expect(detail.scenes).toEqual([{ id: scene.id, turn: 1, scene: scene.scene }]);
    const list = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/conversations`, headers: { cookie: owner.cookie } })).json();
    expect(list).toEqual([{ id: conv.id, title: 'orders', updatedAt: expect.any(String) }]);
    const status = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/agent`, headers: { cookie: owner.cookie } })).json();
    expect(status.tokensUsed).toBe(360);
  });

  it('never lets another user read or write a conversation', async () => {
    const { owner, org } = await setup();
    const conv = await newConversation(owner, org.id);
    const other = await signupVerified(ctx);
    await ctx.pool.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'member')", [org.id, other.userId]);
    const stranger = await setup();
    for (const who of [other, stranger.owner]) {
      expect((await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/conversations/${conv.id}`, headers: { cookie: who.cookie } })).statusCode).toBe(404);
      expect((await ask(who, org.id, conv.id, { text: 'hi' })).statusCode).toBe(404);
    }
    expect((await ask(stranger.owner, stranger.org.id, conv.id, { text: 'hi' })).statusCode).toBe(404);
  });

  it('refuses when the monthly token budget is exhausted', async () => {
    const { owner, org } = await setup();
    await addUsage(ctx.pool, org.id, currentMonth(new Date()), 2_000_000, 0);
    const conv = await newConversation(owner, org.id);
    expect((await ask(owner, org.id, conv.id, { text: 'hi' })).json()).toEqual({ error: { code: 'token_budget_exceeded' } });
  });

  it('persists only complete tool pairs when the model fails mid-turn', async () => {
    let calls = 0;
    const failing: LlmClient = {
      model: 'failing',
      async turn(input) {
        calls++;
        if (calls === 1) return createFakeLlm().turn(input);
        throw new (await import('@anthropic-ai/sdk')).default.APIError(500, undefined, 'boom', new Headers());
      },
    };
    const local = await createTestContext({ llm: failing });
    try {
      const { owner, org } = await setup(local);
      const conv = await newConversation(owner, org.id, local);
      const stream = events((await ask(owner, org.id, conv.id, { text: 'orders' }, local)).body);
      expect(stream.map((e) => e.event)).toContain('error');
      expect(stream.at(-1)!.event).toBe('done');
      const rows = (await local.pool.query<{ role: string; content: { type: string }[] }>('select role, content from conversation_messages where conversation_id = $1 order by id', [conv.id])).rows;
      expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'user']);
      expect(rows[2]!.content.every((b) => b.type === 'tool_result')).toBe(true);
    } finally {
      await local.close();
    }
  });
});

describe('translating scenes', () => {
  it('stores a translated copy of a conversation scene and of the system map', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    const original = events((await ask(owner, org.id, conv.id, { text: 'orders' })).body).find((e) => e.event === 'scene')!.data;
    const res = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/scenes/${original.id}/translate`, headers: authed(owner), payload: { language: 'pt' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().scene).toMatchObject({ id: original.scene.id, language: 'pt' });
    const row = (await ctx.pool.query('select source_scene_id, conversation_id from scenes where id = $1', [res.json().id])).rows[0];
    expect(row).toEqual({ source_scene_id: original.id, conversation_id: conv.id });
    const map = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/scenes/system-map/translate`, headers: authed(owner), payload: { language: 'es' } });
    expect(map.json().scene).toMatchObject({ id: 'system-map', language: 'es' });
  });

  it('never translates another organization’s scene', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    const original = events((await ask(owner, org.id, conv.id, { text: 'orders' })).body).find((e) => e.event === 'scene')!.data;
    const stranger = await setup();
    const res = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${stranger.org.id}/scenes/${original.id}/translate`, headers: authed(stranger.owner), payload: { language: 'es' } });
    expect(res.statusCode).toBe(404);
  });
});

const scriptedLlm = (steps: ((input: LlmTurnInput) => unknown)[]) => {
  const inputs: LlmTurnInput[] = [];
  const llm: LlmClient = {
    model: 'scripted',
    async turn(input) {
      inputs.push({ ...input, messages: [...input.messages] });
      const step = steps.shift();
      if (!step) throw new Error('script exhausted');
      const message = (await step(input)) as Anthropic.Beta.BetaMessage;
      for (const block of message.content) if (block.type === 'text' && block.text) input.onText?.(block.text);
      return message;
    },
  };
  return { llm, inputs };
};
const reply = (content: unknown[], stop_reason: string) => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 5 } });

describe('robustness', () => {
  it('ends the stream and counts tokens when a tool fails', async () => {
    const { llm } = scriptedLlm([
      () => reply([{ type: 'tool_use', id: 't1', name: 'get_pr_diff', input: { repo: 'acme/api', number: 404 } }], 'tool_use'),
      () => reply([{ type: 'text', text: 'That PR does not exist.' }], 'end_turn'),
    ]);
    const githubClient = { installationToken: async () => 'x', listInstallationRepos: async () => [], getInstallation: async () => ({ accountLogin: 'a' }), installUrl: () => '', listOpenPulls: async () => [], getPull: async () => { throw new Error('unused'); }, listPullFiles: async () => { throw new Error('GitHub API 404: Not Found'); } };
    const local = await createTestContext({ llm, githubClient });
    try {
      const { owner, org } = await setup(local);
      const inst = (await local.pool.query<{ id: string }>("insert into github_installations (org_id, installation_id, account_login) values ($1, 4040, 'a') returning id", [org.id])).rows[0]!.id;
      await local.pool.query("insert into repos (org_id, full_name, installation_id) values ($1, 'acme/api', $2)", [org.id, inst]);
      const conv = await newConversation(owner, org.id, local);
      const stream = events((await ask(owner, org.id, conv.id, { text: 'what does PR 404 change?' }, local)).body);
      expect(stream.map((e) => e.event)).toEqual(['tool', 'tool', 'text', 'done']);
      expect(stream[1]!.data).toMatchObject({ status: 'error' });
      const usage = (await local.pool.query('select input_tokens, output_tokens from agent_usage where org_id = $1', [org.id])).rows[0];
      expect(usage).toEqual({ input_tokens: '100', output_tokens: '10' });
    } finally {
      await local.close();
    }
  });

  it('sends heartbeats while the model is silent', async () => {
    const { llm } = scriptedLlm([async () => { await new Promise((r) => setTimeout(r, 120)); return reply([{ type: 'text', text: 'ok' }], 'end_turn'); }]);
    const local = await createTestContext({ llm, heartbeatMs: 20 });
    try {
      const { owner, org } = await setup(local);
      const conv = await newConversation(owner, org.id, local);
      const body = (await ask(owner, org.id, conv.id, { text: 'hi' }, local)).body;
      expect(body).toContain(': ping\n\n');
      expect(events(body.split('\n\n').filter((c) => !c.startsWith(':')).join('\n\n') + '\n\n').at(-1)!.event).toBe('done');
    } finally {
      await local.close();
    }
  });

  it('keeps refused questions visible but out of the model history', async () => {
    const { llm, inputs } = scriptedLlm([
      () => reply([{ type: 'text', text: '' }], 'refusal'),
      () => reply([{ type: 'text', text: 'Sure.' }], 'end_turn'),
    ]);
    const local = await createTestContext({ llm });
    try {
      const { owner, org } = await setup(local);
      const conv = await newConversation(owner, org.id, local);
      await ask(owner, org.id, conv.id, { text: 'forbidden question' }, local);
      await ask(owner, org.id, conv.id, { text: 'normal question' }, local);
      const sent = JSON.stringify(inputs[1]!.messages);
      expect(sent).not.toContain('forbidden question');
      expect(sent).toContain('normal question');
      const detail = (await local.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/conversations/${conv.id}`, headers: { cookie: owner.cookie } })).json();
      expect(detail.items.map((i: { text: string }) => i.text)).toEqual(['forbidden question', 'normal question', 'Sure.']);
    } finally {
      await local.close();
    }
  });

  it('never lets another member of the org translate a private conversation scene', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    const original = events((await ask(owner, org.id, conv.id, { text: 'orders' })).body).find((e) => e.event === 'scene')!.data;
    const colleague = await signupVerified(ctx);
    await ctx.pool.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'member')", [org.id, colleague.userId]);
    const res = await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/scenes/${original.id}/translate`, headers: authed(colleague), payload: { language: 'es' } });
    expect(res.statusCode).toBe(404);
    expect((await ctx.pool.query('select count(*)::int as n from scenes where conversation_id = $1', [conv.id])).rows[0].n).toBe(1);
  });

  it('maps model failures during translation to llm_error and records the spent tokens', async () => {
    const { llm } = scriptedLlm([
      () => reply([{ type: 'tool_use', id: 't', name: 'emit_scene', input: { id: 'x' } }], 'tool_use'),
      () => { throw new Anthropic.APIError(529, undefined, 'Overloaded', new Headers()); },
    ]);
    const local = await createTestContext({ llm });
    try {
      const { owner, org } = await setup(local);
      const conv = await newConversation(owner, org.id, local);
      const row = (await local.pool.query<{ id: string }>('insert into scenes (org_id, conversation_id, turn, scene) values ($1, $2, 1, $3) returning id', [org.id, conv.id, JSON.stringify((await import('@rdi/scene')).sampleRegistry['iot-telemetry'])])).rows[0]!;
      const res = await local.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/scenes/${row.id}/translate`, headers: authed(owner), payload: { language: 'es' } });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: { code: 'llm_error' } });
      const usage = (await local.pool.query('select input_tokens from agent_usage where org_id = $1', [org.id])).rows[0];
      expect(usage).toEqual({ input_tokens: '50' });
    } finally {
      await local.close();
    }
  });
});

describe('solutions from chat', () => {
  it('stores the solution the agent proposes and streams it', async () => {
    const { owner, org } = await setup();
    await indexApi(org.id);
    const conv = await newConversation(owner, org.id);
    const stream = events((await ask(owner, org.id, conv.id, { text: 'I want order cancellation' })).body);
    const solution = stream.find((e) => e.event === 'solution')!.data;
    expect(solution).toMatchObject({ n: 1, title: 'I want order cancellation' });
    const detail = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/solutions/${solution.id}`, headers: { cookie: owner.cookie } })).json();
    expect(detail).toMatchObject({ conversationId: conv.id, version: { n: 1, author: 'web' } });
    expect(detail.version.draft.plan.length).toBeGreaterThan(0);
  });
});

describe('chat modes and scope', () => {
  it('sends the chosen mode to the model', async () => {
    const { llm, inputs } = scriptedLlm([() => reply([{ type: 'text', text: 'Plan saved.' }], 'end_turn')]);
    const local = await createTestContext({ llm });
    try {
      const { owner, org } = await setup(local);
      const conv = await newConversation(owner, org.id, local);
      await ask(owner, org.id, conv.id, { text: 'Switch signatures to SHA-256', mode: 'plan' }, local);
      expect(JSON.stringify(inputs[0]!.messages.at(-1)!.content)).toContain('Mode: plan');
    } finally {
      await local.close();
    }
  });

  it('refuses off-topic questions without calling the agent and keeps them out of the history', async () => {
    let called = 0;
    const llm: LlmClient = { model: 'spy', async turn() { called++; throw new Error('should not run'); } };
    const local = await createTestContext({ llm, scopeGuard: async () => ({ inScope: false, usage: { input: 7, output: 1 } }) });
    try {
      const { owner, org } = await setup(local);
      const conv = await newConversation(owner, org.id, local);
      const stream = events((await ask(owner, org.id, conv.id, { text: '¿Qué clima hace hoy?', language: 'es' }, local)).body);
      expect(stream.map((e) => e.event)).toEqual(['text', 'done']);
      expect(stream[0]!.data.delta).toMatch(/^Solo puedo ayudarte/);
      expect(called).toBe(0);
      const rows = (await local.pool.query('select role, excluded from conversation_messages where conversation_id = $1 order by id', [conv.id])).rows;
      expect(rows).toEqual([{ role: 'user', excluded: true }, { role: 'assistant', excluded: true }]);
      expect((await local.pool.query('select input_tokens, output_tokens from agent_usage where org_id = $1', [org.id])).rows[0]).toEqual({ input_tokens: '7', output_tokens: '1' });
      const detail = (await local.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/conversations/${conv.id}`, headers: { cookie: owner.cookie } })).json();
      expect(detail.items.map((i: { role: string }) => i.role)).toEqual(['user', 'assistant']);
    } finally {
      await local.close();
    }
  });

  it('counts the scope guard tokens for questions that are answered too', async () => {
    const { llm } = scriptedLlm([() => reply([{ type: 'text', text: 'Answer.' }], 'end_turn')]);
    const local = await createTestContext({ llm, scopeGuard: async () => ({ inScope: true, usage: { input: 7, output: 1 } }) });
    try {
      const { owner, org } = await setup(local);
      const conv = await newConversation(owner, org.id, local);
      await ask(owner, org.id, conv.id, { text: 'How does login work?' }, local);
      expect((await local.pool.query('select input_tokens, output_tokens from agent_usage where org_id = $1', [org.id])).rows[0]).toEqual({ input_tokens: '57', output_tokens: '6' });
    } finally {
      await local.close();
    }
  });
});

