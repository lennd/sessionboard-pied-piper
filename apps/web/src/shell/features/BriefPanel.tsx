import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { ChatContext } from '../../workspace/Workspace';
import { errorText } from '../errors';
import { useRepos } from '../local';
import { useUpdateFeature, type FeatureInfo } from './featuresApi';

const ROWS = 10;

/** The editable source of truth of a feature: name, repositories and brief; "Propose a plan" hands the brief to the chat in plan mode. */
export const BriefPanel = ({ feature, ctx }: { feature: FeatureInfo; ctx: ChatContext }) => {
  const { t } = useI18n();
  const repos = useRepos();
  const update = useUpdateFeature(feature.id);
  const [title, setTitle] = useState(feature.title);
  const [brief, setBrief] = useState(feature.brief);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTitle(feature.title);
    setBrief(feature.brief);
  }, [feature.id, feature.title, feature.brief]);
  const dirty = title.trim() !== feature.title || brief.trimEnd() !== feature.brief.trimEnd();

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({ title: title.trim(), brief: brief.trimEnd() });
      setSaved(true);
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const toggleRepo = (id: string) => {
    const next = feature.repoIds.includes(id) ? feature.repoIds.filter((x) => x !== id) : [...feature.repoIds, id];
    if (next.length > 0) update.mutate({ repoIds: next });
  };
  const propose = async () => {
    if (dirty) await save();
    ctx.ask?.(brief.trim(), 'plan');
  };

  return (
    <div className="pulls" data-testid="brief-panel">
      <div className="pulls-head"><b>{t('brief.title')}</b></div>
      <p className="muted">{t('brief.hint')}</p>
      <input className="input" data-testid="brief-title" aria-label={t('features.create.name')} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="sec-title">{t('brief.repos')}</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {repos.data?.map((r) => {
          const on = feature.repoIds.includes(r.id);
          return (
            <button key={r.id} type="button" className={`btn btn-small${on ? ' btn-accent' : ''}`} data-testid={`brief-repo-${r.id}`} aria-pressed={on} onClick={() => toggleRepo(r.id)}>{on ? '▣' : '▢'} {r.name}</button>
          );
        })}
        {feature.repos.filter((r) => !r.available).map((r) => <span key={r.id} className="tag status-draft">{r.name} · {t('plan.repoMissing')}</span>)}
      </div>
      <textarea className="input" data-testid="brief-text" aria-label={t('brief.title')} rows={ROWS} placeholder={t('brief.placeholder')} value={brief} style={{ width: '100%', resize: 'vertical', marginTop: 8 }} onChange={(e) => { setBrief(e.target.value); setSaved(false); }} />
      <div className="row">
        <button type="button" className="btn btn-small" data-testid="brief-save" disabled={!dirty || update.isPending} onClick={() => void save()}>{t('brief.save')}</button>
        {saved && <span className="muted" data-testid="brief-saved">{t('brief.saved')}</span>}
        <span className="shell-spacer" />
        <button type="button" className="btn-primary btn-small" data-testid="brief-propose" disabled={!brief.trim() || feature.repos.every((r) => !r.available)} onClick={() => void propose()}>✦ {t('brief.propose')}</button>
      </div>
      <p className="muted">{brief.trim() ? t('brief.proposeHint') : t('brief.empty')}</p>
      {error && <p className="alert error" role="alert">{error}</p>}
    </div>
  );
};
