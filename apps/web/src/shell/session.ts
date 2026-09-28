import type { Level } from '@rdi/scene';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { UiLanguage } from '../i18n/messages';
import type { ThemeId } from '../theme/themes';
import { ApiError, apiFetch, setCsrfToken } from './api';

export type SessionUser = { id: string; email: string; name: string; uiLanguage: UiLanguage | null; explanationLanguage: UiLanguage | null; theme: ThemeId | null; initialLevel: Level | null };
export type SessionOrg = { id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member'; defaultUiLanguage: UiLanguage; defaultExplanationLanguage: UiLanguage; defaultTheme: ThemeId };
export type SessionData = { user: SessionUser; orgs: SessionOrg[]; csrfToken: string };
export type PreferencesPatch = Partial<Pick<SessionUser, 'name' | 'uiLanguage' | 'explanationLanguage' | 'theme' | 'initialLevel'>>;

export const SESSION_KEY = ['session'] as const;
const UNAUTHORIZED = 401;
const SESSION_STALE_MS = 60_000;

export const fetchSession = async (): Promise<SessionData | null> => {
  try {
    const session = await apiFetch<SessionData>('/auth/session');
    setCsrfToken(session.csrfToken);
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === UNAUTHORIZED) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
};

export const useSession = () => useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: SESSION_STALE_MS });

export const acceptSession = (client: QueryClient, session: SessionData) => {
  setCsrfToken(session.csrfToken);
  client.setQueryData(SESSION_KEY, session);
};

export const clearSession = (client: QueryClient) => {
  setCsrfToken(null);
  client.setQueryData(SESSION_KEY, null);
};

export const useUpdateMe = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: PreferencesPatch) => apiFetch<SessionUser>('/me', { method: 'PATCH', body: patch }),
    onMutate: (patch) => {
      const previous = client.getQueryData<SessionData | null>(SESSION_KEY);
      if (previous) client.setQueryData(SESSION_KEY, { ...previous, user: { ...previous.user, ...patch } });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) client.setQueryData(SESSION_KEY, context.previous);
    },
    onSuccess: (user) => {
      const current = client.getQueryData<SessionData | null>(SESSION_KEY);
      if (current) client.setQueryData(SESSION_KEY, { ...current, user });
    },
  });
};
