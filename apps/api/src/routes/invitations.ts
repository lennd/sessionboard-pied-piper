import type { FastifyInstance } from 'fastify';
import { findInvitationByToken, invitationStatus, markInvitationAccepted } from '../db/queries/invitations';
import { addMember } from '../db/queries/orgs';
import { fail, requireAuth } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';

const MAX_TOKEN = 200;

export const invitationRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const lookup = async (token: string | undefined) => (token && token.length <= MAX_TOKEN ? findInvitationByToken(deps.pool, token) : null);

  api.get('/invitations/:token', async (req, reply) => {
    const inv = await lookup((req.params as { token?: string }).token);
    if (!inv) return fail(reply, 404, 'invalid_token');
    return { orgName: inv.org_name, email: inv.email, role: inv.role, status: invitationStatus(inv, nowOf(deps)) };
  });

  api.post('/invitations/:token/accept', { preHandler: requireAuth }, async (req, reply) => {
    const inv = await lookup((req.params as { token?: string }).token);
    if (!inv) return fail(reply, 404, 'invalid_token');
    const now = nowOf(deps);
    if (invitationStatus(inv, now) !== 'valid') return fail(reply, 410, 'invitation_unavailable');
    if (inv.email.toLowerCase() !== req.auth!.user.email.toLowerCase()) return fail(reply, 403, 'email_mismatch');
    await addMember(deps.pool, inv.org_id, req.auth!.user.id, inv.role);
    await markInvitationAccepted(deps.pool, inv.id, now);
    return { orgId: inv.org_id };
  });
};
