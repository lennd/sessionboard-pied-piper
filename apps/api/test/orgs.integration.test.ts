import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, createTestContext, signupVerified, tokenFromLink, uniqueEmail, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

type Who = Awaited<ReturnType<typeof signupVerified>>;
const call = (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: method === 'GET' ? { cookie: who.cookie } : authed(who), ...(payload === undefined ? {} : { payload: payload as object }) });

const setupOrg = async () => {
  const owner = await signupVerified(ctx);
  const org = (await call(owner, 'POST', '/api/orgs', { name: 'Acme' })).json();
  return { owner, org };
};

const inviteAndJoin = async (owner: Who, orgId: string, role: 'admin' | 'member') => {
  const email = uniqueEmail(role);
  await call(owner, 'POST', `/api/orgs/${orgId}/invitations`, { email, role });
  const token = tokenFromLink(ctx.mailer.inbox(email).find((m) => m.kind === 'invite')!.link!);
  const invitee = await signupVerified(ctx, email);
  const accepted = await call(invitee, 'POST', `/api/invitations/${token}/accept`, {});
  expect(accepted.json()).toEqual({ orgId });
  return invitee;
};

describe('organizations', () => {
  it('creates and lists orgs and updates defaults (owner/admin only)', async () => {
    const { owner, org } = await setupOrg();
    expect(org).toMatchObject({ name: 'Acme', slug: 'acme', role: 'owner', defaultUiLanguage: 'en' });
    expect((await call(owner, 'GET', '/api/orgs')).json()).toHaveLength(1);
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}`, { defaultTheme: 'studio', defaultUiLanguage: 'es' })).json()).toMatchObject({ defaultTheme: 'studio', defaultUiLanguage: 'es' });
    const member = await inviteAndJoin(owner, org.id, 'member');
    expect((await call(member, 'PATCH', `/api/orgs/${org.id}`, { name: 'Hacked' })).json()).toEqual({ error: { code: 'forbidden' } });
  });

  it('hides other tenants behind 404', async () => {
    const { org } = await setupOrg();
    const stranger = await signupVerified(ctx);
    for (const url of [`/api/orgs/${org.id}`, `/api/orgs/${org.id}/members`, `/api/orgs/${org.id}/repos`, '/api/orgs/not-a-uuid']) {
      const res = await call(stranger, 'GET', url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not_found' } });
    }
  });
});

describe('invitations and members', () => {
  it('invites, lists pending, resends and revokes', async () => {
    const { owner, org } = await setupOrg();
    const sofi = uniqueEmail('sofi');
    const created = (await call(owner, 'POST', `/api/orgs/${org.id}/invitations`, { email: sofi, role: 'member' })).json();
    expect(created).toMatchObject({ email: sofi, role: 'member' });
    expect(ctx.mailer.inbox(sofi)[0]!.link).toMatch(/^http:\/\/localhost:5177\/invite\//);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/members`)).json().invitations).toHaveLength(1);
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/invitations/${created.id}/resend`, {})).statusCode).toBe(200);
    expect(ctx.mailer.inbox(sofi)).toHaveLength(2);
    expect((await call(owner, 'DELETE', `/api/orgs/${org.id}/invitations/${created.id}`)).statusCode).toBe(204);
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/members`)).json().invitations).toEqual([]);
  });

  it('previews and accepts invitations only for the invited email', async () => {
    const { owner, org } = await setupOrg();
    const sofiEmail = uniqueEmail('sofi');
    await call(owner, 'POST', `/api/orgs/${org.id}/invitations`, { email: sofiEmail, role: 'admin' });
    const token = tokenFromLink(ctx.mailer.inbox(sofiEmail)[0]!.link!);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/invitations/${token}` })).json()).toEqual({ orgName: 'Acme', email: sofiEmail, role: 'admin', status: 'valid' });
    const wrong = await signupVerified(ctx);
    expect((await call(wrong, 'POST', `/api/invitations/${token}/accept`, {})).json()).toEqual({ error: { code: 'email_mismatch' } });
    const sofi = await signupVerified(ctx, sofiEmail);
    expect((await call(sofi, 'POST', `/api/invitations/${token}/accept`, {})).json()).toEqual({ orgId: org.id });
    expect((await call(sofi, 'POST', `/api/invitations/${token}/accept`, {})).json()).toEqual({ error: { code: 'invitation_unavailable' } });
    expect((await call(sofi, 'GET', `/api/orgs/${org.id}`)).json().role).toBe('admin');
  });

  it('rejects inviting existing members', async () => {
    const { owner, org } = await setupOrg();
    expect((await call(owner, 'POST', `/api/orgs/${org.id}/invitations`, { email: owner.email, role: 'member' })).json()).toEqual({ error: { code: 'already_member' } });
  });

  it('protects the last owner and owner-only changes', async () => {
    const { owner, org } = await setupOrg();
    const admin = await inviteAndJoin(owner, org.id, 'admin');
    const member = await inviteAndJoin(owner, org.id, 'member');
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}/members/${owner.userId}`, { role: 'admin' })).json()).toEqual({ error: { code: 'last_owner' } });
    expect((await call(owner, 'DELETE', `/api/orgs/${org.id}/members/${owner.userId}`)).json()).toEqual({ error: { code: 'last_owner' } });
    expect((await call(admin, 'PATCH', `/api/orgs/${org.id}/members/${member.userId}`, { role: 'owner' })).json()).toEqual({ error: { code: 'forbidden' } });
    expect((await call(admin, 'PATCH', `/api/orgs/${org.id}/members/${member.userId}`, { role: 'admin' })).statusCode).toBe(200);
    expect((await call(admin, 'PATCH', `/api/orgs/${org.id}/members/${member.userId}`, { role: 'member' })).statusCode).toBe(200);
    expect((await call(member, 'DELETE', `/api/orgs/${org.id}/members/${admin.userId}`)).json()).toEqual({ error: { code: 'forbidden' } });
    expect((await call(member, 'DELETE', `/api/orgs/${org.id}/members/${member.userId}`)).statusCode).toBe(204);
    expect((await call(member, 'GET', `/api/orgs/${org.id}`)).statusCode).toBe(404);
    expect((await call(owner, 'PATCH', `/api/orgs/${org.id}/members/${admin.userId}`, { role: 'owner' })).statusCode).toBe(200);
    expect((await call(owner, 'DELETE', `/api/orgs/${org.id}/members/${owner.userId}`)).statusCode).toBe(204);
  });

  it('lists members with roles; members do not see invitations', async () => {
    const { owner, org } = await setupOrg();
    const member = await inviteAndJoin(owner, org.id, 'member');
    await call(owner, 'POST', `/api/orgs/${org.id}/invitations`, { email: 'pending@acme.com', role: 'member' });
    const view = (await call(member, 'GET', `/api/orgs/${org.id}/members`)).json();
    expect(view.members.map((m: { role: string }) => m.role)).toEqual(['owner', 'member']);
    expect(view.invitations).toEqual([]);
  });
});

describe('repositories and usage', () => {
  it('lists seeded repositories with stages and reports usage', async () => {
    const { owner, org } = await setupOrg();
    await call(owner, 'POST', `/api/dev/orgs/${org.id}/seed-repos`, {});
    const repos = (await call(owner, 'GET', `/api/orgs/${org.id}/repos`)).json();
    expect(repos.map((r: { fullName: string }) => r.fullName)).toEqual(['acme/ml-ranker', 'acme/orders-api', 'acme/web-store']);
    expect(repos[1].stages[3]).toEqual({ name: 'summarize', status: 'running', progress: 64 });
    expect((await call(owner, 'GET', `/api/orgs/${org.id}/usage`)).json()).toEqual({ repos: 3, repoLimit: 10, pieces: 0 });
  });
});
