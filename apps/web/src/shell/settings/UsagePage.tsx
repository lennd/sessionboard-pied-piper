import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { useSettingsContext } from './SettingsLayout';

type Usage = { repos: number; repoLimit: number; pieces: number };

export const UsagePage = () => {
  const { t } = useI18n();
  const { org } = useSettingsContext();
  const usage = useQuery({ queryKey: ['usage', org.id], queryFn: () => apiFetch<Usage>(`/orgs/${org.id}/usage`) });
  return (
    <section>
      <h1>{t('usage.title')}</h1>
      <div className="cards" style={{ marginTop: 18 }}>
        <div className="stat" data-testid="usage-repos">{t('usage.repos')}<b>{usage.data ? `${usage.data.repos} / ${usage.data.repoLimit}` : '—'}</b></div>
        <div className="stat">{t('usage.pieces')}<b>{usage.data?.pieces ?? '—'}</b></div>
        <div className="stat">{t('usage.agent')}<b>—</b><span className="muted-a">{t('usage.agentSoon')}</span></div>
      </div>
    </section>
  );
};
