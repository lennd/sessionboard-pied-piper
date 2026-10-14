import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import { refreshSetup, useSetup } from '../local';

/** Tells a new person whether Claude Code and the GitHub CLI are ready, and what to run if not. Hidden once everything is green. */
export const SetupCard = ({ always = false }: { always?: boolean }) => {
  const { t } = useI18n();
  const client = useQueryClient();
  const setup = useSetup();
  const [checking, setChecking] = useState(false);
  if (!setup.data) return null;
  const { claude, gh } = setup.data;
  if (claude.ok && gh.ok && !always) return null;
  const recheck = async () => {
    setChecking(true);
    try {
      client.setQueryData(['setup'], await refreshSetup());
    } finally {
      setChecking(false);
    }
  };
  const row = (id: string, ok: boolean, title: string, detail: string | null, fix: string | null) => (
    <div className={`setup-row ${ok ? 'is-ok' : 'is-missing'}`} data-testid={`setup-${id}`}>
      <span className="setup-mark">{ok ? '✓' : '!'}</span>
      <span className="setup-body">
        <b>{title}</b>
        {detail && <span className="setup-detail">{detail}</span>}
        {fix && <code className="setup-fix">{fix}</code>}
      </span>
    </div>
  );
  return (
    <section className="setup glass rise" data-testid="setup-card">
      <div className="row">
        <b>{t('setup.title')}</b>
        <span className="shell-spacer" />
        <button type="button" className="btn-ghost btn-small" data-testid="setup-recheck" disabled={checking} onClick={() => void recheck()}>{checking ? t('setup.checking') : t('setup.recheck')}</button>
      </div>
      {row('claude', claude.ok, t('setup.claude'), claude.ok ? (claude.email ? t('setup.claudeAs', { email: claude.email }) : t('setup.ready')) : t(`setup.${claude.detail ?? 'claude_not_logged_in'}` as MessageKey), claude.ok ? null : 'claude')}
      {row('gh', gh.ok, t('setup.gh'), gh.ok ? t('setup.ghAs', { login: gh.login ?? '' }) : t(`setup.${gh.detail ?? 'gh_missing'}` as MessageKey), gh.ok ? null : gh.installed ? 'gh auth login' : 'brew install gh && gh auth login')}
      {!gh.ok && <p className="muted-a">{t('setup.ghOptional')}</p>}
    </section>
  );
};
