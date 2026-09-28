import type pg from 'pg';
import { listOrgsForUser, type OrgWithRole } from '../db/queries/orgs';
import type { InvitationRow } from '../db/queries/invitations';
import type { RepoRow } from '../db/queries/repos';
import type { SessionRow } from '../db/queries/sessions';
import type { UserRow } from '../db/queries/users';

export const publicUser = (u: UserRow) => ({
  id: u.id, email: u.email, name: u.name, uiLanguage: u.ui_language, explanationLanguage: u.explanation_language, theme: u.theme, initialLevel: u.initial_level,
});

export const publicOrg = (o: OrgWithRole) => ({
  id: o.id, name: o.name, slug: o.slug, role: o.role,
  defaultUiLanguage: o.default_ui_language, defaultExplanationLanguage: o.default_explanation_language, defaultTheme: o.default_theme,
});

export const publicInvitation = (i: InvitationRow) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at.toISOString() });

export const publicRepo = (r: RepoRow) => ({
  id: r.id, fullName: r.full_name, defaultBranch: r.default_branch, languages: r.languages, status: r.status,
  stages: r.stages, error: r.error, lastSyncedAt: r.last_synced_at?.toISOString() ?? null,
});

export const sessionPayload = async (pool: pg.Pool, user: UserRow, session: SessionRow) => ({
  user: publicUser(user),
  orgs: (await listOrgsForUser(pool, user.id)).map(publicOrg),
  csrfToken: session.csrf_token,
});
