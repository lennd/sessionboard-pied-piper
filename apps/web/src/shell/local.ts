import type { Level } from '@rdi/scene';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UiLanguage } from '../i18n/messages';
import type { ThemeId } from '../theme/themes';
import { apiFetch } from './api';

export type RepoInfo = { id: string; name: string; path: string; addedAt: string; kind?: 'local' | 'remote'; remote?: string | null; head: string | null; branch: string | null; hasSystemMap: boolean };
export type SetupStatus = { claude: { ok: boolean; loggedIn: boolean; email: string | null; method: string | null; detail: string | null }; gh: { ok: boolean; installed: boolean; loggedIn: boolean; login: string | null; detail: string | null }; checkedAt: string };
export type Prefs = { uiLanguage: UiLanguage | null; explanationLanguage: UiLanguage | null; theme: ThemeId | null; initialLevel: Level | null };
export type PrefsPatch = Partial<Prefs>;

export const REPOS_KEY = ['repos'] as const;
export const PREFS_KEY = ['prefs'] as const;
export const repoKey = (id: string) => ['repo', id] as const;
const REPOS_STALE_MS = 10_000;

export const useRepos = () => useQuery({ queryKey: REPOS_KEY, queryFn: () => apiFetch<RepoInfo[]>('/repos'), staleTime: REPOS_STALE_MS });
export const useRepo = (id: string) => useQuery({ queryKey: repoKey(id), queryFn: () => apiFetch<RepoInfo>(`/repos/${id}`), enabled: Boolean(id), retry: false, staleTime: REPOS_STALE_MS });
export const useSetup = () => useQuery({ queryKey: ['setup'], queryFn: () => apiFetch<SetupStatus>('/setup'), staleTime: 60_000, retry: false });
export const refreshSetup = () => apiFetch<SetupStatus>('/setup?refresh=1');

export const usePrefs = () => useQuery({ queryKey: PREFS_KEY, queryFn: () => apiFetch<Prefs>('/prefs'), staleTime: REPOS_STALE_MS });

export const useAddRepo = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { remote: string; clone: boolean }) => apiFetch<RepoInfo>('/repos', { method: 'POST', body: typeof input === 'string' ? { path: input } : input }),
    onSuccess: () => void client.invalidateQueries({ queryKey: REPOS_KEY }),
  });
};

export const useRemoveRepo = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/repos/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: REPOS_KEY }),
  });
};

export const useUpdatePrefs = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: PrefsPatch) => apiFetch<Prefs>('/prefs', { method: 'PATCH', body: patch }),
    onMutate: (patch) => {
      const previous = client.getQueryData<Prefs>(PREFS_KEY);
      if (previous) client.setQueryData(PREFS_KEY, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) client.setQueryData(PREFS_KEY, context.previous);
    },
    onSuccess: (prefs) => client.setQueryData(PREFS_KEY, prefs),
  });
};
