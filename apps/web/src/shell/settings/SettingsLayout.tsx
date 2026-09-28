import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import { apiFetch } from '../api';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { GhostButton } from '../components/Buttons';
import { clearSession, useSession, type SessionData, type SessionOrg } from '../session';

export type SettingsContext = { org: SessionOrg; session: SessionData };
export const useSettingsContext = () => useOutletContext<SettingsContext>();

const ORG_ITEMS: [string, MessageKey][] = [['general', 'nav.general'], ['members', 'nav.members'], ['repositories', 'nav.repositories'], ['usage', 'nav.usage']];
const ACCOUNT_ITEMS: [string, MessageKey][] = [['preferences', 'nav.preferences'], ['security', 'nav.security']];

export const SettingsLayout = () => {
  const { t } = useI18n();
  const { orgId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: session } = useSession();
  if (!session) return null;
  const org = session.orgs.find((o) => o.id === orgId);
  if (!org) return <Navigate to="/" replace />;

  const signOut = async () => {
    await apiFetch('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    clearSession(client);
    navigate('/login', { replace: true });
  };
  const item = ([slug, key]: [string, MessageKey]) => (
    <NavLink key={slug} to={`/orgs/${org.id}/settings/${slug}`} data-testid={`nav-${slug}`} className={({ isActive }) => (isActive ? 'shell-nav-item is-active' : 'shell-nav-item')}>
      {t(key)}
    </NavLink>
  );

  return (
    <AuroraBackground soft>
      <div className="shell">
        <header className="shell-top">
          <AnimatedLogo size={28} />
          <select aria-label={t('nav.switchOrg')} data-testid="org-switcher" value={org.id} onChange={(e) => navigate(`/orgs/${e.target.value}/settings/general`)}>
            {session.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="shell-spacer" />
          <Link className="btn-primary btn-small" to={`/orgs/${org.id}/explore`} data-testid="nav-explore">{t('nav.explore')} →</Link>
          <span className="muted-a">{session.user.email}</span>
          <GhostButton onClick={signOut} data-testid="sign-out">{t('nav.signOut')}</GhostButton>
        </header>
        <nav className="shell-nav">
          <div className="shell-nav-title">{t('nav.org')}</div>
          {ORG_ITEMS.map(item)}
          <div className="shell-nav-title">{t('nav.account')}</div>
          {ACCOUNT_ITEMS.map(item)}
        </nav>
        <main className="shell-content glass rise">
          <Outlet context={{ org, session } satisfies SettingsContext} />
        </main>
      </div>
    </AuroraBackground>
  );
};
