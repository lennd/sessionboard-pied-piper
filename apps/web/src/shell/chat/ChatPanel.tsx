import { validateScene, type Scene } from '@rdi/scene';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import type { ChatContext } from '../../workspace/Workspace';
import { ApiError, apiFetch } from '../api';
import { streamChat, type ChatEvent } from './chatApi';

type Item = { role: 'user' | 'assistant'; text: string; turn: number };
type SceneEntry = { id: string; turn: number; scene: Scene };
type Conversation = { id: string; title: string; items: Item[]; scenes: { id: string; turn: number; scene: unknown }[] };
type Summary = { id: string; title: string; updatedAt: string };
type Agent = { enabled: boolean; model: string; tokensUsed: number; tokenBudget: number };

const LANGUAGE_LABEL: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português' };

const validScenes = (rows: Conversation['scenes']): SceneEntry[] =>
  rows.flatMap((row) => {
    const result = validateScene(row.scene);
    return result.ok ? [{ id: row.id, turn: row.turn, scene: result.scene }] : [];
  });

export const ChatPanel = ({ orgId, ctx, language }: { orgId: string; ctx: ChatContext; language: string }) => {
  const { t } = useI18n();
  const client = useQueryClient();
  const agent = useQuery({ queryKey: ['agent', orgId], queryFn: () => apiFetch<Agent>(`/orgs/${orgId}/agent`) });
  const conversations = useQuery({ queryKey: ['conversations', orgId], queryFn: () => apiFetch<Summary[]>(`/orgs/${orgId}/conversations`) });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  const [tool, setTool] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [focus, setFocus] = useState<{ label: string; graphRef: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const justCreated = useRef<string | null>(null);
  const autoSelected = useRef(false);
  const logEnd = useRef<HTMLDivElement | null>(null);

  const errorText = (code: string) => t((`errors.${code}` as MessageKey)) ?? t('errors.unknown');

  useEffect(() => {
    if (autoSelected.current || !conversations.data) return;
    autoSelected.current = true;
    if (conversations.data[0]) setConversationId(conversations.data[0].id);
  }, [conversations.data]);

  useEffect(() => {
    if (!conversationId || conversationId === justCreated.current) return;
    justCreated.current = null;
    let cancelled = false;
    void apiFetch<Conversation>(`/orgs/${orgId}/conversations/${conversationId}`).then((c) => {
      if (cancelled) return;
      setItems(c.items);
      setScenes(validScenes(c.scenes));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, conversationId]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [items, scenes, tool]);

  const startNew = () => {
    abort.current?.abort();
    setConversationId(null);
    setItems([]);
    setScenes([]);
    setError(null);
    void client.setQueryData(['conversations', orgId], (list: Summary[] | undefined) => list ?? []);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    try {
      const id = conversationId ?? (await apiFetch<Summary>(`/orgs/${orgId}/conversations`, { method: 'POST', body: {} })).id;
      if (!conversationId) {
        justCreated.current = id;
        setConversationId(id);
      }
      const turn = (items.filter((i) => i.role === 'user').at(-1)?.turn ?? 0) + 1;
      setItems((current) => [...current, { role: 'user', text, turn }, { role: 'assistant', text: '', turn }]);
      const controller = new AbortController();
      abort.current = controller;
      const onEvent = (event: ChatEvent) => {
        if (event.type === 'text') {
          setItems((current) => current.map((item, i) => (i === current.length - 1 ? { ...item, text: item.text + event.delta } : item)));
        } else if (event.type === 'tool') {
          setTool(event.status === 'running' ? event.summary : null);
        } else if (event.type === 'scene') {
          const result = validateScene(event.scene);
          if (!result.ok) return;
          setScenes((current) => [...current, { id: event.id, turn, scene: result.scene }]);
          ctx.openScene(result.scene);
        } else if (event.type === 'error') {
          setError(errorText(event.code));
        }
      };
      await streamChat(orgId, id, { text, language, focus }, onEvent, controller.signal);
      setFocus(null);
      void client.invalidateQueries({ queryKey: ['conversations', orgId] });
      void client.invalidateQueries({ queryKey: ['agent', orgId] });
    } catch (err) {
      setError(err instanceof ApiError ? errorText(err.code) : t('errors.unknown'));
    } finally {
      setTool(null);
      setBusy(false);
    }
  };

  const translate = async (entry: SceneEntry) => {
    setError(null);
    try {
      const result = await apiFetch<{ id: string; scene: unknown }>(`/orgs/${orgId}/scenes/${entry.id}/translate`, { method: 'POST', body: { language } });
      const valid = validateScene(result.scene);
      if (!valid.ok) return;
      setScenes((current) => [...current, { id: result.id, turn: entry.turn, scene: valid.scene }]);
      ctx.openScene(valid.scene);
    } catch (err) {
      setError(err instanceof ApiError ? errorText(err.code) : t('errors.unknown'));
    }
  };

  const disabled = agent.data ? !agent.data.enabled : true;
  const visibleItems = items.filter((item) => item.role === 'user' || item.text);

  return (
    <div className="chat" data-testid="chat-panel">
      <div className="chat-head">
        <select aria-label={t('chat.conversations')} data-testid="chat-conversations" value={conversationId ?? ''} disabled={busy} onChange={(e) => (e.target.value ? setConversationId(e.target.value) : startNew())}>
          <option value="">{t('chat.new')}</option>
          {(conversations.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button type="button" className="btn" data-testid="chat-new" disabled={busy} onClick={startNew}>+</button>
      </div>
      {agent.data && disabled && <p className="chat-notice" data-testid="chat-disabled">{t('chat.disabled')}</p>}
      <div className="chat-log">
        {visibleItems.length === 0 && <p className="muted">{t('chat.empty')}</p>}
        {visibleItems.map((item, i) => (
          <div key={i}>
            <div className={`chat-msg ${item.role}`} data-testid={`chat-message-${i}`}>{item.text}</div>
            {item.role === 'assistant' && scenes.filter((s) => s.turn === item.turn).map((entry) => (
              <div key={entry.id} className="chat-scene" data-testid={`chat-scene-${entry.id}`}>
                <span>◆ {t('chat.scene', { title: entry.scene.title })}</span>
                <button type="button" className="btn" data-testid={`chat-open-${entry.id}`} onClick={() => ctx.openScene(entry.scene)}>{t('chat.open')}</button>
                {entry.scene.language !== language && (
                  <button type="button" className="btn" data-testid={`chat-translate-${entry.id}`} disabled={disabled} onClick={() => void translate(entry)}>
                    {t('chat.translate', { language: LANGUAGE_LABEL[language] ?? language })}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        {busy && <div className="chat-tool" data-testid="chat-tool">{tool ?? t('chat.thinking')}</div>}
        {error && <p className="alert error" role="alert" data-testid="chat-error">{error}</p>}
        <div ref={logEnd} />
      </div>
      <div className="chat-input">
        {ctx.selected && !focus && (
          <button type="button" className="btn chat-chip" data-testid="chat-ask-about" onClick={() => setFocus(ctx.selected)}>＋ {t('chat.askAbout', { label: ctx.selected.label })}</button>
        )}
        {focus && <span className="tag chat-chip" data-testid="chat-focus">◎ {focus.label} <button type="button" className="btn" onClick={() => setFocus(null)}>×</button></span>}
        <textarea
          data-testid="chat-input" aria-label={t('chat.title')} placeholder={t('chat.placeholder')} value={draft} disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="btn-primary btn-small" data-testid="chat-send" disabled={disabled || busy || !draft.trim()} onClick={() => void send()}>{t('chat.send')}</button>
      </div>
    </div>
  );
};
