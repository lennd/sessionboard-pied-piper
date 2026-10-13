import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { desktop } from '../desktop';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { useAddRepo, useRemoveRepo, useRepos } from '../local';

const SHORT_SHA = 7;

export const ReposPage = () => {
  const { t, language } = useI18n();
  const repos = useRepos();
  const add = useAddRepo();
  const remove = useRemoveRepo();
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bridge = desktop();

  const submit = async (candidate: string) => {
    const value = candidate.trim();
    if (!value) return;
    setError(null);
    try {
      await add.mutateAsync(value);
      setPath('');
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const browse = async () => {
    const picked = await bridge?.pickFolder();
    if (picked) await submit(picked);
  };

  return (
    <AuroraBackground soft>
      <div className="shell">
        <header className="shell-top">
          <AnimatedLogo size={28} />
          <b>{t('app.name')}</b>
          <span className="shell-spacer" />
        </header>
        <main className="shell-content glass rise" style={{ gridColumn: '1 / -1' }}>
          <section>
            <h1>{t('repos.title')}</h1>
            <p className="shell-sub">{t('repos.subtitle')}</p>
            <form
              className="row"
              data-testid="repos-add-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(path);
              }}
            >
              <input className="input" data-testid="repos-path" aria-label={t('repos.path')} placeholder={t('repos.pathPlaceholder')} value={path} onChange={(e) => setPath(e.target.value)} style={{ flex: 1 }} />
              {bridge && <GhostButton data-testid="repos-browse" onClick={() => void browse()}>{t('repos.browse')}</GhostButton>}
              <PrimaryButton type="submit" data-testid="repos-add" loading={add.isPending} disabled={!path.trim()}>{t('repos.add')}</PrimaryButton>
            </form>
            {error && <p className="alert error" role="alert" data-testid="repos-error">{error}</p>}
            {repos.data && repos.data.length === 0 && <p className="alert ok" data-testid="repos-empty">{t('repos.empty')}</p>}
            {repos.data && repos.data.length > 0 && (
              <table className="table">
                <tbody>
                  {repos.data.map((r) => (
                    <tr key={r.id} data-testid={`repo-${r.id}`}>
                      <td><b>▣ {r.name}</b><div className="muted-a">{r.path}</div></td>
                      <td className="muted-a">{r.branch ? `${r.branch} · ${(r.head ?? '').slice(0, SHORT_SHA)}` : t('repos.noGit')}</td>
                      <td><span className={`tag ${r.hasSystemMap ? 'status-done' : 'status-draft'}`}>{t(r.hasSystemMap ? 'repos.mapReady' : 'repos.mapMissing')}</span></td>
                      <td className="muted-a">{formatRelative(r.addedAt, language)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Link className="btn-primary btn-small" data-testid={`repo-open-${r.id}`} to={`/repos/${r.id}/explore`}>{t('repos.open')} →</Link>{' '}
                        <GhostButton data-testid={`repo-remove-${r.id}`} onClick={() => remove.mutate(r.id)}>{t('repos.remove')}</GhostButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </main>
      </div>
    </AuroraBackground>
  );
};
