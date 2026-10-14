import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { ChatContext } from '../../workspace/Workspace';
import { PayloadDiff } from '../../workspace/panels/PayloadDiff';
import { beginActivity } from '../../components/activity';
import { ApiError } from '../api';
import { Markdown } from '../chat/Markdown';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { explainChange, fetchChanges, fetchImpact, fetchSessions, subscribeSession, upsertEvent, WORKTREE, type TimelineEvent, type TouchedFile } from './sessionsApi';

const GLYPH: Record<TimelineEvent['kind'], string> = { prompt: '›', text: '…', edit: '~', write: '+', bash: '$', read: '⌕', subagent: '⇶', tool: '•' };
const MAX_LABEL = 72;
const SESSIONS_STALE_MS = 5_000;
const NOT_FOUND = 404;

const clip = (text: string) => (text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 1)}…`);
const basename = (path: string) => path.split('/').pop() ?? path;

const labelOf = (event: TimelineEvent, t: (key: 'sessions.outside') => string): string => {
  switch (event.kind) {
    case 'prompt':
    case 'text':
      return clip(event.text.split('\n')[0] ?? '');
    case 'edit':
    case 'write':
      return event.path ?? `${basename(event.file)} (${t('sessions.outside')})`;
    case 'bash':
      return clip(event.description ?? event.command);
    case 'read':
      return `${event.tool} ${clip(event.target)}`;
    case 'subagent':
      return clip(event.description);
    default:
      return `${event.tool} ${clip(event.summary)}`.trim();
  }
};

export const SessionsPanel = ({ repoId, ctx }: { repoId: string; ctx: ChatContext }) => {
  const { t, language } = useI18n();
  const sessions = useQuery({ queryKey: ['sessions', repoId], queryFn: () => fetchSessions(repoId), staleTime: SESSIONS_STALE_MS });
  const changes = useQuery({ queryKey: ['changes', repoId], queryFn: () => fetchChanges(repoId), staleTime: SESSIONS_STALE_MS });
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [touched, setTouched] = useState<TouchedFile[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [noMap, setNoMap] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showImpact = async (id: string) => {
    setNoMap(false);
    try {
      ctx.openScene(await fetchImpact(repoId, id), 'changes');
    } catch (err) {
      if (err instanceof ApiError && err.status === NOT_FOUND) setNoMap(true);
      else setError(errorText(t, err));
    }
  };

  useEffect(() => {
    if (!selected || selected === WORKTREE) return;
    const stop = subscribeSession(repoId, selected, {
      onSnapshot: (detail) => {
        setEvents(detail.events);
        setTouched(detail.touched);
        setLive(true);
      },
      onEvent: (event) => setEvents((current) => upsertEvent(current, event)),
      onTouched: (next) => setTouched(next),
    });
    return () => {
      stop();
      setLive(false);
    };
  }, [repoId, selected]);

  const select = (id: string) => {
    setSelected(id);
    setEvents([]);
    setTouched([]);
    setOpen(null);
    setExplanation(null);
    setError(null);
    void showImpact(id);
  };

  const explain = async () => {
    if (!selected) return;
    setExplaining(true);
    setError(null);
    const end = beginActivity(t('busy.explain'));
    try {
      const result = await explainChange(repoId, selected);
      ctx.openScene(result.scene, 'changes');
      setExplanation(result.text);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      end();
      setExplaining(false);
    }
  };

  if (selected) {
    const title = selected === WORKTREE ? t('sessions.worktree') : (sessions.data?.find((s) => s.id === selected)?.title ?? t('sessions.untitled'));
    const shownTouched = selected === WORKTREE ? (changes.data?.touched ?? []) : touched;
    const visible = events.filter((e) => e.kind !== 'text');
    return (
      <div className="pulls" data-testid="session-detail">
        <button type="button" className="btn pulls-back" data-testid="session-back" onClick={() => setSelected(null)}>← {t('sessions.back')}</button>
        <div className="pull-title"><b>{title}</b> {live && <span className="tag pull-draft" data-testid="session-live">{t('sessions.live')}</span>}</div>
        <div className="muted" data-testid="session-touched">{t('sessions.files', { count: shownTouched.length })}</div>
        <div className="row pulls-actions">
          <button type="button" className="btn-primary btn-small" data-testid="session-explain" disabled={explaining} onClick={() => void explain()}>✦ {explaining ? t('sessions.explaining') : t('sessions.explain')}</button>
          <button type="button" className="btn btn-small" data-testid="session-impact" onClick={() => void showImpact(selected)}>{t('sessions.impact')}</button>
        </div>
        {noMap && <p className="chat-notice" data-testid="session-no-map">{t('sessions.noMap')}</p>}
        {error && <p className="alert error" role="alert">{error}</p>}
        {explanation && <div className="pull-body" data-testid="session-explanation"><Markdown text={explanation} /></div>}
        {selected === WORKTREE && changes.data && shownTouched.length === 0 && <p className="muted" data-testid="session-clean">{t('sessions.noChanges')}</p>}
        {selected === WORKTREE && shownTouched.length > 0 && (
          <ul className="pull-files">
            {shownTouched.map((f) => (
              <li key={f.path} className={`pull-file is-${f.change}`} data-testid={`touched-${f.path}`}><span className="pull-file-status">{f.change}</span><span className="pull-file-name">{f.path}</span></li>
            ))}
          </ul>
        )}
        {selected !== WORKTREE && (
          <ul className="pull-files" data-testid="session-events">
            {visible.map((event) => {
              const diffable = event.kind === 'edit' || event.kind === 'write';
              return (
                <li key={event.id} className={`pull-file is-${'status' in event ? event.status : 'ok'}${event.kind === 'prompt' ? ' pull-item-title' : ''}`} data-testid={`event-${event.id}`}>
                  <button type="button" className="pull-item" data-testid={`event-open-${event.id}`} disabled={!diffable} onClick={() => setOpen(open === event.id ? null : event.id)}>
                    <span className="pull-file-status" title={event.kind}>{GLYPH[event.kind]}{event.sidechain ? '⇶' : ''}</span>
                    <span className="pull-file-name">{labelOf(event, t)}</span>
                    {'status' in event && event.status !== 'ok' && <span className={`tag status-${event.status}`}>{event.status}</span>}
                  </button>
                  {open === event.id && diffable && <PayloadDiff payload={{ format: 'text', before: event.oldText, after: event.newText }} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="pulls" data-testid="sessions-panel">
      <div className="pulls-head"><b>{t('sessions.title')}</b></div>
      <button type="button" className="pull-item" data-testid="session-worktree" onClick={() => select(WORKTREE)}>
        <span className="pull-item-title">⎇ {t('sessions.worktree')}</span>
        <span className="muted">{changes.data ? t('sessions.files', { count: changes.data.touched.length }) : t('sessions.worktreeHint')}</span>
      </button>
      <div className="sec-title">{t('sessions.title')}</div>
      {sessions.isLoading && <p className="muted">{t('sessions.loading')}</p>}
      {sessions.data && sessions.data.length === 0 && <p className="muted" data-testid="sessions-empty">{t('sessions.empty')}</p>}
      {sessions.data?.map((s) => (
        <button key={s.id} type="button" className="pull-item" data-testid={`session-${s.id}`} onClick={() => select(s.id)}>
          <span className="pull-item-title">{s.title ?? t('sessions.untitled')}</span>
          <span className="muted">{formatRelative(s.updatedAt, language)}{s.slug ? ` · ${s.slug}` : ''}</span>
        </button>
      ))}
      {error && <p className="alert error" role="alert">{error}</p>}
    </div>
  );
};
