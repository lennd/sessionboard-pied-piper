import { validateScene, type Scene } from '@rdi/scene';
import { apiFetch } from '../api';

export type EventStatus = 'pending' | 'ok' | 'error';
export type FileChange = 'added' | 'modified' | 'removed';
type Base = { id: string; ts: string; sidechain: boolean };
export type TimelineEvent =
  | (Base & { kind: 'prompt'; text: string })
  | (Base & { kind: 'text'; text: string })
  | (Base & { kind: 'edit' | 'write'; file: string; path: string | null; change: FileChange; oldText: string; newText: string; status: EventStatus })
  | (Base & { kind: 'bash'; command: string; description: string | null; git: string | null; status: EventStatus })
  | (Base & { kind: 'read'; tool: string; target: string; status: EventStatus })
  | (Base & { kind: 'subagent'; description: string; status: EventStatus })
  | (Base & { kind: 'tool'; tool: string; summary: string; status: EventStatus });
export type TouchedFile = { path: string; change: FileChange };
export type SessionSummary = { id: string; title: string | null; slug: string | null; startedAt: string | null; updatedAt: string; version: string | null };
export type SessionDetail = { session: SessionSummary; events: TimelineEvent[]; touched: TouchedFile[] };

export const WORKTREE = 'worktree';

export const fetchSessions = (repoId: string) => apiFetch<SessionSummary[]>(`/repos/${repoId}/sessions`);
export const fetchSession = (repoId: string, id: string) => apiFetch<SessionDetail>(`/repos/${repoId}/sessions/${id}`);
export const fetchChanges = (repoId: string) => apiFetch<{ touched: TouchedFile[] }>(`/repos/${repoId}/changes`);

const scene = async (path: string): Promise<Scene> => {
  const result = validateScene(await apiFetch<unknown>(path));
  if (!result.ok) throw new Error('invalid_scene');
  return result.scene;
};
export const fetchImpact = (repoId: string, id: string): Promise<Scene> => scene(id === WORKTREE ? `/repos/${repoId}/changes/impact` : `/repos/${repoId}/sessions/${id}/impact`);

export const explainChange = async (repoId: string, id: string): Promise<{ scene: Scene; text: string }> => {
  const result = await apiFetch<{ scene: unknown; text: string }>(`/repos/${repoId}/impact/explain`, { method: 'POST', body: id === WORKTREE ? {} : { sessionId: id } });
  const valid = validateScene(result.scene);
  if (!valid.ok) throw new Error('invalid_scene');
  return { scene: valid.scene, text: result.text };
};

/** Follows a session transcript; `onSnapshot` fires once, then `onEvent` for every new or updated event. */
export const subscribeSession = (repoId: string, id: string, handlers: { onSnapshot(detail: SessionDetail): void; onEvent(event: TimelineEvent): void; onTouched(touched: TouchedFile[]): void }): (() => void) => {
  const source = new EventSource(`/api/repos/${repoId}/sessions/${id}/events`);
  source.addEventListener('snapshot', (e) => handlers.onSnapshot(JSON.parse((e as MessageEvent<string>).data) as SessionDetail));
  source.addEventListener('event', (e) => handlers.onEvent(JSON.parse((e as MessageEvent<string>).data) as TimelineEvent));
  source.addEventListener('touched', (e) => handlers.onTouched(JSON.parse((e as MessageEvent<string>).data) as TouchedFile[]));
  return () => source.close();
};

export const upsertEvent = (events: TimelineEvent[], event: TimelineEvent): TimelineEvent[] => {
  const index = events.findIndex((e) => e.id === event.id);
  return index === -1 ? [...events, event] : events.map((e, i) => (i === index ? event : e));
};
