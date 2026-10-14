import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import type { ChatContext } from '../../workspace/Workspace';
import { beginActivity } from '../../components/activity';
import { ApiError } from '../api';
import { Markdown } from '../chat/Markdown';
import { desktop } from '../desktop';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { BRANCH, decidePull, explainPull, fetchPull, fetchPullImpact, fetchPulls, postReview, previewRisks, type Decision, type PullDetail, type PullSummary, type ReviewPosted, type ReviewState, type RiskAnchor } from './pullsApi';
import type { Scene } from '@rdi/scene';
import { verdictOf, type VerdictAction } from './verdict';

const STATUS_GLYPH: Record<string, string> = { added: '+', removed: '−', modified: '~' };
const NOT_FOUND = 404;
const MAX_PIECES = 3;

/** Small status pill of a pull request's review state. */
const ReviewTag = ({ review, t }: { review: ReviewState; t: (key: MessageKey) => string }) => {
  if (review.approvedByMe) return <span className="tag status-done" data-testid="review-tag-mine">✓ {t('pulls.review.mine')}</span>;
  if (review.decision === 'approved') return <span className="tag status-done" data-testid="review-tag-approved">✓ {t('pulls.review.approved')}</span>;
  if (review.decision === 'changes_requested') return <span className="tag status-draft" data-testid="review-tag-changes">✎ {t('pulls.review.changes')}</span>;
  return null;
};
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
  const [scene, setScene] = useState<Scene | null>(null);
  const [risks, setRisks] = useState<RiskAnchor[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<ReviewPosted | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveNote, setApproveNote] = useState('');
  const [approved, setApproved] = useState<Decision | null>(null);
  const [deciding, setDeciding] = useState(false);

  const loadRisks = async (target: Target, next: Scene) => {
    setScene(next);
    setPosted(null);
    if (target === BRANCH) {
      setRisks(null);
      return;
    }
    try {
      const { risks: anchored } = await previewRisks(repoId, target, next);
      setRisks(anchored);
      setSelected(new Set(anchored.map((r) => r.id)));
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  const showImpact = async (target: Target) => {
    setNoMap(false);
    try {
      const next = await fetchPullImpact(repoId, target);
      ctx.openScene(next, 'changes');
      await loadRisks(target, next);
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
    setScene(null);
    setRisks(null);
    setPosted(null);
    setApproved(null);
    setApproving(false);
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
    const end = beginActivity(t('busy.explain'));
    try {
      const result = await explainPull(repoId, opened.target);
      ctx.openScene(result.scene, 'changes');
      setExplanation(result.text);
      await loadRisks(opened.target, result.scene);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      end();
      setExplaining(false);
    }
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const approve = async () => {
    if (!opened || opened.target === BRANCH) return;
    setDeciding(true);
    setError(null);
    try {
      setApproved(await decidePull(repoId, opened.target, 'approve', approveNote));
      setApproving(false);
      setApproveNote('');
      void client.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setDeciding(false);
    }
  };
  const comment = async () => {
    if (!opened || opened.target === BRANCH || !scene || selected.size === 0) return;
    setPosting(true);
    setError(null);
    try {
      setPosted(await postReview(repoId, opened.target, scene, [...selected]));
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setPosting(false);
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
        {pull && <div className="muted">{pull.author} · {pull.headRef} → {pull.baseRef} <ReviewTag review={approved ? { ...pull.review, approvedByMe: true } : pull.review} t={t} /></div>}
        {pull && <div className="pull-size"><span className="add">+{pull.additions}</span> <span className="del">−{pull.deletions}</span> · {t('pulls.files', { count: pull.changedFiles })}</div>}
        {!pull && branch && <div className="muted">{t('pulls.branchHint', { count: branch.ahead, files: branch.touched.length })}</div>}
        <div className="row pulls-actions">
          <button type="button" className="btn-primary btn-small" data-testid="pull-explain" disabled={explaining} onClick={() => void explain()}>✦ {explaining ? t('pulls.explaining') : t('pulls.explain')}</button>
          <button type="button" className="btn btn-small" data-testid="pull-impact" onClick={() => void showImpact(opened.target)}>{t('pulls.impact')}</button>
          {pull && <button type="button" className="btn btn-small" data-testid="pull-github" onClick={() => openExternal(pull.url)}>{t('pulls.openGithub')} ↗</button>}
          {pull && !approved && !pull.review.approvedByMe && <button type="button" className="btn btn-small btn-accent" data-testid="pull-approve" onClick={() => setApproving((v) => !v)}>✓ {t('pulls.approve')}</button>}
        </div>
        {pull && approving && !approved && (
          <div className="chat-notice" data-testid="pull-approve-form">
            <p className="muted">{t('pulls.approveHint')}</p>
            <textarea className="input" data-testid="pull-approve-note" rows={3} placeholder={t('pulls.approvePlaceholder')} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} style={{ width: '100%' }} />
            <div className="row">
              <button type="button" className="btn-primary btn-small" data-testid="pull-approve-confirm" disabled={deciding} onClick={() => void approve()}>{deciding ? t('pulls.approving') : t('pulls.approveConfirm')}</button>
              <button type="button" className="btn btn-small" data-testid="pull-approve-cancel" onClick={() => setApproving(false)}>{t('features.create.cancel')}</button>
            </div>
          </div>
        )}
        {approved && (
          <p className="alert ok" data-testid="pull-approved">
            {t('pulls.approved')}{' '}
            {approved.url && <button type="button" className="btn btn-small" data-testid="pull-approved-open" onClick={() => openExternal(approved.url)}>{t('pulls.openReview')} ↗</button>}
          </p>
        )}
        {noMap && <p className="chat-notice" data-testid="pull-no-map">{t('pulls.noMap')}</p>}
        {error && <p className="alert error" role="alert">{error}</p>}
        {pull && scene && explanation && (() => {
          const verdict = verdictOf(scene, risks ?? []);
          const action = (a: VerdictAction) => (
            <li key={a.riskId} className="verdict-action" data-testid={`verdict-action-${a.riskId}`}>
              <b>{a.rule ? '§ ' : ''}{a.title}</b>
              <div>{a.what}</div>
              {a.where && <div className="muted">{a.where}</div>}
            </li>
          );
          return (
            <div className={`verdict is-${verdict.status}`} data-testid="pull-verdict">
              <div className="verdict-head">
                <span className="verdict-mark">{verdict.status === 'pass' ? '✓' : verdict.status === 'warn' ? '!' : '✕'}</span>
                <b>{t(`pulls.verdict.${verdict.status}`)}</b>
                <span className="muted">{t('pulls.verdict.counts', { blockers: verdict.blockers.length, warnings: verdict.warnings.length, total: verdict.total })}</span>
              </div>
              {verdict.blockers.length > 0 && (
                <>
                  <div className="sec-title">{t('pulls.verdict.toPass')}</div>
                  <ol className="verdict-list">{verdict.blockers.map(action)}</ol>
                </>
              )}
              {verdict.warnings.length > 0 && (
                <>
                  <div className="sec-title">{t('pulls.verdict.watch')}</div>
                  <ol className="verdict-list">{verdict.warnings.map(action)}</ol>
                </>
              )}
              {verdict.status === 'pass' && <p className="muted">{t('pulls.verdict.passHint')}</p>}
            </div>
          );
        })()}
        {explanation && <div className="pull-body" data-testid="pull-explanation"><Markdown text={explanation} /></div>}
        {pull && scene && (
          <div data-testid="pull-risks">
            <div className="sec-title">{t('pulls.risks')}</div>
            {risks && risks.length === 0 && <p className="muted" data-testid="pull-risks-empty">{t('pulls.risksEmpty')}</p>}
            {risks && risks.length > 0 && (
              <>
                <p className="muted">{t('pulls.risksHint')}</p>
                <ul className="risk-picks">
                  {risks.map((r) => (
                    <li key={r.id} className={`risk-pick is-${r.severity}`} data-testid={`pull-risk-${r.id}`}>
                      <label className="risk-pick-row">
                        <input type="checkbox" data-testid={`pull-risk-check-${r.id}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                        <span className="risk-pick-body">
                          <span className="risk-pick-title">{r.title}</span>
                          <span className="risk-pick-meta">
                            <span className={`tag sev-tag is-${r.severity}`}>{r.severity}</span>
                            <span className="muted">{r.category}</span>
                            <span className="muted" data-testid={`pull-risk-anchor-${r.id}`}>{r.anchor ? `${r.anchor.path}:${r.anchor.line}` : t('pulls.inSummary')}</span>
                          </span>
                          {r.pieces.length > 0 && <span className="muted risk-pick-pieces">{r.pieces.slice(0, MAX_PIECES).join(', ')}{r.pieces.length > MAX_PIECES ? ` +${r.pieces.length - MAX_PIECES}` : ''}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="row">
                  <button type="button" className="btn-primary btn-small" data-testid="pull-comment" disabled={posting || selected.size === 0} onClick={() => void comment()}>{posting ? t('pulls.commenting') : t('pulls.comment')}</button>
                </div>
              </>
            )}
            {posted && (
              <p className="alert ok" data-testid="pull-review-posted">
                {t('pulls.commented', { inline: posted.inline, summary: posted.summary })}{' '}
                <button type="button" className="btn btn-small" data-testid="pull-review-open" onClick={() => openExternal(posted.url)}>{t('pulls.openReview')} ↗</button>
              </p>
            )}
          </div>
        )}
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
      {pulls.isLoading && <p className="muted">{t('pulls.loading')}</p>}
      {data && !data.available && <p className="chat-notice" data-testid="pulls-unavailable">{t(`pulls.unavailable.${data.reason ?? 'gh_failed'}` as MessageKey)}</p>}
      {data?.available && data.pulls.length === 0 && <p className="muted" data-testid="pulls-empty">{t('pulls.empty')}</p>}
      {data?.available && ([
        { key: 'pending', title: t('pulls.pending'), items: data.pulls.filter((p) => p.review.decision !== 'approved') },
        { key: 'approved', title: t('pulls.approvedList'), items: data.pulls.filter((p) => p.review.decision === 'approved') },
      ] as { key: string; title: string; items: PullSummary[] }[]).filter((g) => g.items.length > 0).map((group) => (
        <div key={group.key} data-testid={`pulls-group-${group.key}`}>
          <div className="sec-title">{group.title} · {group.items.length}</div>
          {group.items.map((p) => (
            <button key={p.number} type="button" className={`pull-item${p.review.decision === 'approved' ? ' is-approved' : ''}`} data-testid={`pull-${p.number}`} disabled={loading !== null} onClick={() => void open(p.number)}>
              <span className="pull-item-title">#{p.number} {p.title}{p.draft && <span className="tag pull-draft">{t('pulls.draft')}</span>} <ReviewTag review={p.review} t={t} /></span>
              <span className="muted">{p.headRef} → {p.baseRef} · {p.author} · {formatRelative(p.updatedAt, language)}</span>
              {loading === p.number && <span className="muted">{t('pulls.opening')}</span>}
            </button>
          ))}
        </div>
      ))}
      {error && <p className="alert error" role="alert">{error}</p>}
    </div>
  );
};
