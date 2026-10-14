import { Link, Navigate, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { Splash } from '../components/Splash';
import { usePrefs, useRepo, type Prefs, type RepoInfo } from '../local';
import { EMPTY_PREFS } from '../preferences';

export type SettingsContext = { repo: RepoInfo; prefs: Prefs };
export const useSettingsContext = () => useOutletContext<SettingsContext>();

const ITEMS: [string, MessageKey][] = [['preferences', 'nav.preferences'], ['rules', 'nav.rules'], ['toolkit', 'nav.toolkit'], ['solutions', 'nav.solutions']];

export const SettingsLayout = () => {
  const { t } = useI18n();
  const { repoId = '' } = useParams();
  const repo = useRepo(repoId);
  const prefs = usePrefs();
  if (repo.isError) return <Navigate to="/" replace />;
  if (!repo.data) return <Splash />;
  const item = ([slug, key]: [string, MessageKey]) => (
    <NavLink key={slug} to={`/repos/${repo.data.id}/settings/${slug}`} data-testid={`nav-${slug}`} className={({ isActive }) => (isActive ? 'shell-nav-item is-active' : 'shell-nav-item')}>
      {t(key)}
    </NavLink>
  );

  return (
    <AuroraBackground soft>
      <div className="shell">
        <header className="shell-top">
          <AnimatedLogo size={28} />
          <Link className="btn-ghost btn-small" to="/" data-testid="nav-repos">← {t('nav.repos')}</Link>
          <b data-testid="repo-name">{repo.data.name}</b>
          <span className="muted-a">{repo.data.branch ?? ''}</span>
          <span className="shell-spacer" />
          <Link className="btn-primary btn-small" to={`/repos/${repo.data.id}/explore`} data-testid="nav-explore">{t('nav.explore')} →</Link>
        </header>
        <nav className="shell-nav">
          <div className="shell-nav-title">{t('nav.repo')}</div>
          {ITEMS.map(item)}
        </nav>
        <main className="shell-content glass rise">
          <Outlet context={{ repo: repo.data, prefs: prefs.data ?? EMPTY_PREFS } satisfies SettingsContext} />
        </main>
      </div>
    </AuroraBackground>
  );
};
