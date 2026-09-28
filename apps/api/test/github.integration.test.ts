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
const signed = (body: string, secret = 'whsec') => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('GitHub App flow', () => {
  it('returns an install url with a signed state', async () => {
    const { owner, org } = await setup();
    const { url } = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/github/install-url`, headers: { cookie: owner.cookie } })).json();
    expect(url).toMatch(new RegExp(`^https://github.com/apps/repo-designer/installations/new\\?state=${org.id}\\.`));
  });

  it('stores the installation from the setup callback and lists its repositories', async () => {
    const { owner, org } = await setup();
    const state = signState('state-secret', org.id);
    const res = await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=4242&state=${encodeURIComponent(state)}`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`http://localhost:5177/orgs/${org.id}/settings/repositories?connected=github`);
    const integrations = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/integrations`, headers: { cookie: owner.cookie } })).json();
    expect(integrations.github).toEqual({ configured: true, installation: { accountLogin: 'acme' } });
    const available = (await ctx.app.inject({ method: 'GET', url: `/api/orgs/${org.id}/available-repos`, headers: { cookie: owner.cookie } })).json();
    expect(available).toEqual([{ fullName: 'acme/api', defaultBranch: 'main', source: 'github' }]);
  });

  it('rejects forged or foreign state', async () => {
    const { owner, org } = await setup();
    const forged = await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=1&state=${org.id}.1.bad`, headers: { cookie: owner.cookie } });
    expect(forged.json()).toEqual({ error: { code: 'invalid_state' } });
    const other = await setup();
    const foreign = await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=1&state=${encodeURIComponent(signState('state-secret', other.org.id))}`, headers: { cookie: owner.cookie } });
    expect(foreign.statusCode).toBe(404);
  });

  it('verifies webhook signatures and enqueues re-indexing on pushes to the default branch', async () => {
    const { owner, org } = await setup();
    const state = signState('state-secret', org.id);
    await ctx.app.inject({ method: 'GET', url: `/api/github/setup?installation_id=4242&state=${encodeURIComponent(state)}`, headers: { cookie: owner.cookie } });
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
});
