import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { useSettingsContext } from './SettingsLayout';

type Usage = { repos: number; repoLimit: number; pieces: number };
type Agent = { enabled: boolean; model: string; tokensUsed: number; tokenBudget: number };

export const UsagePage = () => {
  const { t, language } = useI18n();
  const { org } = useSettingsContext();
  const usage = useQuery({ queryKey: ['usage', org.id], queryFn: () => apiFetch<Usage>(`/orgs/${org.id}/usage`) });
  const agent = useQuery({ queryKey: ['agent', org.id], queryFn: () => apiFetch<Agent>(`/orgs/${org.id}/agent`) });
  const number = (n: number) => n.toLocaleString(language === 'en' ? 'en-US' : language);
  return (
    <section>
      <h1>{t('usage.title')}</h1>
      <div className="cards" style={{ marginTop: 18 }}>
        <div className="stat" data-testid="usage-repos">{t('usage.repos')}<b>{usage.data ? `${usage.data.repos} / ${usage.data.repoLimit}` : '—'}</b></div>
        <div className="stat">{t('usage.pieces')}<b>{usage.data?.pieces ?? '—'}</b></div>
        <div className="stat" data-testid="usage-agent">
          {t('usage.agent')}
          <b>{agent.data ? (agent.data.enabled ? t('usage.agentTokens', { used: number(agent.data.tokensUsed), budget: number(agent.data.tokenBudget) }) : t('usage.agentOff')) : '—'}</b>
        </div>
      </div>
    </section>
  );
};
