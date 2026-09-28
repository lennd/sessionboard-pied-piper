import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { REPO_LIMIT, THEME_IDS, UI_LANGUAGES } from '../domain/constants';
import { can, type Role } from '../domain/roles';
import { createInvitation, listPendingInvitations, renewInvitation, revokeInvitation } from '../db/queries/invitations';
import { changeRoleGuarded, createOrg, findMemberByEmail, getMemberRole, listMembers, listOrgsForUser, removeMemberGuarded, updateOrg, type OrgPatch } from '../db/queries/orgs';
import { countRepos, listRepos } from '../db/queries/repos';
import { fail, isUuid, requireAction, requireAuth, requireMember } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';
import { publicInvitation, publicOrg, publicRepo } from '../http/payloads';
import { emailSchema } from './auth';

const MAX_NAME = 80;
const nameSchema = z.string().trim().min(1).max(MAX_NAME);
const orgPatchSchema = z
  .object({ name: nameSchema.optional(), defaultUiLanguage: z.enum(UI_LANGUAGES).optional(), defaultExplanationLanguage: z.enum(UI_LANGUAGES).optional(), defaultTheme: z.enum(THEME_IDS).optional() })
  .strict();
const inviteSchema = z.object({ email: emailSchema, role: z.enum(['admin', 'member']) });
const roleSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) });
const ORG_COLUMN = { name: 'name', defaultUiLanguage: 'default_ui_language', defaultExplanationLanguage: 'default_explanation_language', defaultTheme: 'default_theme' } as const;

export const orgRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const member = [requireAuth, requireMember(deps)];
  const param = (req: FastifyRequest, name: string) => (req.params as Record<string, string>)[name];

  const sendInvite = async (orgName: string, email: string, token: string) =>
    deps.mailer.send({ to: email, kind: 'invite', subject: `Join ${orgName} on Repository Designer`, text: `You were invited to ${orgName}.`, link: `${deps.config.appUrl}/invite/${token}` });

  api.get('/orgs', { preHandler: requireAuth }, async (req) => (await listOrgsForUser(deps.pool, req.auth!.user.id)).map(publicOrg));

  api.post('/orgs', { preHandler: requireAuth }, async (req, reply) => {
    const { name } = z.object({ name: nameSchema }).parse(req.body);
    const org = await createOrg(deps.pool, { name, ownerId: req.auth!.user.id });
    return reply.code(201).send(publicOrg({ ...org, role: 'owner' }));
  });

  api.get('/orgs/:orgId', { preHandler: member }, async (req) => publicOrg({ ...req.member!.org, role: req.member!.role }));

  api.patch('/orgs/:orgId', { preHandler: [...member, requireAction('org.update')] }, async (req) => {
    const body = orgPatchSchema.parse(req.body);
    const patch = Object.fromEntries(Object.entries(body).map(([key, value]) => [ORG_COLUMN[key as keyof typeof ORG_COLUMN], value])) as OrgPatch;
    const org = await updateOrg(deps.pool, req.member!.org.id, patch);
    return publicOrg({ ...org!, role: req.member!.role });
  });

  api.get('/orgs/:orgId/members', { preHandler: member }, async (req) => {
    const orgId = req.member!.org.id;
    const members = (await listMembers(deps.pool, orgId)).map((m) => ({ userId: m.user_id, email: m.email, name: m.name, role: m.role, joinedAt: m.created_at.toISOString() }));
    const invitations = can(req.member!.role, 'invitations.manage') ? (await listPendingInvitations(deps.pool, orgId, nowOf(deps))).map(publicInvitation) : [];
    return { members, invitations };
  });

  api.post('/orgs/:orgId/invitations', { preHandler: [...member, requireAction('invitations.manage')] }, async (req, reply) => {
    const body = inviteSchema.parse(req.body);
    const org = req.member!.org;
    if (await findMemberByEmail(deps.pool, org.id, body.email)) return fail(reply, 409, 'already_member');
    const { invitation, token } = await createInvitation(deps.pool, { orgId: org.id, email: body.email, role: body.role, invitedBy: req.auth!.user.id, now: nowOf(deps) });
    await sendInvite(org.name, invitation.email, token);
    return reply.code(201).send(publicInvitation(invitation));
  });

  api.post('/orgs/:orgId/invitations/:invitationId/resend', { preHandler: [...member, requireAction('invitations.manage')] }, async (req, reply) => {
    const id = param(req, 'invitationId');
    if (!isUuid(id)) return fail(reply, 404, 'not_found');
    const renewed = await renewInvitation(deps.pool, req.member!.org.id, id, nowOf(deps));
    if (!renewed) return fail(reply, 404, 'not_found');
    await sendInvite(req.member!.org.name, renewed.invitation.email, renewed.token);
    return publicInvitation(renewed.invitation);
  });

  api.delete('/orgs/:orgId/invitations/:invitationId', { preHandler: [...member, requireAction('invitations.manage')] }, async (req, reply) => {
    const id = param(req, 'invitationId');
    if (!isUuid(id) || (await revokeInvitation(deps.pool, req.member!.org.id, id, nowOf(deps))) === 0) return fail(reply, 404, 'not_found');
    return reply.code(204).send();
  });

  const targetOf = async (req: FastifyRequest, reply: FastifyReply): Promise<{ userId: string; role: Role } | null> => {
    const userId = param(req, 'userId');
    const role = isUuid(userId) ? await getMemberRole(deps.pool, req.member!.org.id, userId) : null;
    if (!userId || !role) {
      fail(reply, 404, 'not_found');
      return null;
    }
    return { userId, role };
  };

  api.patch('/orgs/:orgId/members/:userId', { preHandler: [...member, requireAction('members.manage')] }, async (req, reply) => {
    const { role } = roleSchema.parse(req.body);
    const target = await targetOf(req, reply);
    if (!target) return reply;
    const orgId = req.member!.org.id;
    if ((target.role === 'owner' || role === 'owner') && req.member!.role !== 'owner') return fail(reply, 403, 'forbidden');
    const result = await changeRoleGuarded(deps.pool, orgId, target.userId, role);
    if (result === 'last_owner') return fail(reply, 409, 'last_owner');
    if (result === 'not_found') return fail(reply, 404, 'not_found');
    return { userId: target.userId, role };
  });

  api.delete('/orgs/:orgId/members/:userId', { preHandler: member }, async (req, reply) => {
    const target = await targetOf(req, reply);
    if (!target) return reply;
    const self = target.userId === req.auth!.user.id;
    const orgId = req.member!.org.id;
    if (!self && !can(req.member!.role, 'members.manage')) return fail(reply, 403, 'forbidden');
    if (target.role === 'owner' && !self && req.member!.role !== 'owner') return fail(reply, 403, 'forbidden');
    const result = await removeMemberGuarded(deps.pool, orgId, target.userId);
    if (result === 'last_owner') return fail(reply, 409, 'last_owner');
    if (result === 'not_found') return fail(reply, 404, 'not_found');
    return reply.code(204).send();
  });

  api.get('/orgs/:orgId/repos', { preHandler: member }, async (req) => (await listRepos(deps.pool, req.member!.org.id)).map(publicRepo));

  api.get('/orgs/:orgId/usage', { preHandler: member }, async (req) => ({ repos: await countRepos(deps.pool, req.member!.org.id), repoLimit: REPO_LIMIT, pieces: 0 }));
};
