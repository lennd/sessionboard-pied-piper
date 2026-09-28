import { hashToken, randomToken } from '../../auth/tokens';
import { INVITATION_TTL_DAYS } from '../../domain/constants';
import type { Db } from './users';

export type InvitationRow = {
  id: string; org_id: string; email: string; role: 'admin' | 'member'; token_hash: string; invited_by: string | null;
  expires_at: Date; accepted_at: Date | null; revoked_at: Date | null; created_at: Date;
};
export type InvitationStatus = 'valid' | 'expired' | 'revoked' | 'accepted';

const DAY_MS = 86_400_000;
const expiryFrom = (now: Date) => new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS);

export const createInvitation = async (db: Db, input: { orgId: string; email: string; role: 'admin' | 'member'; invitedBy: string; now: Date }) => {
  const token = randomToken();
  const { rows } = await db.query<InvitationRow>(
    'insert into invitations (org_id, email, role, token_hash, invited_by, expires_at) values ($1, $2, $3, $4, $5, $6) returning *',
    [input.orgId, input.email, input.role, hashToken(token), input.invitedBy, expiryFrom(input.now)],
  );
  return { invitation: rows[0]!, token };
};

export const findInvitationByToken = async (db: Db, token: string): Promise<(InvitationRow & { org_name: string }) | null> =>
  (await db.query<InvitationRow & { org_name: string }>('select i.*, o.name as org_name from invitations i join orgs o on o.id = i.org_id where i.token_hash = $1', [hashToken(token)])).rows[0] ?? null;

export const invitationStatus = (inv: InvitationRow, now: Date): InvitationStatus => {
  if (inv.accepted_at) return 'accepted';
  if (inv.revoked_at) return 'revoked';
  return inv.expires_at.getTime() <= now.getTime() ? 'expired' : 'valid';
};

export const listPendingInvitations = async (db: Db, orgId: string, now: Date): Promise<InvitationRow[]> =>
  (await db.query<InvitationRow>('select * from invitations where org_id = $1 and accepted_at is null and revoked_at is null and expires_at > $2 order by created_at', [orgId, now])).rows;

export const revokeInvitation = async (db: Db, orgId: string, id: string, now: Date): Promise<number> =>
  (await db.query('update invitations set revoked_at = $3 where org_id = $1 and id = $2 and accepted_at is null and revoked_at is null', [orgId, id, now])).rowCount ?? 0;

export const renewInvitation = async (db: Db, orgId: string, id: string, now: Date) => {
  const token = randomToken();
  const { rows } = await db.query<InvitationRow>(
    'update invitations set token_hash = $3, expires_at = $4 where org_id = $1 and id = $2 and accepted_at is null and revoked_at is null returning *',
    [orgId, id, hashToken(token), expiryFrom(now)],
  );
  return rows[0] ? { invitation: rows[0], token } : null;
};

export const markInvitationAccepted = async (db: Db, id: string, now: Date): Promise<void> => {
  await db.query('update invitations set accepted_at = $2 where id = $1', [id, now]);
};
