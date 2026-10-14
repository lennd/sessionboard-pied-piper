import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { beginActivity, setActivityDetail } from '../../components/activity';
import { Markdown } from '../chat/Markdown';
import { errorText } from '../errors';
import { cancelRun, decidePermission, permissionLabel, subscribeRun, type RunEvent, type RunStatus } from './runsApi';

type Line = { id: string; kind: 'text' | 'tool' | 'error' | 'permission'; text: string; status?: string };
type Pending = Extract<RunEvent, { type: 'permission' }>;

const toolLine = (event: Extract<RunEvent, { type: 'tool' }>): Line => ({ id: `tool-${event.name}-${event.summary}`, kind: 'tool', text: event.summary, status: event.status });

export const RunView = ({ repoId, runId, onClose }: { repoId: string; runId: string; onClose: () => void }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<RunStatus>('running');
  const [message, setMessage] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'running') return;
    const end = beginActivity(t('busy.run'));
    return end;
  }, [status, t]);
  useEffect(
    () =>
      subscribeRun(repoId, runId, (event) => {
        if (event.type === 'status') {
          setStatus(event.status);
          setMessage(event.message ?? null);
        } else if (event.type === 'text') {
          setLines((current) => {
            const last = current.at(-1);
            return last?.kind === 'text' ? [...current.slice(0, -1), { ...last, text: last.text + event.delta }] : [...current, { id: `text-${current.length}`, kind: 'text', text: event.delta }];
          });
        } else if (event.type === 'tool') {
          if (event.status === 'running') setActivityDetail(event.summary);
          if (event.status === 'running') setLines((current) => [...current, toolLine(event)]);
          else setLines((current) => current.map((l) => (l.kind === 'tool' && l.status === 'running' && (l.text === event.summary || l.text.startsWith(event.name)) ? { ...l, status: event.status } : l)));
        } else if (event.type === 'error') {
          setLines((current) => [...current, { id: `error-${current.length}`, kind: 'error', text: event.message }]);
        } else if (event.type === 'permission') {
          setPending((current) => [...current, event]);
        } else if (event.type === 'permission_resolved') {
          setPending((current) => current.filter((p) => p.id !== event.id));
          setLines((current) => [...current, { id: `perm-${event.id}`, kind: 'permission', text: event.allow ? t('run.allow') : t('run.deny') }]);
        }
      }),
    [repoId, runId, t],
  );

  const decide = async (permission: Pending, allow: boolean) => {
    setError(null);
    try {
      await decidePermission(repoId, runId, permission.id, allow);
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const stop = async () => {
    setError(null);
    try {
      await cancelRun(repoId, runId);
    } catch (err) {
      setError(errorText(t, err));
    }
  };

  return (
    <div data-testid="run-view">
      <div className="row">
        <h2 style={{ margin: 0 }}>{t('run.title')}</h2>
        <span className={`tag status-${status === 'done' ? 'done' : status === 'running' ? 'in_progress' : 'draft'}`} data-testid="run-status">{t(`run.status.${status}`)}</span>
        <span className="shell-spacer" />
        {status === 'running' && <button type="button" className="btn btn-small" data-testid="run-stop" onClick={() => void stop()}>{t('run.stop')}</button>}
      </div>
      {message && status !== 'running' && <p className="muted" data-testid="run-message">{message}</p>}
      <div className="pull-body" data-testid="run-log" style={{ maxHeight: 320, overflow: 'auto' }}>
        {lines.map((line) =>
          line.kind === 'text' ? <Markdown key={line.id} text={line.text} /> : <div key={line.id} className={`chat-tool is-${line.status ?? line.kind}`}>{line.kind === 'tool' ? '⚙ ' : line.kind === 'error' ? '✖ ' : '✓ '}{line.text}</div>,
        )}
        {status === 'running' && pending.length === 0 && <div className="chat-tool">{t('run.working')}</div>}
      </div>
      {pending.map((permission) => (
        <div key={permission.id} className="chat-notice" data-testid={`run-permission-${permission.id}`}>
          <b>{t('run.permission', { tool: permission.tool })}</b>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{permissionLabel(permission)}</pre>
          {permission.description && <p className="muted">{permission.description}</p>}
          <div className="row">
            <button type="button" className="btn-primary btn-small" data-testid={`run-allow-${permission.id}`} onClick={() => void decide(permission, true)}>{t('run.allow')}</button>
            <button type="button" className="btn btn-small" data-testid={`run-deny-${permission.id}`} onClick={() => void decide(permission, false)}>{t('run.deny')}</button>
          </div>
        </div>
      ))}
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="row">
        <span className="shell-spacer" />
        <button type="button" className="btn" data-testid="run-close" onClick={onClose}>{t('run.close')}</button>
      </div>
    </div>
  );
};
