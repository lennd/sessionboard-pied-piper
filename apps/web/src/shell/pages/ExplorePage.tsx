import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { Workspace } from '../../workspace/Workspace';
import { effectiveLevel, effectiveTheme } from '../preferences';
import { useSession, useUpdateMe } from '../session';

export const ExplorePage = () => {
  const { orgId } = useParams();
  const { data: session } = useSession();
  const updateMe = useUpdateMe();
  const { setLanguage } = useI18n();
  if (!session) return null;
  const org = session.orgs.find((o) => o.id === orgId);
  if (!org) return <Navigate to="/" replace />;
  return (
    <Workspace
      theme={effectiveTheme(session.user, org)}
      onTheme={(theme) => updateMe.mutate({ theme })}
      onLanguage={(uiLanguage) => {
        setLanguage(uiLanguage);
        updateMe.mutate({ uiLanguage });
      }}
      initialLevel={effectiveLevel(session.user)}
      homeHref={`/orgs/${org.id}/settings`}
    />
  );
};
