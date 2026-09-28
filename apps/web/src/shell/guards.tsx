import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useMatch } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { Splash } from './components/Splash';
import { effectiveUiLanguage } from './preferences';
import { useSession, type SessionData } from './session';

export const PreferencesSync = ({ session }: { session: SessionData }) => {
  const match = useMatch('/orgs/:orgId/*');
  const { language, setLanguage } = useI18n();
  const org = session.orgs.find((o) => o.id === match?.params.orgId) ?? session.orgs[0] ?? null;
  const target = effectiveUiLanguage(session.user, org, language);
  useEffect(() => {
    if (target !== language) setLanguage(target);
    // Only react to changes of the effective preference, not to local language switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return null;
};

export const RequireAuth = () => {
  const { data: session, isLoading } = useSession();
  const location = useLocation();
  if (isLoading) return <Splash />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <>
      <PreferencesSync session={session} />
      <Outlet />
    </>
  );
};

export const HomeRedirect = () => {
  const { data: session, isLoading } = useSession();
  if (isLoading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  const first = session.orgs[0];
  return <Navigate to={first ? `/orgs/${first.id}/explore` : '/onboarding'} replace />;
};
