import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { useSettingsContext } from './SettingsLayout';

type Stage = { name: 'clone' | 'parse' | 'detect' | 'summarize' | 'link'; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string };
type Repo = { id: string; fullName: string; defaultBranch: string; languages: string[]; status: 'pending' | 'indexing' | 'ready' | 'error'; stages: Stage[]; error: string | null; lastSyncedAt: string | null };
type Usage = { repos: number; repoLimit: number; pieces: number };
type Integrations = { github: { configured: boolean; installation: { accountLogin: string } | null }; demo: { available: boolean } };
type Available = { fullName: string; defaultBranch: string; source: 'github' | 'demo' };

const STAGE_GLYPH = { done: '✓', running: '◐', error: '✕', pending: '○' } as const;
const POLL_MS = 2000;
const BUSY = new Set(['pending', 'indexing']);

export const RepositoriesPage = () => {
  const { t, language } = useI18n();
  const { org } = useSettingsContext();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canManage = org.role !== 'member';

  const repos = useQuery({
    queryKey: ['repos', org.id],
    queryFn: () => apiFetch<Repo[]>(`/orgs/${org.id}/repos`),
    refetchInterval: (query) => ((query.state.data as Repo[] | undefined)?.some((r) => BUSY.has(r.status)) ? POLL_MS : false),
  });
  const usage = useQuery({ queryKey: ['usage', org.id], queryFn: () => apiFetch<Usage>(`/orgs/${org.id}/usage`) });
  const integrations = useQuery({ queryKey: ['integrations', org.id], queryFn: () => apiFetch<Integrations>(`/orgs/${org.id}/integrations`) });
  const available = useQuery({ queryKey: ['available-repos', org.id], queryFn: () => apiFetch<Available[]>(`/orgs/${org.id}/available-repos`) });

  useEffect(() => {
    if (!selected && available.data?.[0]) setSelected(available.data[0].fullName);
  }, [available.data, selected]);

  const refresh = () => Promise.all(['repos', 'usage', 'available-repos'].map((key) => client.invalidateQueries({ queryKey: [key, org.id] })));
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const connectGithub = () =>
    run(async () => {
      const { url } = await apiFetch<{ url: string }>(`/orgs/${org.id}/github/install-url`);
      window.location.assign(url);
    });
  const add = () =>
    run(async () => {
      await apiFetch(`/orgs/${org.id}/repos`, { method: 'POST', body: { fullName: selected } });
      setSelected('');
    });

  const github = integrations.data?.github;
  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('repos.title')}</h1>
          <p className="shell-sub">
            {t('repos.subtitle')}
            {usage.data && <> · <span data-testid="repos-limit">{t('repos.limit', { count: usage.data.repos, limit: usage.data.repoLimit })}</span></>}
          </p>
        </div>
        {github?.installation ? (
          <span className="tag" data-testid="github-connected">● {t('repos.connectedTo', { account: github.installation.accountLogin })}</span>
        ) : (
          <GhostButton disabled={!github?.configured || !canManage} title={github?.configured ? undefined : t('errors.github_not_configured')} onClick={() => void connectGithub()} data-testid="connect-github">
            + {t('repos.connect')}
          </GhostButton>
        )}
      </div>
      {params.get('connected') === 'github' && <p className="alert ok" data-testid="connected-toast">{t('repos.connectedToast')}</p>}
      {!github?.configured && integrations.data?.demo.available && <p className="alert ok" data-testid="demo-hint">{t('repos.demoHint')}</p>}
      {error && <p className="alert error" role="alert" data-testid="repos-error">{error}</p>}
      {canManage && available.data && (
        <div className="row" style={{ margin: '14px 0 20px' }}>
          {available.data.length === 0 ? (
            <span className="muted-a">{t('repos.noneAvailable')}</span>
          ) : (
            <>
              <select aria-label={t('repos.add')} value={selected} onChange={(e) => setSelected(e.target.value)} data-testid="add-repo-select" style={{ maxWidth: 360 }}>
                {available.data.map((r) => <option key={r.fullName} value={r.fullName}>{r.fullName} · {t(`repos.source.${r.source}`)}</option>)}
              </select>
              <PrimaryButton className="btn-small" onClick={() => void add()} disabled={!selected} data-testid="add-repo-submit">{t('repos.addButton')}</PrimaryButton>
            </>
          )}
        </div>
      )}
      {repos.data && repos.data.length === 0 && <p className="alert ok">{t('repos.empty')}</p>}
      {repos.data && repos.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('repos.col.repo')}</th><th>{t('repos.col.branch')}</th><th>{t('repos.col.languages')}</th><th>{t('repos.col.status')}</th><th>{t('repos.col.synced')}</th><th />
            </tr>
          </thead>
          <tbody>
            {repos.data.map((r) => (
              <tr key={r.id} data-testid={`repo-${r.fullName}`}>
                <td>▣ {r.fullName}</td>
                <td><span className="tag">{r.defaultBranch}</span></td>
                <td className="muted-a">{r.languages.join(' · ')}</td>
                <td>
                  <div><span className={`status-dot ${r.status}`} />{t(`repoStatus.${r.status}`)}{r.error && <span className="muted-a"> — {r.error}</span>}</div>
                  <div className="stages" style={{ marginTop: 6 }}>
                    {r.stages.map((s) => (
                      <span key={s.name} className={`stage ${s.status}`} data-testid={`stage-${r.fullName}-${s.name}`} title={s.detail}>
                        {STAGE_GLYPH[s.status]} {t(`stage.${s.name}`)}{s.progress !== undefined && ` ${s.progress}%`}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="muted-a">{formatRelative(r.lastSyncedAt, language) ?? t('repos.never')}</td>
                <td style={{ textAlign: 'right' }}>
                  {canManage && (
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <GhostButton data-testid={`repo-reindex-${r.fullName}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/repos/${r.id}/reindex`, { method: 'POST', body: {} }))}>{t('repos.reindex')}</GhostButton>
                      <GhostButton className="btn-danger" data-testid={`repo-remove-${r.fullName}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/repos/${r.id}`, { method: 'DELETE' }))}>{t('repos.remove')}</GhostButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
