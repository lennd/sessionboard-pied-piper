import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { HomeNav } from '../components/HomeNav';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { useRepos } from '../local';
import { fetchSuggestions, useCreateReview, useReviews, type ReviewSuggestions, type ReviewTarget } from './reviewsApi';

const NONE = '';
const BRANCH = 'branch';

/** List of multi-repository reviews, and the dialog that builds one: pick repositories, then one pull request (or the branch) per repository. */
export const ReviewsPage = () => {
  const { t, language } = useI18n();
  const reviews = useReviews();
  const repos = useRepos();
  const create = useCreateReview();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [selected, setSelected] = useState<string[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<ReviewSuggestions | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected.length === 0) {
      setSuggestions(null);
      return;
    }
    let cancelled = false;
    setLoadingSuggestions(true);
    fetchSuggestions(selected)
      .then((next) => { if (!cancelled) setSuggestions(next); })
      .catch((err: unknown) => { if (!cancelled) setError(errorText(t, err)); })
      .finally(() => { if (!cancelled) setLoadingSuggestions(false); });
    return () => {
      cancelled = true;
    };
    // t is stable for a language; the request depends only on the chosen repositories.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const useMatch = (match: ReviewSuggestions['matches'][number]) => setChoice((current) => ({ ...current, ...Object.fromEntries(match.pulls.map((p) => [p.repoId, String(p.number)])) }));
  const selections = selected.flatMap((repoId) => {
    const value = choice[repoId] ?? NONE;
    if (value === NONE) return [];
    const pull: ReviewTarget = value === BRANCH ? 'branch' : Number(value);
    return [{ repoId, pull }];
  });
  const submit = async () => {
    setError(null);
    try {
      const review = await create.mutateAsync({ selections });
      setCreating(false);
      navigate(`/reviews/${review.id}`);
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  return (
    <AuroraBackground soft>
      <div className="shell">
        <header className="shell-top">
          <Link to="/" className="home-link" data-testid="nav-home"><AnimatedLogo size={30} /></Link>
          <HomeNav />
          <span className="shell-spacer" />
        </header>
        <main className="shell-content glass rise repos-main">
          <section>
            <div className="row">
              <div>
                <h1>{t('reviews.title')}</h1>
                <p className="shell-sub">{t('reviews.subtitle')}</p>
              </div>
              <span className="shell-spacer" />
              <PrimaryButton className="btn-small" data-testid="reviews-new" onClick={() => setCreating(true)}>{t('reviews.new')}</PrimaryButton>
            </div>
            {reviews.data && reviews.data.length === 0 && <p className="alert ok" data-testid="reviews-empty">{t('reviews.empty')}</p>}
            {reviews.data && reviews.data.length > 0 && (
              <table className="table">
                <tbody>
                  {reviews.data.map((r) => (
                    <tr key={r.id} data-testid={`review-${r.id}`}>
                      <td><b>⇄ {r.title}</b><div className="muted-a">{r.parts.map((p) => `${p.name} ${p.pull === 'branch' ? `(${t('reviews.branch')})` : `#${p.pull}`}`).join(' · ')}</div></td>
                      <td className="muted-a">{r.explainedAt ? t('pulls.explainedAt', { when: formatRelative(r.explainedAt, language) ?? '' }) : t('reviews.notExplained')}</td>
                      <td className="muted-a">{formatRelative(r.updatedAt, language)}</td>
                      <td style={{ textAlign: 'right' }}><Link className="btn-primary btn-small" data-testid={`review-open-${r.id}`} to={`/reviews/${r.id}`}>{t('features.open')} →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </main>
      </div>
      {creating && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={t('reviews.create.title')} data-testid="review-create">
          <div className="dialog glass">
            <h2>{t('reviews.create.title')}</h2>
            <div className="field"><span className="field-label">{t('reviews.create.repos')}</span>
              {repos.data && repos.data.length === 0 && <p className="muted">{t('features.create.noRepos')}</p>}
              {repos.data?.map((r) => (
                <label key={r.id} className="row" style={{ gap: 8 }}>
                  <input type="checkbox" data-testid={`review-create-repo-${r.id}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /> {r.name} <span className="muted-a">{r.path}</span>
                </label>
              ))}
            </div>
            {suggestions && suggestions.matches.length > 0 && (
              <div className="field" data-testid="review-matches">
                <span className="field-label">{t('reviews.create.matches')}</span>
                {suggestions.matches.map((m) => (
                  <div key={m.headRef} className="row review-match" style={{ gap: 8 }}>
                    <span><code>{m.headRef}</code> <span className="muted-a">{m.pulls.map((p) => `${suggestions.repos.find((r) => r.repoId === p.repoId)?.name ?? p.repoId} #${p.number}`).join(' + ')}</span></span>
                    <span className="shell-spacer" />
                    <GhostButton className="btn-small" data-testid={`review-match-${m.headRef}`} onClick={() => useMatch(m)}>{t('reviews.create.useMatch')}</GhostButton>
                  </div>
                ))}
              </div>
            )}
            {selected.length > 0 && (
              <div className="field"><span className="field-label">{t('reviews.create.pulls')}</span>
                {loadingSuggestions && !suggestions && <p className="muted">{t('pulls.loading')}</p>}
                {suggestions?.repos.filter((r) => selected.includes(r.repoId)).map((r) => (
                  <label key={r.repoId} className="row" style={{ gap: 8 }}>
                    <span style={{ minWidth: 160 }}>▣ {r.name}</span>
                    <select className="select" data-testid={`review-create-pull-${r.repoId}`} value={choice[r.repoId] ?? NONE} onChange={(e) => setChoice((c) => ({ ...c, [r.repoId]: e.target.value }))}>
                      <option value={NONE}>{t('reviews.create.pick')}</option>
                      {r.branch && <option value={BRANCH}>{t('reviews.create.branchOption', { branch: r.branch.branch, base: r.branch.base })}</option>}
                      {r.pulls.map((p) => <option key={p.number} value={String(p.number)}>#{p.number} {p.title} · {p.headRef}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
            {error && <p className="alert error" role="alert">{error}</p>}
            <div className="row">
              <span className="shell-spacer" />
              <GhostButton data-testid="review-create-cancel" onClick={() => setCreating(false)}>{t('features.create.cancel')}</GhostButton>
              <PrimaryButton className="btn-small" data-testid="review-create-submit" loading={create.isPending} disabled={selections.length === 0 || selections.length !== selected.length} onClick={() => void submit()}>{t('reviews.create.submit')}</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </AuroraBackground>
  );
};
