import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { HomeNav } from '../components/HomeNav';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { useRepos } from '../local';
import { useCreateFeature, useFeatures } from './featuresApi';

export const FeaturesPage = () => {
  const { t, language } = useI18n();
  const features = useFeatures();
  const repos = useRepos();
  const create = useCreateFeature();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const submit = async () => {
    setError(null);
    try {
      await create.mutateAsync({ title: title.trim(), repoIds: selected, brief: brief.trim() || undefined });
      setCreating(false);
      setTitle('');
      setBrief('');
      setSelected([]);
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  return (
    <AuroraBackground soft>
      <div className="shell">
        <header className="shell-top">
          <AnimatedLogo size={30} />
          <HomeNav />
          <span className="shell-spacer" />
        </header>
        <main className="shell-content glass rise repos-main">
          <section>
            <div className="row">
              <div>
                <h1>{t('features.title')}</h1>
                <p className="shell-sub">{t('features.subtitle')}</p>
              </div>
              <span className="shell-spacer" />
              <PrimaryButton className="btn-small" data-testid="features-new" onClick={() => setCreating(true)}>{t('features.new')}</PrimaryButton>
            </div>
            {features.data && features.data.length === 0 && <p className="alert ok" data-testid="features-empty">{t('features.empty')}</p>}
            {features.data && features.data.length > 0 && (
              <table className="table">
                <tbody>
                  {features.data.map((f) => (
                    <tr key={f.id} data-testid={`feature-${f.id}`}>
                      <td><b>◆ {f.title}</b><div className="muted-a">{f.repos.map((r) => r.name).join(' · ')}</div></td>
                      <td><span className={`tag status-${f.status}`}>{t(`features.status.${f.status}`)}</span></td>
                      <td className="muted-a">{f.plan ? t('plan.progress', f.plan.progress) : t('features.plan.none')}</td>
                      <td className="muted-a">{formatRelative(f.updatedAt, language)}</td>
                      <td style={{ textAlign: 'right' }}><Link className="btn-primary btn-small" data-testid={`feature-open-${f.id}`} to={`/features/${f.id}`}>{t('features.open')} →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </main>
      </div>
      {creating && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={t('features.create.title')} data-testid="feature-create">
          <div className="dialog glass">
            <h2>{t('features.create.title')}</h2>
            <label className="field"><span className="field-label">{t('features.create.name')}</span>
              <input className="input" data-testid="feature-create-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="field"><span className="field-label">{t('features.create.repos')}</span>
              {repos.data && repos.data.length === 0 && <p className="muted">{t('features.create.noRepos')}</p>}
              {repos.data?.map((r) => (
                <label key={r.id} className="row" style={{ gap: 8 }}>
                  <input type="checkbox" data-testid={`feature-create-repo-${r.id}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /> {r.name} <span className="muted-a">{r.path}</span>
                </label>
              ))}
            </div>
            <label className="field"><span className="field-label">{t('features.create.brief')}</span>
              <textarea className="input" data-testid="feature-create-brief" rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} />
            </label>
            {error && <p className="alert error" role="alert">{error}</p>}
            <div className="row">
              <span className="shell-spacer" />
              <GhostButton data-testid="feature-create-cancel" onClick={() => setCreating(false)}>{t('features.create.cancel')}</GhostButton>
              <PrimaryButton className="btn-small" data-testid="feature-create-submit" loading={create.isPending} disabled={!title.trim() || selected.length === 0} onClick={() => void submit()}>{t('features.create.submit')}</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </AuroraBackground>
  );
};
