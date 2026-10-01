import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const ACCOUNTS: Record<string, string> = { '11': 'hugo', '22': 'lennd' };
const REPOS: Record<string, { full_name: string; default_branch: string; private: boolean }[]> = {
  'token tok-11': [{ full_name: 'hugo/notes', default_branch: 'main', private: true }],
  'token tok-22': [{ full_name: 'lennd/api', default_branch: 'develop', private: true }],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fakeGithub: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/app-manifests/good/conversions')) {
    return json({ id: 77, slug: 'rd-test', name: 'RD test', html_url: 'https://github.com/apps/rd-test', owner: { login: 'hugo' }, pem: PEM, webhook_secret: 'whs', client_id: 'c', client_secret: 's' }, 201);
  }
  let match = /\/app\/installations\/(\d+)\/access_tokens$/.exec(url);
  if (match) return json({ token: `tok-${match[1]}` }, 201);
  match = /\/app\/installations\/(\d+)$/.exec(url);
  if (match) return json({ account: { login: ACCOUNTS[match[1] ?? ""] } });
  if (url.endsWith('/installation/repositories?per_page=100')) return json({ repositories: REPOS[(init?.headers as Record<string, string>).authorization ?? ""] ?? [] });
  return json({ message: 'Not Found' }, 404);
};

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext({ fetch: fakeGithub }); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

type Who = Awaited<ReturnType<typeof signupVerified>>;
const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  return { owner, org };
};
const get = (who: Who, url: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie: who.cookie } });
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
const createApp = async (who: Who, orgId: string) => {
  const manifest = (await get(who, `/api/orgs/${orgId}/github/manifest?owner=org&org=lennd&name=RD%20test`)).json();
  return get(who, `/api/github/manifest/callback?code=good&state=${encodeURIComponent(stateOf(manifest.action))}`);
};

describe('GitHub App manifest flow', () => {
  it('prepares a manifest for the user or an organization', async () => {
    const { owner, org } = await setup();
    const res = (await get(owner, `/api/orgs/${org.id}/github/manifest?owner=org&org=lennd&name=RD%20test`)).json();
    expect(res.action).toMatch(/^https:\/\/github\.com\/organizations\/lennd\/settings\/apps\/new\?state=/);
    expect(JSON.parse(res.manifest)).toMatchObject({ name: 'RD test', redirect_url: 'http://localhost:5177/api/github/manifest/callback', setup_url: 'http://localhost:5177/api/github/setup', public: true });
    expect((await get(owner, `/api/orgs/${org.id}/github/manifest?owner=user&name=RD`)).json().action).toMatch(/^https:\/\/github\.com\/settings\/apps\/new\?state=/);
    expect((await get(owner, `/api/orgs/${org.id}/integrations`)).json().github).toMatchObject({ configured: false, manifestAvailable: true, installations: [] });
  });

  it('stores the app once and continues to the installation page', async () => {
    const { owner, org } = await setup();
    const forged = await get(owner, '/api/github/manifest/callback?code=good&state=nope');
    expect(forged.json()).toEqual({ error: { code: 'invalid_state' } });
    expect((await ctx.pool.query('select count(*)::int as n from github_app')).rows[0].n).toBe(0);
    const manifest = (await get(owner, `/api/orgs/${org.id}/github/manifest?owner=user&name=RD%20test`)).json();
    const state = stateOf(manifest.action);
    const callback = await get(owner, `/api/github/manifest/callback?code=good&state=${encodeURIComponent(state)}`);
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toMatch(/^https:\/\/github\.com\/apps\/rd-test\/installations\/new\?state=/);
    expect((await get(owner, `/api/github/manifest/callback?code=good&state=${encodeURIComponent(state)}`)).json()).toEqual({ error: { code: 'invalid_state' } });
    expect((await get(owner, `/api/orgs/${org.id}/github/manifest?owner=user&name=again`)).json()).toEqual({ error: { code: 'github_already_configured' } });
    expect((await get(owner, `/api/orgs/${org.id}/integrations`)).json().github).toMatchObject({ configured: true, source: 'manifest', appSlug: 'rd-test', appUrl: 'https://github.com/apps/rd-test', manifestAvailable: false });
  });

  it('refuses members who cannot manage repositories and states of another user', async () => {
    const { owner, org } = await setup();
    const colleague = await signupVerified(ctx);
    await ctx.pool.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'member')", [org.id, colleague.userId]);
    expect((await get(colleague, `/api/orgs/${org.id}/github/manifest?owner=user&name=x`)).statusCode).toBe(403);
    const manifest = (await get(owner, `/api/orgs/${org.id}/github/manifest?owner=user&name=x`)).json();
    expect((await get(colleague, `/api/github/manifest/callback?code=good&state=${encodeURIComponent(stateOf(manifest.action))}`)).json()).toEqual({ error: { code: 'invalid_state' } });
  });

  it('connects several GitHub accounts to one organization and keeps each repo on its installation', async () => {
    const { owner, org } = await setup();
    const first = await createApp(owner, org.id);
    expect((await get(owner, `/api/github/setup?installation_id=11&state=${encodeURIComponent(stateOf(first.headers.location as string))}`)).statusCode).toBe(302);
    const install = (await get(owner, `/api/orgs/${org.id}/github/install-url`)).json();
    expect((await get(owner, `/api/github/setup?installation_id=22&state=${encodeURIComponent(stateOf(install.url))}`)).statusCode).toBe(302);
    expect((await get(owner, `/api/orgs/${org.id}/integrations`)).json().github.installations).toEqual([{ accountLogin: 'hugo' }, { accountLogin: 'lennd' }]);
    const available = (await get(owner, `/api/orgs/${org.id}/available-repos`)).json();
    expect(available).toEqual([
      { fullName: 'hugo/notes', defaultBranch: 'main', source: 'github', account: 'hugo' },
      { fullName: 'lennd/api', defaultBranch: 'develop', source: 'github', account: 'lennd' },
    ]);
    for (const fullName of ['hugo/notes', 'lennd/api']) {
      expect((await ctx.app.inject({ method: 'POST', url: `/api/orgs/${org.id}/repos`, headers: authed(owner), payload: { fullName } })).statusCode).toBe(201);
    }
    const rows = (await ctx.pool.query('select r.full_name, gi.installation_id::int as installation from repos r join github_installations gi on gi.id = r.installation_id where r.org_id = $1 order by r.full_name', [org.id])).rows;
    expect(rows).toEqual([{ full_name: 'hugo/notes', installation: 11 }, { full_name: 'lennd/api', installation: 22 }]);
  });
});
