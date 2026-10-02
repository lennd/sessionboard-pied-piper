import { validateScene } from '@rdi/scene';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { ChatContext } from '../../workspace/Workspace';
import { apiFetch } from '../api';
import { Markdown } from '../chat/Markdown';
import { errorText } from '../errors';
import { formatRelative } from '../format';

type PullSummary = { number: number; title: string; author: string; draft: boolean; headRef: string; baseRef: string; updatedAt: string; url: string };
type PullsList = { configured: boolean; repos: { repo: string; status: 'ok' | 'unavailable'; pulls: PullSummary[] }[] };
type PullFile = { filename: string; status: string; additions: number; deletions: number; previousFilename?: string };
type PullDetail = { pull: PullSummary & { body: string; additions: number; deletions: number; changedFiles: number }; files: PullFile[]; scene: unknown };
type Opened = { repo: string; detail: PullDetail };

const STATUS_GLYPH: Record<string, string> = { added: '+', removed: '−', modified: '~', renamed: '→' };

export const PullsPanel = ({ orgId, ctx }: { orgId: string; ctx: ChatContext }) => {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const key = ['pulls', orgId];
  const pulls = useQuery({ queryKey: key, queryFn: () => apiFetch<PullsList>(`/orgs/${orgId}/pulls`) });
  const [opened, setOpened] = useState<Opened | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      client.setQueryData(key, await apiFetch<PullsList>(`/orgs/${orgId}/pulls?refresh=1`));
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  const open = async (repo: string, number: number) => {
    setError(null);
    setLoading(`${repo}#${number}`);
    try {
      const detail = await apiFetch<PullDetail>(`/orgs/${orgId}/pulls/${repo}/${number}`);
      const scene = validateScene(detail.scene);
      if (scene.ok) ctx.openScene(scene.scene, 'changes');
      setOpened({ repo, detail });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setLoading(null);
    }
  };

  const review = (repo: string, pull: PullSummary) =>
    ctx.ask?.(`Review pull request ${repo}#${pull.number}: "${pull.title}". Explain what it changes, what it affects in the system and the risks it introduces.`, 'analyze');

  if (opened) {
    const { pull, files } = opened.detail;
    return (
      <div className="pulls" data-testid="pull-detail">
        <button type="button" className="btn pulls-back" data-testid="pull-back" onClick={() => setOpened(null)}>← {t('pulls.back')}</button>
        <div className="pull-title"><b>#{pull.number} {pull.title}</b></div>
        <div className="muted">{opened.repo} · {pull.author} · {pull.headRef} → {pull.baseRef}</div>
        <div className="pull-size"><span className="add">+{pull.additions}</span> <span className="del">−{pull.deletions}</span> · {t('pulls.files', { count: pull.changedFiles })}</div>
        <div className="row pulls-actions">
          <button type="button" className="btn-primary btn-small" data-testid="pull-review" onClick={() => review(opened.repo, pull)}>✦ {t('pulls.review')}</button>
          <a className="btn" data-testid="pull-github" href={pull.url} target="_blank" rel="noopener noreferrer">{t('pulls.openGithub')} ↗</a>
        </div>
        {pull.body && <div className="pull-body"><Markdown text={pull.body} /></div>}
        <div className="sec-title">{t('pulls.changedFiles')}</div>
        <ul className="pull-files">
          {files.map((f) => (
            <li key={f.filename} data-testid={`pull-file-${f.filename}`} className={`pull-file is-${f.status}`}>
              <span className="pull-file-status" title={f.status}>{STATUS_GLYPH[f.status] ?? '~'} {f.status}</span>
              <span className="pull-file-name">{f.filename}</span>
              <span className="muted">+{f.additions} −{f.deletions}</span>
            </li>
          ))}
        </ul>
        {error && <p className="alert error" role="alert">{error}</p>}
      </div>
    );
  }

  const data = pulls.data;
  const total = data?.repos.reduce((sum, r) => sum + r.pulls.length, 0) ?? 0;
  return (
    <div className="pulls" data-testid="pulls-panel">
      <div className="pulls-head">
        <b>{t('pulls.title')}</b>
        <button type="button" className="btn" data-testid="pulls-refresh" onClick={() => void refresh()} title={t('pulls.refresh')}>↻</button>
      </div>
      {pulls.isLoading && <p className="muted">{t('pulls.loading')}</p>}
      {data && !data.configured && <p className="chat-notice" data-testid="pulls-not-configured">{t('pulls.notConfigured')}</p>}
      {data?.configured && total === 0 && data.repos.every((r) => r.status === 'ok') && <p className="muted" data-testid="pulls-empty">{t('pulls.empty')}</p>}
      {data?.repos.map((r) => (
        <div key={r.repo} className="pulls-repo" data-testid={`pulls-repo-${r.repo}`}>
          <div className="sec-title">▣ {r.repo}</div>
          {r.status === 'unavailable' && <p className="muted">{t('pulls.unavailable')}</p>}
          {r.pulls.map((p) => (
            <button key={p.number} type="button" className="pull-item" data-testid={`pull-${r.repo}#${p.number}`} disabled={loading !== null} onClick={() => void open(r.repo, p.number)}>
              <span className="pull-item-title">#{p.number} {p.title}{p.draft && <span className="tag pull-draft">{t('pulls.draft')}</span>}</span>
              <span className="muted">{p.headRef} → {p.baseRef} · {p.author} · {formatRelative(p.updatedAt, language)}</span>
              {loading === `${r.repo}#${p.number}` && <span className="muted">{t('pulls.opening')}</span>}
            </button>
          ))}
        </div>
      ))}
      {error && <p className="alert error" role="alert">{error}</p>}
    </div>
  );
};
