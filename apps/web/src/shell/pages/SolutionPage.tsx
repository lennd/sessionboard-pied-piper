import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { CodeRef } from '../../workspace/panels/CodeDrawer';
import { Workspace } from '../../workspace/Workspace';
import { apiFetch } from '../api';
import { ChatPanel } from '../chat/ChatPanel';
import { Splash } from '../components/Splash';
import { effectiveExplanationLanguage, effectiveLevel, effectiveTheme } from '../preferences';
import { useSession, useUpdateMe } from '../session';
import { HandoffDialog } from '../solutions/HandoffDialog';
import { PlanPanel } from '../solutions/PlanPanel';
import { solutionKey, solutionScenes, subscribeSolution, type SolutionDetail } from '../solutions/solutionsApi';

const codeLoader = (orgId: string) => async (code: CodeRef) => {
  const query = new URLSearchParams({ repo: code.repo, path: code.path, start: String(code.startLine), end: String(code.endLine) });
  return (await apiFetch<{ snippet: string }>(`/orgs/${orgId}/code?${query.toString()}`)).snippet;
};

export const SolutionPage = () => {
  const { orgId = '', solutionId = '' } = useParams();
  const { data: session } = useSession();
  const updateMe = useUpdateMe();
  const { t, language, setLanguage } = useI18n();
  const client = useQueryClient();
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [handoff, setHandoff] = useState(false);
  const detail = useQuery({
    queryKey: solutionKey(orgId, solutionId, version),
    queryFn: () => apiFetch<SolutionDetail>(`/orgs/${orgId}/solutions/${solutionId}${version ? `?version=${version}` : ''}`),
    enabled: Boolean(orgId && solutionId),
    placeholderData: keepPreviousData,
  });
  useEffect(() => subscribeSolution(orgId, solutionId, () => void client.invalidateQueries({ queryKey: ['solution', orgId, solutionId] })), [orgId, solutionId, client]);
  const loadCode = useMemo(() => codeLoader(orgId), [orgId]);
  const scenes = useMemo(() => (detail.data ? solutionScenes(detail.data, t) : []), [detail.data, t]);

  if (!session) return null;
  const org = session.orgs.find((o) => o.id === orgId);
  if (!org) return <Navigate to="/" replace />;
  if (!detail.data) return <Splash />;
  const data = detail.data;
  return (
    <>
      <Workspace
        extraScenes={scenes}
        initialPanel="plan"
        panels={[{ id: 'plan', glyph: '☰', title: t('plan.title'), render: (ctx) => <PlanPanel detail={data} ctx={ctx} onVersion={setVersion} onExecute={() => setHandoff(true)} /> }]}
        chat={(ctx) => <ChatPanel orgId={org.id} ctx={ctx} language={effectiveExplanationLanguage(session.user, org, language)} />}
        loadCode={loadCode}
        theme={effectiveTheme(session.user, org)}
        onTheme={(theme) => updateMe.mutate({ theme })}
        onLanguage={(uiLanguage) => {
          setLanguage(uiLanguage);
          updateMe.mutate({ uiLanguage });
        }}
        initialLevel={effectiveLevel(session.user)}
        homeHref={`/orgs/${org.id}/settings/solutions`}
      />
      {handoff && <HandoffDialog orgId={org.id} solutionId={data.id} onClose={() => setHandoff(false)} />}
    </>
  );
};
