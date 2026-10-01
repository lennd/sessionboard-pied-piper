import { createHmac } from 'node:crypto';
import { signState } from '@rdi/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

const GITHUB = { appId: '1', privateKey: 'unused', slug: 'repo-designer', webhookSecret: 'whsec', stateSecret: 'state-secret' };
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({
    github: GITHUB,
    githubClient: {
      installationToken: async () => 'ghs_x',
      listInstallationRepos: async () => [{ fullName: 'acme/api', defaultBranch: 'main', private: true }],
      getInstallation: async () => ({ accountLogin: 'acme' }),
      listPullFiles: async () => [],
      installUrl: (state: string) => `https://github.com/apps/repo-designer/installations/new?state=${state}`,
    },
  });
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};
const stateFor = async (who: Awaited<ReturnType<typeof signupVerified>>, orgId: string) => {
  const { url } = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/github/install-url`, headers: { cookie: who.cookie } })).json();
  return new URL(url).searchParams.get('state')!;
};
const setupCall = (who: { cookie: string }, installationId: number, state: string) =>
  ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=${installationId}&state=${encodeURIComponent(state)}`, headers: { cookie: who.cookie } });
const signed = (body: string, secret = 'whsec') => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('GitHub App flow', () => {
  it('returns an install url with a signed state', async () => {
    const { owner, org } = await setup();
    const { url } = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/github/install-url`, headers: { cookie: owner.cookie } })).json();
    expect(url).toMatch(new RegExp(`^https://github.com/apps/repo-designer/installations/new\\?state=${org.id}:${owner.userId}\\.`));
  });

  it('stores the installation from the setup callback and lists its repositories', async () => {
    const { owner, org } = await setup();
    const res = await setupCall(owner, 4242, await stateFor(owner, org.id));
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`http://localhost:5177/orgs/${org.id}/settings/repositories?connected=github`);
    const integrations = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/integrations`, headers: { cookie: owner.cookie } })).json();
    expect(integrations.github).toMatchObject({ configured: true, source: 'env', manifestAvailable: false, installations: [{ accountLogin: 'acme' }] });
    const available = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/available-repos`, headers: { cookie: owner.cookie } })).json();
    expect(available).toEqual([{ fullName: 'acme/api', defaultBranch: 'main', source: 'github', account: 'acme' }]);
  });

  it('rejects forged or foreign state', async () => {
    const { owner, org } = await setup();
    const forged = await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=1&state=${org.id}.1.bad`, headers: { cookie: owner.cookie } });
    expect(forged.json()).toEqual({ error: { code: 'invalid_state' } });
    const other = await setup();
    const foreign = await setupCall(owner, 1, await stateFor(other.owner, other.org.id));
    expect(foreign.json()).toEqual({ error: { code: 'invalid_state' } });
    const unsignedUser = await setupCall(owner, 1, signState('state-secret', org.id));
    expect(unsignedUser.json()).toEqual({ error: { code: 'invalid_state' } });
  });

  it('verifies webhook signatures and enqueues re-indexing on pushes to the default branch', async () => {
    const { owner, org } = await setup();
    await setupCall(owner, 4242, await stateFor(owner, org.id));
    const repo = (await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/repos`, headers: authed(owner), payload: { fullName: 'acme/api' } })).json();
    ctx.jobs.length = 0;
    const body = JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: 'acme/api', default_branch: 'main' }, installation: { id: 4242 } });
    const headers = { 'content-type': 'application/json', 'x-github-event': 'push' };
    expect((await ctx.app.inject({ method: 'POST', url: '/api/github/webhook', headers: { ...headers, 'x-hub-signature-256': signed(body, 'wrong') }, payload: body })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/github/webhook', headers, payload: body })).statusCode).toBe(401);
    expect(ctx.jobs).toEqual([]);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/github/webhook', headers: { ...headers, 'x-hub-signature-256': signed(body) }, payload: body })).statusCode).toBe(202);
    expect(ctx.jobs).toEqual([{ repoId: repo.id, orgId: org.id, reason: 'push' }]);
    const other = JSON.stringify({ ref: 'refs/heads/feature', repository: { full_name: 'acme/api', default_branch: 'main' }, installation: { id: 4242 } });
    await ctx.app.inject({ method: 'POST', url: '/api/github/webhook', headers: { ...headers, 'x-hub-signature-256': signed(other) }, payload: other });
    expect(ctx.jobs).toHaveLength(1);
  });

  it('accepts each install state only once', async () => {
    const { owner, org } = await setup();
    const state = await stateFor(owner, org.id);
    expect((await setupCall(owner, 5151, state)).statusCode).toBe(302);
    expect((await setupCall(owner, 5152, state)).json()).toEqual({ error: { code: 'invalid_state' } });
  });

  it('refuses to take over an installation that belongs to another organization', async () => {
    const victim = await setup();
    expect((await setupCall(victim.owner, 6161, await stateFor(victim.owner, victim.org.id))).statusCode).toBe(302);
    const attacker = await setup();
    const res = await setupCall(attacker.owner, 6161, await stateFor(attacker.owner, attacker.org.id));
    expect(res.json()).toEqual({ error: { code: 'installation_taken' } });
    const victimView = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${victim.org.id}/integrations`, headers: { cookie: victim.owner.cookie } })).json();
    expect(victimView.github.installations).toEqual([{ accountLogin: 'acme' }]);
    const attackerRepos = await ctx.app.inject({ method: 'GET', url: `/api/orgs/${attacker.org.id}/available-repos`, headers: { cookie: attacker.owner.cookie } });
    expect(attackerRepos.json().filter((r: { source: string }) => r.source === 'github')).toEqual([]);
  });
});
