import type { Scene, SceneRisk } from '@rdi/scene';
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { ChatContext } from '../../workspace/Workspace';
import { beginActivity } from '../../components/activity';
import { Markdown } from '../chat/Markdown';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { explainReview, fetchReviewExplanation, type ReviewInfo } from './reviewsApi';

const desktop = () => (window as Window & { rdi?: { openExternal(url: string): void } }).rdi;
const openExternal = (url: string) => {
  const bridge = desktop();
  if (bridge) bridge.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
};
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/** Risks grouped by the repository of the first piece they point at; contract risks (two repos) go first. */
const groupRisks = (scene: Scene): { repo: string; risks: SceneRisk[] }[] => {
  const repoOf = new Map(scene.nodes.map((n) => [n.id, n.repo ?? n.code?.repo ?? '']));
  const groups = new Map<string, SceneRisk[]>();
  for (const risk of [...scene.risks].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])) {
    const repos = [...new Set(risk.nodeIds.map((id) => repoOf.get(id) ?? '').filter(Boolean))];
    const key = repos.length > 1 ? repos.join(' ↔ ') : repos[0] ?? '';
    groups.set(key, [...(groups.get(key) ?? []), risk]);
  }
  return [...groups.entries()].sort(([a], [b]) => Number(b.includes('↔')) - Number(a.includes('↔'))).map(([repo, risks]) => ({ repo, risks }));
};

/** The side panel of a multi-repository review: what is being reviewed, the explanation and its risks by repository. */
export const ReviewPanel = ({ review, ctx, onExplained }: { review: ReviewInfo; ctx: ChatContext; onExplained?: () => void }) => {
  const { t, language } = useI18n();
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<{ text: string; at: string; scene: Scene } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchReviewExplanation(review.id).then((cached) => {
      if (cancelled || !cached) return;
      setExplanation(cached);
      ctx.openScene(cached.scene, 'changes');
    });
    return () => {
      cancelled = true;
    };
    // Restore once per review: the stored explanation is what the person saw last time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.id]);

  const explain = async () => {
    setExplaining(true);
    setError(null);
    const end = beginActivity(t('busy.explain'));
    try {
      const result = await explainReview(review.id);
      const next = { text: result.text, at: new Date().toISOString(), scene: result.scene };
      setExplanation(next);
      ctx.openScene(result.scene, 'changes');
      onExplained?.();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      end();
      setExplaining(false);
    }
  };

  return (
    <div className="pulls" data-testid="review-panel">
      <div className="pull-title"><b>{review.title}</b></div>
      <ul className="review-parts">
        {review.parts.map((part) => (
          <li key={part.repoId} className="review-part" data-testid={`review-part-${part.repoId}`}>
            <span className="review-part-repo">▣ {part.name}</span>
            <span className="muted">{part.pull === 'branch' ? t('reviews.branch') : `#${part.pull}`}</span>
            {part.url && <button type="button" className="btn btn-small" onClick={() => openExternal(part.url!)}>{t('pulls.openGithub')} ↗</button>}
            {!part.available && <span className="tag">{t('reviews.unavailable')}</span>}
          </li>
        ))}
      </ul>
      <div className="row pulls-actions">
        <button type="button" className="btn-primary btn-small" data-testid="review-explain" disabled={explaining} onClick={() => void explain()}>✦ {explaining ? t('pulls.explaining') : explanation ? t('pulls.reexplain') : t('reviews.explain')}</button>
        {explanation && !explaining && <span className="muted" data-testid="review-explained-at">{t('pulls.explainedAt', { when: formatRelative(explanation.at, language) ?? '' })}</span>}
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      {explanation && (
        <>
          <div className="pull-body" data-testid="review-explanation"><Markdown text={explanation.text} /></div>
          {explanation.scene.risks.length > 0 && (
            <>
              <div className="sec-title">{t('reviews.risks')}</div>
              {groupRisks(explanation.scene).map((group) => (
                <div key={group.repo} className="review-risk-group" data-testid={`review-risks-${group.repo.includes('↔') ? 'contract' : group.repo}`}>
                  <div className="review-risk-repo">{group.repo.includes('↔') ? `⇄ ${group.repo}` : `▣ ${group.repo}`}</div>
                  {group.risks.map((risk) => (
                    <button key={risk.id} type="button" className="risk-item" data-testid={`review-risk-${risk.id}`} onClick={() => ctx.selectNode(risk.nodeIds[0] ?? '')}>
                      <span className={`risk-dot sev-${risk.severity}`} />
                      <span><span className="muted">{t(`severity.${risk.severity}`)} · </span>{risk.title}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </>
      )}
      {!explanation && <p className="muted">{t('reviews.hint')}</p>}
    </div>
  );
};
