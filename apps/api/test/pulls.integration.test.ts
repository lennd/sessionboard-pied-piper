import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { saveGithubApp } from '../src/db/queries/githubApp';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rawPull = (n: number) => ({ number: n, title: `Change ${n}`, user: { login: 'ana' }, draft: false, head: { ref: `feature/${n}` }, base: { ref: 'main' }, updated_at: '2026-10-01T10:00:00Z', html_url: `https://github.com/hugo/notes/pull/${n}` });
let calls: string[] = [];
const fakeGithub: typeof fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  const token = /\/app\/installations\/(\d+)\/access_tokens$/.exec(url);
  if (token) return json({ token: `tok-${token[1]}` }, 201);
  if (url.endsWith('/repos/hugo/notes/pulls?state=open&per_page=100')) return json([rawPull(5), rawPull(6)]);
  if (url.endsWith('/repos/lennd/api/pulls?state=open&per_page=100')) return json({ message: 'Resource not accessible by integration' }, 403);
  if (url.endsWith('/repos/hugo/notes/pulls/5')) return json({ ...rawPull(5), body: 'Adds **SSO** logout', additions: 12, deletions: 3, changed_files: 2 });
  if (url.endsWith('/repos/hugo/notes/pulls/5/files?per_page=100')) {
    return json([{ filename: 'src/auth/sso.ts', status: 'modified', additions: 10, deletions: 3, patch: '@@ -1 +1 @@\n-a\n+b' }, { filename: 'src/new.ts', status: 'added', additions: 2, deletions: 0 }]);
  }
  return json({ message: 'Not Found' }, 404);
};

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext({ fetch: fakeGithub }); });
beforeEach(async () => {
  await ctx.reset();
  calls = [];
});
afterAll(() => ctx.close());

const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  await saveGithubApp(ctx.pool, { appId: '77', slug: 'rd-test', name: 'RD', htmlUrl: 'https://github.com/apps/rd-test', ownerLogin: 'hugo', privateKey: PEM, webhookSecret: 'w', clientId: 'c', clientSecret: 's', stateSecret: 'st' });
  for (const [installation, account, repo] of [[11, 'hugo', 'hugo/notes'], [22, 'lennd', 'lennd/api']] as const) {
    const inst = (await ctx.pool.query<{ id: string }>('insert into github_installations (org_id, installation_id, account_login) values ($1, $2, $3) returning id', [org.id, installation, account])).rows[0]!.id;
    await ctx.pool.query("insert into repos (org_id, full_name, installation_id, status) values ($1, $2, $3, 'ready')", [org.id, repo, inst]);
  }
  return { owner, org };
};
const get = (who: { cookie: string }, url: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie: who.cookie } });

describe('open pull requests', () => {
  it('lists open pull requests per repository and flags unavailable ones', async () => {
    const { owner, org } = await setup();
    const res = (await get(owner, `/api/orgs/${org.id}/pulls`)).json();
    expect(res.configured).toBe(true);
    expect(res.repos).toEqual([
      { repo: 'hugo/notes', status: 'ok', pulls: [expect.objectContaining({ number: 5, title: 'Change 5', author: 'ana', headRef: 'feature/5' }), expect.objectContaining({ number: 6 })] },
      { repo: 'lennd/api', status: 'unavailable', pulls: [] },
    ]);
  });

  it('caches the list for a minute unless a refresh is requested', async () => {
    const { owner, org } = await setup();
    await get(owner, `/api/orgs/${org.id}/pulls`);
    const first = calls.length;
    await get(owner, `/api/orgs/${org.id}/pulls`);
    expect(calls.length).toBe(first);
    await get(owner, `/api/orgs/${org.id}/pulls?refresh=1`);
    expect(calls.length).toBeGreaterThan(first);
  });

  it('opens a pull request with its files and an impact diagram', async () => {
    const { owner, org } = await setup();
    const res = (await get(owner, `/api/orgs/${org.id}/pulls/hugo/notes/5`)).json();
    expect(res.pull).toMatchObject({ number: 5, body: 'Adds **SSO** logout', additions: 12, deletions: 3, changedFiles: 2 });
    expect(res.files).toEqual([
      { filename: 'src/auth/sso.ts', status: 'modified', additions: 10, deletions: 3 },
      { filename: 'src/new.ts', status: 'added', additions: 2, deletions: 0 },
    ]);
    expect(res.scene).toMatchObject({ id: 'pr-hugo-notes-5', title: '#5 Change 5' });
    expect(res.scene.risks.map((r: { category: string }) => r.category)).toContain('security');
  });

  it('reports when GitHub is not configured and never opens another organization pull request', async () => {
    const { owner, org } = await setup();
    const stranger = await signupVerified(ctx);
    const strangerOrg = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(stranger), payload: { name: 'Other' } })).json();
    expect((await get(stranger, `/api/orgs/${strangerOrg.id}/pulls/hugo/notes/5`)).statusCode).toBe(404);
    expect((await get(stranger, `/api/orgs/${org.id}/pulls`)).statusCode).toBe(404);
    expect((await get(stranger, `/api/orgs/${strangerOrg.id}/pulls`)).json()).toEqual({ configured: true, repos: [] });
    await ctx.pool.query('delete from github_app');
    expect((await get(owner, `/api/orgs/${org.id}/pulls?refresh=1`)).json()).toEqual({ configured: false, repos: [] });
  });
});
