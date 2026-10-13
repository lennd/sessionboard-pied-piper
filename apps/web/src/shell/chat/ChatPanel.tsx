import { validateScene, type Scene } from '@rdi/scene';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import type { ChatContext, ChatMode } from '../../workspace/Workspace';
import { ApiError, apiFetch } from '../api';
import { streamChat, type ChatEvent } from './chatApi';
import { Markdown } from './Markdown';

type Item = { role: 'user' | 'assistant'; text: string; turn: number };
type SceneEntry = { id: string; turn: number; scene: Scene };
type Conversation = { id: string; title: string; items: Item[]; scenes: { id: string; turn: number; scene: unknown }[] };
type Summary = { id: string; title: string; updatedAt: string };
type Agent = { enabled: boolean; model: string; usage: { input: number; output: number; costUsd: number } };

const MODE_STORAGE_KEY = 'rdi.chatMode';
const LANGUAGE_LABEL: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português' };

const validScenes = (rows: Conversation['scenes']): SceneEntry[] =>
  rows.flatMap((row) => {
    const result = validateScene(row.scene);
    return result.ok ? [{ id: row.id, turn: row.turn, scene: result.scene }] : [];
  });

export const ChatPanel = ({ repoId, ctx, language }: { repoId: string; ctx: ChatContext; language: string }) => {
  const { t } = useI18n();
  const client = useQueryClient();
  const agent = useQuery({ queryKey: ['agent', repoId], queryFn: () => apiFetch<Agent>(`/repos/${repoId}/agent`) });
  const conversations = useQuery({ queryKey: ['conversations', repoId], queryFn: () => apiFetch<Summary[]>(`/repos/${repoId}/conversations`) });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  const [solutions, setSolutions] = useState<{ id: string; n: number; title: string; turn: number }[]>([]);
  const [tool, setTool] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [focus, setFocus] = useState<{ label: string; graphRef: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const justCreated = useRef<string | null>(null);
  const handledQuestion = useRef<number | null>(null);
  const [mode, setMode] = useState<ChatMode>(() => (localStorage.getItem(MODE_STORAGE_KEY) === 'plan' ? 'plan' : 'analyze'));
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
    void apiFetch<Conversation>(`/repos/${repoId}/conversations/${conversationId}`).then((c) => {
      if (cancelled) return;
      setItems(c.items);
      setScenes(validScenes(c.scenes));
      setSolutions([]);
    });
    return () => {
      cancelled = true;
    };
  }, [repoId, conversationId]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [items, scenes, tool]);

  const startNew = () => {
    abort.current?.abort();
    setConversationId(null);
    setItems([]);
    setScenes([]);
    setSolutions([]);
    setError(null);
    void client.setQueryData(['conversations', repoId], (list: Summary[] | undefined) => list ?? []);
  };

  const chooseMode = (next: ChatMode) => {
    setMode(next);
    localStorage.setItem(MODE_STORAGE_KEY, next);
  };

  const submit = async (text: string, options: { fresh: boolean; mode: ChatMode }) => {
    if (!text || busy) return;
    autoSelected.current = true;
    setBusy(true);
    setError(null);
    setDraft('');
    try {
      const existing = options.fresh ? null : conversationId;
      const id = existing ?? (await apiFetch<Summary>(`/repos/${repoId}/conversations`, { method: 'POST', body: {} })).id;
      if (!existing) {
        justCreated.current = id;
        setConversationId(id);
      }
      if (options.fresh) {
        setScenes([]);
        setSolutions([]);
      }
      const turn = options.fresh ? 1 : (items.filter((i) => i.role === 'user').at(-1)?.turn ?? 0) + 1;
      setItems((current) => [...(options.fresh ? [] : current), { role: 'user', text, turn }, { role: 'assistant', text: '', turn }]);
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
        } else if (event.type === 'solution') {
          setSolutions((current) => [...current, { id: event.id, n: event.n, title: event.title, turn }]);
        } else if (event.type === 'error') {
          setError(errorText(event.code));
        }
      };
      await streamChat(repoId, id, { text, language, focus, mode: options.mode }, onEvent, controller.signal);
      setFocus(null);
      void client.invalidateQueries({ queryKey: ['conversations', repoId] });
      void client.invalidateQueries({ queryKey: ['agent', repoId] });
    } catch (err) {
      setError(err instanceof ApiError ? errorText(err.code) : t('errors.unknown'));
    } finally {
      setTool(null);
      setBusy(false);
    }
  };

  const send = () => submit(draft.trim(), { fresh: false, mode });

  useEffect(() => {
    const question = ctx.pendingQuestion;
    if (!question || busy || handledQuestion.current === question.id) return;
    handledQuestion.current = question.id;
    ctx.consumeQuestion?.(question.id);
    chooseMode(question.mode);
    void submit(question.text, { fresh: true, mode: question.mode });
    // submit reads the latest state through the render it was created in; the question id guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.pendingQuestion, busy]);

  const translate = async (entry: SceneEntry) => {
    setError(null);
    try {
      const result = await apiFetch<{ id: string; scene: unknown }>(`/repos/${repoId}/scenes/${entry.id}/translate`, { method: 'POST', body: { language } });
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
            <div className={`chat-msg ${item.role}`} data-testid={`chat-message-${i}`}>{item.role === 'assistant' ? <Markdown text={item.text} /> : item.text}</div>
            {item.role === 'assistant' && solutions.filter((s) => s.turn === item.turn).map((s) => (
              <div key={`${s.id}-${s.n}`} className="chat-scene" data-testid={`chat-solution-${s.id}`}>
                <span>☰ {t('chat.solution', { title: s.title, n: s.n })}</span>
                <Link className="btn" data-testid={`chat-solution-open-${s.id}`} to={`/repos/${repoId}/solutions/${s.id}`}>{t('chat.open')}</Link>
              </div>
            ))}
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
        <div className="seg chat-modes" role="group" aria-label={t('chat.mode.label')}>
          {(['analyze', 'plan'] as const).map((m) => (
            <button key={m} type="button" data-testid={`chat-mode-${m}`} aria-pressed={mode === m} onClick={() => chooseMode(m)}>{t(`chat.mode.${m}`)}</button>
          ))}
        </div>
        <textarea
          data-testid="chat-input" aria-label={t('chat.title')} placeholder={t(mode === 'plan' ? 'chat.placeholder.plan' : 'chat.placeholder')} value={draft} disabled={disabled}
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
