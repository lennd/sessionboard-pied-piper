import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addUsage, appendMessages, createConversation, currentMonth, DEFAULT_CONVERSATION_TITLE, findConversation, findRepoInstallation, findScene, searchSource,
  getUsage, insertScene, listConversations, listConversationScenes, listMessages, readSource, renameConversation,
} from '../src/db/queries/agent';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};

describe('agent queries', () => {
  it('stores conversations privately per user with append-only messages', async () => {
    const { owner, org } = await setup();
    const conv = await createConversation(ctx.pool, { orgId: org.id, userId: owner.userId });
    expect(conv.title).toBe(DEFAULT_CONVERSATION_TITLE);
    await appendMessages(ctx.pool, conv.id, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }, { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }]);
    await appendMessages(ctx.pool, conv.id, [{ role: 'user', content: [{ type: 'text', text: 'more' }] }]);
    expect((await listMessages(ctx.pool, conv.id)).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    await renameConversation(ctx.pool, conv.id, 'Orders flow');
    expect((await listConversations(ctx.pool, org.id, owner.userId)).map((c) => c.title)).toEqual(['Orders flow']);
    const other = await signupVerified(ctx);
    expect(await findConversation(ctx.pool, org.id, other.userId, conv.id)).toBeNull();
    expect(await listConversations(ctx.pool, org.id, other.userId)).toEqual([]);
  });

  it('stores scenes per org and conversation turn', async () => {
    const { owner, org } = await setup();
    const conv = await createConversation(ctx.pool, { orgId: org.id, userId: owner.userId });
    const row = await insertScene(ctx.pool, { orgId: org.id, conversationId: conv.id, sourceSceneId: null, turn: 1, scene: { id: 's' } });
    expect(await findScene(ctx.pool, org.id, owner.userId, row.id)).toMatchObject({ turn: 1, scene: { id: 's' } });
    expect((await listConversationScenes(ctx.pool, conv.id)).map((s) => s.id)).toEqual([row.id]);
    const other = await setup();
    expect(await findScene(ctx.pool, other.org.id, other.owner.userId, row.id)).toBeNull();
    const colleague = await signupVerified(ctx);
    expect(await findScene(ctx.pool, org.id, colleague.userId, row.id)).toBeNull();
  });

  it('accumulates monthly token usage', async () => {
    const { org } = await setup();
    const month = currentMonth(new Date('2026-09-28T10:00:00Z'));
    expect(month).toBe('2026-09');
    await addUsage(ctx.pool, org.id, month, 100, 20);
    await addUsage(ctx.pool, org.id, month, 50, 5);
    expect(await getUsage(ctx.pool, org.id, month)).toEqual({ input: 150, output: 25 });
    expect(await getUsage(ctx.pool, org.id, '2026-10')).toEqual({ input: 0, output: 0 });
  });

  it('reads indexed source and installations only within the org', async () => {
    const { org } = await setup();
    const repo = (await ctx.pool.query<{ id: string }>("insert into repos (org_id, full_name) values ($1, 'acme/api') returning id", [org.id])).rows[0]!.id;
    await ctx.pool.query("insert into source_files (repo_id, path, language, content) values ($1, 'src/a.ts', 'typescript', 'export const a = 1;')", [repo]);
    expect(await readSource(ctx.pool, org.id, 'acme/api', 'src/a.ts')).toEqual({ content: 'export const a = 1;', language: 'typescript' });
    const other = await setup();
    expect(await readSource(ctx.pool, other.org.id, 'acme/api', 'src/a.ts')).toBeNull();
    expect(await searchSource(ctx.pool, org.id, 'CONST A', null)).toEqual([{ repo: 'acme/api', path: 'src/a.ts', line: 1, text: 'export const a = 1;' }]);
    expect(await searchSource(ctx.pool, other.org.id, 'const a', null)).toEqual([]);
    expect(await searchSource(ctx.pool, org.id, 'const a', 'acme/web')).toEqual([]);
    expect(await findRepoInstallation(ctx.pool, org.id, 'acme/api')).toBeNull();
    const inst = (await ctx.pool.query<{ id: string }>("insert into github_installations (org_id, installation_id, account_login) values ($1, 777, 'acme') returning id", [org.id])).rows[0]!.id;
    await ctx.pool.query('update repos set installation_id = $1 where id = $2', [inst, repo]);
    expect(await findRepoInstallation(ctx.pool, org.id, 'acme/api')).toBe(777);
  });
});
