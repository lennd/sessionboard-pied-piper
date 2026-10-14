import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { Workspace } from '../../workspace/Workspace';
import { apiFetch } from '../api';
import { ChatPanel } from '../chat/ChatPanel';
import { Splash } from '../components/Splash';
import { usePrefs, useRepo, useUpdatePrefs } from '../local';
import { effectiveExplanationLanguage, effectiveLevel, effectiveTheme } from '../preferences';
import { HandoffDialog } from '../solutions/HandoffDialog';
import { PlanPanel } from '../solutions/PlanPanel';
import { solutionKey, solutionScenes, subscribeSolution, type SolutionDetail } from '../solutions/solutionsApi';
import { codeLoader } from './ExplorePage';

export const SolutionPage = () => {
  const { repoId = '', solutionId = '' } = useParams();
  const base = `/repos/${repoId}`;
  const repo = useRepo(repoId);
  const { data: prefs } = usePrefs();
  const updatePrefs = useUpdatePrefs();
  const { t, language, setLanguage } = useI18n();
  const client = useQueryClient();
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [handoff, setHandoff] = useState(false);
  const detail = useQuery({
    queryKey: solutionKey(base, solutionId, version),
    queryFn: () => apiFetch<SolutionDetail>(`/repos/${repoId}/solutions/${solutionId}${version ? `?version=${version}` : ''}`),
    enabled: Boolean(repoId && solutionId),
    placeholderData: keepPreviousData,
  });
  useEffect(() => subscribeSolution(base, solutionId, () => void client.invalidateQueries({ queryKey: ['solution', base, solutionId] })), [base, solutionId, client]);
  const loadCode = useMemo(() => codeLoader(repoId), [repoId]);
  const scenes = useMemo(() => (detail.data ? solutionScenes(detail.data, t) : []), [detail.data, t]);

  if (repo.isError) return <Navigate to="/" replace />;
  if (!detail.data) return <Splash />;
  const data = detail.data;
  return (
    <>
      <Workspace
        extraScenes={scenes}
        initialPanel="plan"
        panels={[{ id: 'plan', glyph: '☰', title: t('plan.title'), render: (ctx) => <PlanPanel detail={data} ctx={ctx} onVersion={setVersion} onExecute={() => setHandoff(true)} /> }]}
        chat={(ctx) => <ChatPanel base={base} ctx={ctx} language={effectiveExplanationLanguage(prefs, language)} />}
        loadCode={loadCode}
        theme={effectiveTheme(prefs)}
        onTheme={(theme) => updatePrefs.mutate({ theme })}
        onLanguage={(uiLanguage) => {
          setLanguage(uiLanguage);
          updatePrefs.mutate({ uiLanguage });
        }}
        initialLevel={effectiveLevel(prefs)}
        homeHref={`/repos/${repoId}/settings/solutions`}
      />
      {handoff && <HandoffDialog repoId={repoId} solutionId={data.id} onClose={() => setHandoff(false)} />}
    </>
  );
};
