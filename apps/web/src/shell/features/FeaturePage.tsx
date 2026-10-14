import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { CodeRef } from '../../workspace/panels/CodeDrawer';
import { Workspace } from '../../workspace/Workspace';
import { apiFetch } from '../api';
import { ChatPanel } from '../chat/ChatPanel';
import { Splash } from '../components/Splash';
import { errorText } from '../errors';
import { usePrefs, useUpdatePrefs } from '../local';
import { effectiveExplanationLanguage, effectiveLevel, effectiveTheme } from '../preferences';
import { PlanPanel, type PlanRepo } from '../solutions/PlanPanel';
import { RunView } from '../solutions/RunView';
import { solutionKey, solutionScenes, subscribeSolution, type SolutionDetail } from '../solutions/solutionsApi';
import { BriefPanel } from './BriefPanel';
import { featureBase, startFeatureRun, useFeature, useFeatureRuns } from './featuresApi';

const codeLoader = (featureId: string) => async (code: CodeRef) => {
  const query = new URLSearchParams({ repo: code.repo, path: code.path, start: String(code.startLine), end: String(code.endLine) });
  return (await apiFetch<{ snippet: string }>(`/features/${featureId}/code?${query.toString()}`)).snippet;
};

export const FeaturePage = () => {
  const { featureId = '' } = useParams();
  const base = featureBase(featureId);
  const feature = useFeature(featureId);
  const { data: prefs } = usePrefs();
  const updatePrefs = useUpdatePrefs();
  const { t, language, setLanguage } = useI18n();
  const client = useQueryClient();
  const planId = feature.data?.plan?.id ?? '';
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [run, setRun] = useState<{ repoId: string; runId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plan = useQuery({
    queryKey: solutionKey(base, planId, version),
    queryFn: () => apiFetch<SolutionDetail>(`${base}/solutions/${planId}${version ? `?version=${version}` : ''}`),
    enabled: Boolean(planId),
    placeholderData: keepPreviousData,
  });
  const runs = useFeatureRuns(featureId, Boolean(planId));
  useEffect(() => {
    if (!planId) return;
    return subscribeSolution(base, planId, () => {
      void client.invalidateQueries({ queryKey: ['solution', base, planId] });
      void client.invalidateQueries({ queryKey: ['feature', featureId] });
    });
  }, [base, planId, featureId, client]);
  const loadCode = useMemo(() => codeLoader(featureId), [featureId]);
  const scenes = useMemo(() => (plan.data ? solutionScenes(plan.data, t) : []), [plan.data, t]);
  const repos: PlanRepo[] = useMemo(
    () => (feature.data?.repos ?? []).map((r) => ({ id: r.id, name: r.name, available: r.available, run: runs.data?.find((x) => x.repoId === r.id)?.status ?? null })),
    [feature.data, runs.data],
  );

  const execute = async (repoId: string) => {
    setError(null);
    try {
      const started = await startFeatureRun(featureId, repoId);
      setRun({ repoId, runId: started.id });
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  if (feature.isError) return <Navigate to="/features" replace />;
  if (!feature.data) return <Splash />;
  const data = feature.data;
  return (
    <>
      <Workspace
        extraScenes={scenes}
        initialPanel="brief"
        panels={[
          { id: 'brief', glyph: '✎', title: t('brief.title'), render: (ctx) => <BriefPanel feature={data} ctx={ctx} /> },
          {
            id: 'plan', glyph: '☰', title: t('plan.title'),
            render: (ctx) => (plan.data ? <PlanPanel detail={plan.data} ctx={ctx} onVersion={setVersion} onExecute={() => undefined} repos={repos} onExecuteRepo={(id) => void execute(id)} /> : <p className="muted" style={{ padding: 10 }} data-testid="plan-empty">{t('plan.noPlan')}</p>),
          },
        ]}
        chat={(ctx) => <ChatPanel base={base} ctx={ctx} language={effectiveExplanationLanguage(prefs, language)} />}
        loadCode={loadCode}
        theme={effectiveTheme(prefs)}
        onTheme={(theme) => updatePrefs.mutate({ theme })}
        onLanguage={(uiLanguage) => {
          setLanguage(uiLanguage);
          updatePrefs.mutate({ uiLanguage });
        }}
        initialLevel={effectiveLevel(prefs)}
        homeHref="/features"
      />
      {error && <p className="alert error" role="alert" style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>{error}</p>}
      {run && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" data-testid="feature-run-dialog">
          <div className="dialog glass">
            <RunView repoId={run.repoId} runId={run.runId} onClose={() => { setRun(null); void runs.refetch(); }} />
          </div>
        </div>
      )}
    </>
  );
};
