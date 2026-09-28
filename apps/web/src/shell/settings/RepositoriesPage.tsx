import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton } from '../components/Buttons';
import { formatRelative } from '../format';
import { useSettingsContext } from './SettingsLayout';

type Stage = { name: 'clone' | 'parse' | 'detect' | 'summarize' | 'link'; status: 'pending' | 'running' | 'done' | 'error'; progress?: number; detail?: string };
type Repo = { id: string; fullName: string; defaultBranch: string; languages: string[]; status: 'pending' | 'indexing' | 'ready' | 'error'; stages: Stage[]; error: string | null; lastSyncedAt: string | null };
type Usage = { repos: number; repoLimit: number; pieces: number };

const STAGE_GLYPH = { done: '✓', running: '◐', error: '✕', pending: '○' } as const;

export const RepositoriesPage = () => {
  const { t, language } = useI18n();
  const { org } = useSettingsContext();
  const repos = useQuery({ queryKey: ['repos', org.id], queryFn: () => apiFetch<Repo[]>(`/orgs/${org.id}/repos`) });
  const usage = useQuery({ queryKey: ['usage', org.id], queryFn: () => apiFetch<Usage>(`/orgs/${org.id}/usage`) });

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
        <GhostButton disabled title={t('repos.soon')} data-testid="connect-github">+ {t('repos.connect')}</GhostButton>
      </div>
      {repos.data && repos.data.length === 0 && <p className="alert ok">{t('repos.empty')}</p>}
      {repos.data && repos.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('repos.col.repo')}</th><th>{t('repos.col.branch')}</th><th>{t('repos.col.languages')}</th><th>{t('repos.col.status')}</th><th>{t('repos.col.synced')}</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
