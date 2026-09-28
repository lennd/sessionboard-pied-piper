import { validateScene, type Scene } from '@rdi/scene';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { Workspace } from '../../workspace/Workspace';
import { ApiError, apiFetch } from '../api';
import { Splash } from '../components/Splash';
import { effectiveLevel, effectiveTheme } from '../preferences';
import { useSession, useUpdateMe } from '../session';

const NOT_FOUND = 404;
const MAP_STALE_MS = 30_000;

const fetchSystemMap = async (orgId: string): Promise<Scene | null> => {
  try {
    const result = validateScene(await apiFetch<unknown>(`/orgs/${orgId}/system-map`));
    return result.ok ? result.scene : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === NOT_FOUND) return null;
    throw error;
  }
};

export const ExplorePage = () => {
  const { orgId = '' } = useParams();
  const { data: session } = useSession();
  const updateMe = useUpdateMe();
  const { setLanguage } = useI18n();
  const systemMap = useQuery({ queryKey: ['system-map', orgId], queryFn: () => fetchSystemMap(orgId), staleTime: MAP_STALE_MS, retry: false, enabled: Boolean(orgId) });
  if (!session) return null;
  const org = session.orgs.find((o) => o.id === orgId);
  if (!org) return <Navigate to="/" replace />;
  if (systemMap.isLoading) return <Splash />;
  return (
    <Workspace
      extraScenes={systemMap.data ? [systemMap.data] : []}
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
