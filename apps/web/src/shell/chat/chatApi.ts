import { ApiError } from '../api';

export type SseMessage = { event: string; data: string };
export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
  | { type: 'scene'; id: string; scene: unknown }
  | { type: 'solution'; id: string; n: number; title: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; sceneIds: string[]; usage: { input: number; output: number } };
export type AskBody = { text: string; language?: string; focus?: { label: string; graphRef: string } | null; mode?: 'analyze' | 'plan' };

const SEPARATOR = /\r?\n\r?\n/;
const EVENT_TYPES = new Set(['text', 'tool', 'scene', 'solution', 'error', 'done']);

export const parseSse = (buffer: string): { messages: SseMessage[]; rest: string } => {
  const parts = buffer.split(SEPARATOR);
  const rest = parts.pop() ?? '';
  const messages = parts.filter(Boolean).map((part) => {
    const lines = part.split(/\r?\n/);
    const event = lines.find((l) => l.startsWith('event:'))?.slice('event:'.length).trim() ?? 'message';
    const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice('data:'.length).trim()).join('\n');
    return { event, data };
  });
  return { messages, rest };
};

export const streamChat = async (base: string, conversationId: string, body: AskBody, onEvent: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void> => {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
  const response = await fetch(`/api${base}/conversations/${conversationId}/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(response.status, data?.error?.code ?? 'unknown');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { messages, rest } = parseSse(buffer);
    buffer = rest;
    for (const m of messages) {
      if (EVENT_TYPES.has(m.event)) onEvent({ type: m.event, ...(JSON.parse(m.data) as object) } as ChatEvent);
    }
  }
};

export type ExplainEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
  | { type: 'scene'; id: string; scene: unknown }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; id?: string; text?: string };
const EXPLAIN_EVENTS = new Set(['text', 'tool', 'scene', 'error', 'done']);

/** Streams a server-sent explanation (`POST .../impact/explain`), so long runs show progress instead of a silent wait. */
export const streamExplain = async (base: string, body: Record<string, unknown>, onEvent: (event: ExplainEvent) => void, signal?: AbortSignal): Promise<void> => {
  const response = await fetch(`/api${base}/impact/explain`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(response.status, data?.error?.code ?? 'unknown');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { messages, rest } = parseSse(buffer);
    buffer = rest;
    for (const m of messages) {
      if (EXPLAIN_EVENTS.has(m.event)) onEvent({ type: m.event, ...(JSON.parse(m.data) as object) } as ExplainEvent);
    }
  }
};

/** Runs a streamed explanation to completion and returns the scene and summary; tool progress goes to `onProgress`. */
export const explainToScene = async (base: string, body: Record<string, unknown>, onProgress?: (summary: string | null) => void): Promise<{ id: string; scene: unknown; text: string }> => {
  const state: { scene: { id: string; scene: unknown } | null; text: string; failure: string | null } = { scene: null, text: '', failure: null };
  await streamExplain(base, body, (event) => {
    if (event.type === 'tool') onProgress?.(event.status === 'running' ? event.summary : null);
    else if (event.type === 'text') state.text += event.delta;
    else if (event.type === 'scene') state.scene = { id: event.id, scene: event.scene };
    else if (event.type === 'error') state.failure = event.code;
    else if (event.type === 'done' && event.text) state.text = event.text;
  });
  onProgress?.(null);
  if (!state.scene) throw new ApiError(502, state.failure ?? 'explain_failed');
  return { ...state.scene, text: state.text };
};
