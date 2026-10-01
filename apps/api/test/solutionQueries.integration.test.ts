import { sampleRegistry, validateSolutionDraft, type SolutionDraft } from '@rdi/scene';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addVersion, createSolution, findSolution, getVersion, listSolutions, listTaskStatuses, listVersions, setTaskStatus, updateSolution } from '../src/db/queries/solutions';
import { createApiToken, listApiTokens, resolveApiToken, revokeApiToken } from '../src/db/queries/tokens';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const scene = sampleRegistry['iot-telemetry']!;
const draft = (summary: string): SolutionDraft => {
  const result = validateSolutionDraft({ summary, sceneProposed: scene, plan: [{ id: 't1', title: 'Do it', nodeRefs: [scene.nodes[0]!.id] }, { id: 't2', title: 'Test it' }] });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.draft;
};
const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};

describe('solutions', () => {
  it('creates a solution with version 1 and appends versions', async () => {
    const { owner, org } = await setup();
    const { solution, version } = await createSolution(ctx.pool, { orgId: org.id, userId: owner.userId, title: 'Rate limits', conversationId: null, draft: draft('v1'), author: 'web' });
    expect(version.n).toBe(1);
    expect((await addVersion(ctx.pool, solution.id, 'claude-code', draft('v2'))).n).toBe(2);
    expect((await listVersions(ctx.pool, solution.id)).map((v) => [v.n, v.author, v.summary])).toEqual([[1, 'web', 'v1'], [2, 'claude-code', 'v2']]);
    expect((await getVersion(ctx.pool, solution.id))!.draft.summary).toBe('v2');
    expect((await getVersion(ctx.pool, solution.id, 1))!.draft.summary).toBe('v1');
  });

  it('never assigns the same version number to concurrent writers', async () => {
    const { owner, org } = await setup();
    const { solution } = await createSolution(ctx.pool, { orgId: org.id, userId: owner.userId, title: 'x', conversationId: null, draft: draft('v1'), author: 'web' });
    const versions = await Promise.all(Array.from({ length: 6 }, (_, i) => addVersion(ctx.pool, solution.id, 'web', draft(`c${i}`))));
    expect(versions.map((v) => v.n).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('tracks task status, progress and org scoping', async () => {
    const { owner, org } = await setup();
    const { solution } = await createSolution(ctx.pool, { orgId: org.id, userId: owner.userId, title: 'x', conversationId: null, draft: draft('v1'), author: 'web' });
    await setTaskStatus(ctx.pool, solution.id, 't1', 'done', 'merged');
    await setTaskStatus(ctx.pool, solution.id, 't1', 'done', 'merged again');
    expect((await listTaskStatuses(ctx.pool, solution.id)).map((t) => [t.task_id, t.status, t.note])).toEqual([['t1', 'done', 'merged again']]);
    await updateSolution(ctx.pool, solution.id, { status: 'in_progress', title: 'Renamed' });
    expect((await listSolutions(ctx.pool, org.id))[0]).toMatchObject({ title: 'Renamed', status: 'in_progress', latest_n: 1, tasks_total: 2, tasks_done: 1 });
    const other = await setup();
    expect(await findSolution(ctx.pool, other.org.id, solution.id)).toBeNull();
  });
});

describe('api tokens', () => {
  it('resolves active tokens only while the user is still a member', async () => {
    const { owner, org } = await setup();
    const created = await createApiToken(ctx.pool, { orgId: org.id, userId: owner.userId, name: 'laptop' });
    expect(created.token).toMatch(/^rdi_[A-Za-z0-9_-]{40,}$/);
    expect(created.prefix).toBe(created.token.slice(0, 10));
    expect(await resolveApiToken(ctx.pool, created.token, new Date())).toEqual({ tokenId: created.id, orgId: org.id, userId: owner.userId });
    expect((await listApiTokens(ctx.pool, org.id, owner.userId))[0]!.last_used_at).not.toBeNull();
    expect(await resolveApiToken(ctx.pool, 'rdi_wrong', new Date())).toBeNull();
    await ctx.pool.query('delete from memberships where org_id = $1 and user_id = $2', [org.id, owner.userId]);
    expect(await resolveApiToken(ctx.pool, created.token, new Date())).toBeNull();
  });

  it('revokes tokens', async () => {
    const { owner, org } = await setup();
    const created = await createApiToken(ctx.pool, { orgId: org.id, userId: owner.userId, name: 'ci' });
    expect(await revokeApiToken(ctx.pool, org.id, owner.userId, created.id)).toBe(1);
    expect(await resolveApiToken(ctx.pool, created.token, new Date())).toBeNull();
    expect(await listApiTokens(ctx.pool, org.id, owner.userId)).toEqual([]);
  });
});
