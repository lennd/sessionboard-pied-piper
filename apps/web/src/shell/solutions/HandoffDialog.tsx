import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { errorText } from '../errors';
import { startRun } from './runsApi';
import { RunView } from './RunView';

type McpInfo = { url: string; serverName: string };

export const mcpCommand = (info: McpInfo) => `claude mcp add --transport http ${info.serverName} ${info.url}`;
export const runCommand = (serverName: string, solutionId: string) =>
  `claude "Use the ${serverName} MCP server: call get_solution with id ${solutionId}, then implement the plan task by task in this repository. Call report_task_progress with in_progress when you start a task and done (with a short note) when it is finished; call update_solution if the plan must change."`;

export const HandoffDialog = ({ repoId, solutionId, onClose }: { repoId: string; solutionId: string; onClose: () => void }) => {
  const { t } = useI18n();
  const info = useQuery({ queryKey: ['mcp-info', repoId], queryFn: () => apiFetch<McpInfo>(`/repos/${repoId}/mcp-info`) });
  const [copied, setCopied] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
  };
  const run = async () => {
    setStarting(true);
    setError(null);
    try {
      setRunId((await startRun(repoId, solutionId)).id);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setStarting(false);
    }
  };
  if (!info.data) return null;
  const mcp = mcpCommand(info.data);
  const terminal = runCommand(info.data.serverName, solutionId);
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={t('handoff.title')} data-testid="handoff-dialog">
      <div className="dialog glass">
        {runId ? (
          <RunView repoId={repoId} runId={runId} onClose={onClose} />
        ) : (
          <>
            <h2>{t('handoff.title')}</h2>
            <p>{t('handoff.runHint')}</p>
            <div className="row">
              <button type="button" className="btn-primary" data-testid="handoff-run-here" disabled={starting} onClick={() => void run()}>✦ {t('handoff.runHere')}</button>
            </div>
            {error && <p className="alert error" role="alert">{error}</p>}
            <div className="sec-title">{t('handoff.or')}</div>
            <p>{t('handoff.step1')}</p>
            <pre data-testid="handoff-mcp-command">{mcp}</pre>
            <div className="row">
              <button type="button" className="btn" data-testid="handoff-copy-mcp" onClick={() => void copy('mcp', mcp)}>{copied === 'mcp' ? t('handoff.copied') : t('handoff.copy')}</button>
            </div>
            <p className="muted">{t('handoff.local')}</p>
            <p>{t('handoff.step2')}</p>
            <pre data-testid="handoff-run-command">{terminal}</pre>
            <div className="row">
              <button type="button" className="btn" data-testid="handoff-copy-run" onClick={() => void copy('run', terminal)}>{copied === 'run' ? t('handoff.copied') : t('handoff.copy')}</button>
              <span className="shell-spacer" />
              <button type="button" className="btn" data-testid="handoff-close" onClick={onClose}>{t('handoff.close')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
