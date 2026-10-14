import { validateScene, type Scene } from '@rdi/scene';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { CodeRef } from '../../workspace/panels/CodeDrawer';
import { Workspace } from '../../workspace/Workspace';
import { ApiError, apiFetch } from '../api';
import { ChatPanel } from '../chat/ChatPanel';
import { Splash } from '../components/Splash';
import { errorText } from '../errors';
import { repoKey, usePrefs, useRepo, useUpdatePrefs } from '../local';
import { effectiveExplanationLanguage, effectiveLevel, effectiveTheme } from '../preferences';
import { PullsPanel } from '../pulls/PullsPanel';
import { SessionsPanel } from '../sessions/SessionsPanel';

const NOT_FOUND = 404;
const MAP_STALE_MS = 30_000;
const BANNER_STYLE = { position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 50, maxWidth: 560, display: 'flex', gap: 12, alignItems: 'center' } as const;

export const mapKey = (repoId: string) => ['system-map', repoId] as const;

const asScene = (value: unknown): Scene => {
  const result = validateScene(value);
  if (!result.ok) throw new Error('invalid_scene');
  return result.scene;
};

const fetchSystemMap = async (repoId: string): Promise<Scene | null> => {
  try {
    return asScene(await apiFetch<unknown>(`/repos/${repoId}/system-map`));
  } catch (error) {
    if (error instanceof ApiError && error.status === NOT_FOUND) return null;
    throw error;
  }
};

export const codeLoader = (repoId: string) => async (code: CodeRef) => {
  const query = new URLSearchParams({ repo: code.repo, path: code.path, start: String(code.startLine), end: String(code.endLine) });
  return (await apiFetch<{ snippet: string }>(`/repos/${repoId}/code?${query.toString()}`)).snippet;
};

export const ExplorePage = () => {
  const { repoId = '' } = useParams();
  const repo = useRepo(repoId);
  const { data: prefs } = usePrefs();
  const updatePrefs = useUpdatePrefs();
  const client = useQueryClient();
  const { setLanguage, t, language } = useI18n();
  const systemMap = useQuery({ queryKey: mapKey(repoId), queryFn: () => fetchSystemMap(repoId), staleTime: MAP_STALE_MS, retry: false, enabled: Boolean(repoId) });
  const explanationLanguage = effectiveExplanationLanguage(prefs, language);
  const generate = useMutation({
    mutationFn: () => apiFetch<{ scene: unknown }>(`/repos/${repoId}/system-map`, { method: 'POST', body: { language: explanationLanguage } }),
    onSuccess: ({ scene }) => {
      client.setQueryData(mapKey(repoId), asScene(scene));
      void client.invalidateQueries({ queryKey: repoKey(repoId) });
    },
  });
  const loadCode = useMemo(() => codeLoader(repoId), [repoId]);
  if (repo.isError) return <Navigate to="/" replace />;
  if (repo.isLoading || systemMap.isLoading) return <Splash />;
  const noMap = systemMap.isSuccess && systemMap.data === null;
  return (
    <>
      {systemMap.isError && <p className="alert error" role="alert" data-testid="system-map-error" style={BANNER_STYLE}>{t('explore.mapError')}</p>}
      {generate.isError && <p className="alert error" role="alert" data-testid="system-map-error" style={BANNER_STYLE}>{errorText(t, generate.error)}</p>}
      {noMap && !generate.isError && (
        <div className="alert ok" data-testid="explore-no-map" style={BANNER_STYLE}>
          <span>{generate.isPending ? t('explore.generating') : t('explore.noMap')}</span>
          <button type="button" className="btn-primary btn-small" data-testid="explore-generate" disabled={generate.isPending} onClick={() => generate.mutate()}>{t('explore.generate')}</button>
        </div>
      )}
      <Workspace
        loadCode={loadCode}
        panels={[
          { id: 'sessions', glyph: '⏱', title: t('sessions.title'), render: (ctx) => <SessionsPanel repoId={repoId} ctx={ctx} /> },
          { id: 'pulls', glyph: '⇄', title: t('pulls.title'), render: (ctx) => <PullsPanel repoId={repoId} ctx={ctx} /> },
        ]}
        chat={(ctx) => <ChatPanel repoId={repoId} ctx={ctx} language={explanationLanguage} />}
        extraScenes={systemMap.data ? [systemMap.data] : []}
        theme={effectiveTheme(prefs)}
        onTheme={(theme) => updatePrefs.mutate({ theme })}
        onLanguage={(uiLanguage) => {
          setLanguage(uiLanguage);
          updatePrefs.mutate({ uiLanguage });
        }}
        initialLevel={effectiveLevel(prefs)}
        homeHref={`/repos/${repoId}/settings`}
      />
    </>
  );
};
