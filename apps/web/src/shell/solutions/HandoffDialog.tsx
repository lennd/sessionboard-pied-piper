import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { errorText } from '../errors';

type McpInfo = { url: string; serverName: string };
const TOKEN_PLACEHOLDER = '$RDI_TOKEN';
const TOKEN_NAME = 'Claude Code';

export const mcpCommand = (info: McpInfo, token: string) => `claude mcp add --transport http ${info.serverName} ${info.url} --header "Authorization: Bearer ${token}"`;
export const runCommand = (serverName: string, solutionId: string) =>
  `claude "Use the ${serverName} MCP server: call get_solution with id ${solutionId}, then implement the plan task by task in this repository. Call report_task_progress with in_progress when you start a task and done (with a short note) when it is finished; call update_solution if the plan must change."`;

export const HandoffDialog = ({ orgId, solutionId, onClose }: { orgId: string; solutionId: string; onClose: () => void }) => {
  const { t } = useI18n();
  const info = useQuery({ queryKey: ['mcp-info'], queryFn: () => apiFetch<McpInfo>('/mcp-info') });
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createToken = async () => {
    setError(null);
    try {
      setToken((await apiFetch<{ token: string }>(`/orgs/${orgId}/tokens`, { method: 'POST', body: { name: TOKEN_NAME } })).token);
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
  };
  if (!info.data) return null;
  const mcp = mcpCommand(info.data, token ?? TOKEN_PLACEHOLDER);
  const run = runCommand(info.data.serverName, solutionId);
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={t('handoff.title')} data-testid="handoff-dialog">
      <div className="dialog glass">
        <h2>{t('handoff.title')}</h2>
        <p>{t('handoff.step1')}</p>
        <pre data-testid="handoff-mcp-command">{mcp}</pre>
        <div className="row">
          <button type="button" className="btn" data-testid="handoff-copy-mcp" onClick={() => void copy('mcp', mcp)}>{copied === 'mcp' ? t('handoff.copied') : t('handoff.copy')}</button>
          {!token && <button type="button" className="btn" data-testid="handoff-create-token" onClick={() => void createToken()}>{t('handoff.createToken')}</button>}
        </div>
        {token && <p className="muted">{t('handoff.tokenOnce')}</p>}
        {error && <p className="alert error" role="alert">{error}</p>}
        <p>{t('handoff.step2')}</p>
        <pre data-testid="handoff-run-command">{run}</pre>
        <div className="row">
          <button type="button" className="btn" data-testid="handoff-copy-run" onClick={() => void copy('run', run)}>{copied === 'run' ? t('handoff.copied') : t('handoff.copy')}</button>
          <span className="shell-spacer" />
          <button type="button" className="btn" data-testid="handoff-close" onClick={onClose}>{t('handoff.close')}</button>
        </div>
      </div>
    </div>
  );
};
