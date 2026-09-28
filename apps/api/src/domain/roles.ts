export type Role = 'owner' | 'admin' | 'member';
export type Action = 'explore' | 'org.update' | 'members.manage' | 'invitations.manage' | 'repos.manage' | 'org.delete' | 'ownership.transfer';

const MATRIX: Record<Action, Role[]> = {
  explore: ['owner', 'admin', 'member'],
  'org.update': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'invitations.manage': ['owner', 'admin'],
  'repos.manage': ['owner', 'admin'],
  'org.delete': ['owner'],
  'ownership.transfer': ['owner'],
};

export const can = (role: Role, action: Action): boolean => MATRIX[action].includes(role);
