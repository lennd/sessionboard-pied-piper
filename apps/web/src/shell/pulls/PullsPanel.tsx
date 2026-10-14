import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import type { ChatContext } from '../../workspace/Workspace';
import { ApiError } from '../api';
import { Markdown } from '../chat/Markdown';
import { desktop } from '../desktop';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { BRANCH, explainPull, fetchPull, fetchPullImpact, fetchPulls, type PullDetail } from './pullsApi';

const STATUS_GLYPH: Record<string, string> = { added: '+', removed: '−', modified: '~' };
const NOT_FOUND = 404;
const PULLS_STALE_MS = 20_000;
type Target = number | typeof BRANCH;

export const PullsPanel = ({ repoId, ctx }: { repoId: string; ctx: ChatContext }) => {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const key = ['pulls', repoId];
  const pulls = useQuery({ queryKey: key, queryFn: () => fetchPulls(repoId), staleTime: PULLS_STALE_MS });
  const [opened, setOpened] = useState<{ target: Target; detail: PullDetail | null } | null>(null);
  const [loading, setLoading] = useState<Target | null>(null);
  const [noMap, setNoMap] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showImpact = async (target: Target) => {
    setNoMap(false);
    try {
      ctx.openScene(await fetchPullImpact(repoId, target), 'changes');
    } catch (err) {
      if (err instanceof ApiError && err.status === NOT_FOUND && err.code === 'no_system_map') setNoMap(true);
      else setError(errorText(t, err));
    }
  };
  const refresh = async () => {
    setError(null);
    try {
      client.setQueryData(key, await fetchPulls(repoId, true));
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const open = async (target: Target) => {
    setError(null);
    setExplanation(null);
    setLoading(target);
    try {
      setOpened({ target, detail: target === BRANCH ? null : await fetchPull(repoId, target) });
      await showImpact(target);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setLoading(null);
    }
  };
  const explain = async () => {
    if (!opened) return;
    setExplaining(true);
    setError(null);
    try {
      const result = await explainPull(repoId, opened.target);
      ctx.openScene(result.scene, 'changes');
      setExplanation(result.text);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setExplaining(false);
    }
  };
  const openExternal = (url: string) => {
    const bridge = desktop();
    if (bridge) bridge.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (opened) {
    const branch = pulls.data?.branch ?? null;
    const pull = opened.detail?.pull ?? null;
    const files = opened.detail?.files ?? branch?.touched.map((f) => ({ ...f, additions: 0, deletions: 0 })) ?? [];
    return (
      <div className="pulls" data-testid="pull-detail">
        <button type="button" className="btn pulls-back" data-testid="pull-back" onClick={() => setOpened(null)}>← {t('pulls.back')}</button>
        <div className="pull-title"><b>{pull ? `#${pull.number} ${pull.title}` : t('pulls.branch', { base: branch?.base ?? '' })}</b></div>
        {pull && <div className="muted">{pull.author} · {pull.headRef} → {pull.baseRef}</div>}
        {pull && <div className="pull-size"><span className="add">+{pull.additions}</span> <span className="del">−{pull.deletions}</span> · {t('pulls.files', { count: pull.changedFiles })}</div>}
        {!pull && branch && <div className="muted">{t('pulls.branchHint', { count: branch.ahead, files: branch.touched.length })}</div>}
        <div className="row pulls-actions">
          <button type="button" className="btn-primary btn-small" data-testid="pull-explain" disabled={explaining} onClick={() => void explain()}>✦ {explaining ? t('pulls.explaining') : t('pulls.explain')}</button>
          <button type="button" className="btn btn-small" data-testid="pull-impact" onClick={() => void showImpact(opened.target)}>{t('pulls.impact')}</button>
          {pull && <button type="button" className="btn btn-small" data-testid="pull-github" onClick={() => openExternal(pull.url)}>{t('pulls.openGithub')} ↗</button>}
        </div>
        {noMap && <p className="chat-notice" data-testid="pull-no-map">{t('pulls.noMap')}</p>}
        {error && <p className="alert error" role="alert">{error}</p>}
        {explanation && <div className="pull-body" data-testid="pull-explanation"><Markdown text={explanation} /></div>}
        {pull?.body && <div className="pull-body"><Markdown text={pull.body} /></div>}
        <div className="sec-title">{t('pulls.changedFiles')}</div>
        <ul className="pull-files">
          {files.map((f) => (
            <li key={f.path} data-testid={`pull-file-${f.path}`} className={`pull-file is-${f.change}`}>
              <span className="pull-file-status" title={f.change}>{STATUS_GLYPH[f.change] ?? '~'} {f.change}</span>
              <span className="pull-file-name">{f.path}</span>
              {(f.additions > 0 || f.deletions > 0) && <span className="muted">+{f.additions} −{f.deletions}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const data = pulls.data;
  return (
    <div className="pulls" data-testid="pulls-panel">
      <div className="pulls-head">
        <b>{t('pulls.title')}</b>
        <button type="button" className="btn" data-testid="pulls-refresh" onClick={() => void refresh()} title={t('pulls.refresh')} aria-label={t('pulls.refresh')}>↻</button>
      </div>
      {data?.branch ? (
        <button type="button" className="pull-item" data-testid="pull-branch" disabled={loading !== null} onClick={() => void open(BRANCH)}>
          <span className="pull-item-title">⎇ {t('pulls.branch', { base: data.branch.base })}</span>
          <span className="muted">{data.branch.branch} · {t('pulls.branchHint', { count: data.branch.ahead, files: data.branch.touched.length })}</span>
        </button>
      ) : data && <p className="muted" data-testid="pull-no-branch">{t('pulls.noBranch')}</p>}
      <div className="sec-title">{t('pulls.title')}</div>
      {pulls.isLoading && <p className="muted">{t('pulls.loading')}</p>}
      {data && !data.available && <p className="chat-notice" data-testid="pulls-unavailable">{t(`pulls.unavailable.${data.reason ?? 'gh_failed'}` as MessageKey)}</p>}
      {data?.available && data.pulls.length === 0 && <p className="muted" data-testid="pulls-empty">{t('pulls.empty')}</p>}
      {data?.pulls.map((p) => (
        <button key={p.number} type="button" className="pull-item" data-testid={`pull-${p.number}`} disabled={loading !== null} onClick={() => void open(p.number)}>
          <span className="pull-item-title">#{p.number} {p.title}{p.draft && <span className="tag pull-draft">{t('pulls.draft')}</span>}</span>
          <span className="muted">{p.headRef} → {p.baseRef} · {p.author} · {formatRelative(p.updatedAt, language)}</span>
          {loading === p.number && <span className="muted">{t('pulls.opening')}</span>}
        </button>
      ))}
      {error && <p className="alert error" role="alert">{error}</p>}
    </div>
  );
};
