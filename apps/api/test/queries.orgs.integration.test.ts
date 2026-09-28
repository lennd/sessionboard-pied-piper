import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgPool } from '../src/checks';
import { createInvitation, findInvitationByToken, invitationStatus, listPendingInvitations, markInvitationAccepted, renewInvitation, revokeInvitation } from '../src/db/queries/invitations';
import { addMember, changeRoleGuarded, countOwners, createOrg, removeMemberGuarded, findMemberByEmail, findMembership, getMemberRole, listMembers, listOrgsForUser, removeMember, setRole, slugify, updateOrg } from '../src/db/queries/orgs';
import { countRepos, listRepos, upsertRepo } from '../src/db/queries/repos';
import { insertUser } from '../src/db/queries/users';
import { TEST_DATABASE_URL } from './setup/env';

const pool = createPgPool(TEST_DATABASE_URL);
const now = new Date('2026-09-28T12:00:00Z');
const DAY = 86_400_000;

beforeEach(() => pool.query('truncate users, orgs cascade'));
afterAll(() => pool.end());

const makeUser = (email: string) => insertUser(pool, { email, name: email.split('@')[0]!, passwordHash: 'h' });

describe('orgs and memberships', () => {
  it('slugifies names', () => {
    expect(slugify('Acme Inc.')).toBe('acme-inc');
    expect(slugify('Ñandú Café')).toBe('nandu-cafe');
    expect(slugify('!!!')).toBe('org');
  });

  it('creates orgs with unique slugs and an owner', async () => {
    const ana = await makeUser('ana@acme.com');
    const a = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    const b = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    expect([a.slug, b.slug]).toEqual(['acme', 'acme-2']);
    expect((await listOrgsForUser(pool, ana.id)).map((o) => [o.name, o.role])).toEqual([['Acme', 'owner'], ['Acme', 'owner']]);
    expect((await findMembership(pool, a.id, ana.id))?.role).toBe('owner');
    expect((await updateOrg(pool, a.id, { default_theme: 'paper' }))?.default_theme).toBe('paper');
  });

  it('manages members and counts owners', async () => {
    const ana = await makeUser('ana@acme.com');
    const leo = await makeUser('leo@acme.com');
    const org = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    await addMember(pool, org.id, leo.id, 'member');
    await addMember(pool, org.id, leo.id, 'admin');
    expect(await getMemberRole(pool, org.id, leo.id)).toBe('member');
    expect((await findMemberByEmail(pool, org.id, 'LEO@acme.com'))?.user_id).toBe(leo.id);
    expect(await countOwners(pool, org.id)).toBe(1);
    expect(await setRole(pool, org.id, leo.id, 'owner')).toBe(1);
    expect(await countOwners(pool, org.id)).toBe(2);
    expect((await listMembers(pool, org.id)).map((m) => m.email)).toEqual(['ana@acme.com', 'leo@acme.com']);
    expect(await removeMember(pool, org.id, leo.id)).toBe(1);
    expect(await findMembership(pool, org.id, leo.id)).toBeNull();
  });
});

describe('last owner guard under concurrency', () => {
  it('never leaves an org without owners when owners demote each other at once', async () => {
    const ana = await makeUser('ana@acme.com');
    const leo = await makeUser('leo@acme.com');
    const org = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    await addMember(pool, org.id, leo.id, 'owner');
    const results = await Promise.all([changeRoleGuarded(pool, org.id, ana.id, 'admin'), changeRoleGuarded(pool, org.id, leo.id, 'admin')]);
    expect(results.sort()).toEqual(['last_owner', 'ok']);
    expect(await countOwners(pool, org.id)).toBe(1);
  });

  it('guards removal of the last owner', async () => {
    const ana = await makeUser('ana@acme.com');
    const org = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    expect(await removeMemberGuarded(pool, org.id, ana.id)).toBe('last_owner');
    expect(await countOwners(pool, org.id)).toBe(1);
  });
});

describe('invitations', () => {
  it('creates, finds, renews, revokes and accepts invitations', async () => {
    const ana = await makeUser('ana@acme.com');
    const org = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    const { invitation, token } = await createInvitation(pool, { orgId: org.id, email: 'sofi@acme.com', role: 'member', invitedBy: ana.id, now });
    const found = await findInvitationByToken(pool, token);
    expect(found).toMatchObject({ id: invitation.id, org_name: 'Acme', role: 'member' });
    expect(invitationStatus(found!, now)).toBe('valid');
    expect(invitationStatus(found!, new Date(now.getTime() + 8 * DAY))).toBe('expired');
    const renewed = await renewInvitation(pool, org.id, invitation.id, now);
    expect(await findInvitationByToken(pool, token)).toBeNull();
    expect(await findInvitationByToken(pool, renewed!.token)).not.toBeNull();
    expect((await listPendingInvitations(pool, org.id, now)).map((i) => i.email)).toEqual(['sofi@acme.com']);
    await markInvitationAccepted(pool, invitation.id, now);
    expect(invitationStatus((await findInvitationByToken(pool, renewed!.token))!, now)).toBe('accepted');
    expect(await listPendingInvitations(pool, org.id, now)).toEqual([]);
    const second = await createInvitation(pool, { orgId: org.id, email: 'x@acme.com', role: 'admin', invitedBy: ana.id, now });
    expect(await revokeInvitation(pool, org.id, second.invitation.id, now)).toBe(1);
    expect(invitationStatus((await findInvitationByToken(pool, second.token))!, now)).toBe('revoked');
    expect(await renewInvitation(pool, org.id, second.invitation.id, now)).toBeNull();
  });
});

describe('repos', () => {
  it('upserts and lists repositories per org', async () => {
    const ana = await makeUser('ana@acme.com');
    const org = await createOrg(pool, { name: 'Acme', ownerId: ana.id });
    const stages = [{ name: 'clone' as const, status: 'done' as const }];
    await upsertRepo(pool, { orgId: org.id, fullName: 'acme/api', defaultBranch: 'main', languages: ['TypeScript'], status: 'indexing', stages });
    await upsertRepo(pool, { orgId: org.id, fullName: 'acme/api', defaultBranch: 'main', languages: ['TypeScript'], status: 'ready', stages });
    expect(await countRepos(pool, org.id)).toBe(1);
    expect((await listRepos(pool, org.id))[0]).toMatchObject({ full_name: 'acme/api', status: 'ready', languages: ['TypeScript'], stages });
  });
});
