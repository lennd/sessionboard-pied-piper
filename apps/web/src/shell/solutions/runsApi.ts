import { apiFetch } from '../api';

export type RunStatus = 'running' | 'done' | 'error' | 'cancelled';
export type RunEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
  | { type: 'scene'; scene: unknown }
  | { type: 'solution'; id: string; n: number; title: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'permission'; id: string; tool: string; input: Record<string, unknown>; description: string | null }
  | { type: 'permission_resolved'; id: string; allow: boolean }
  | { type: 'status'; status: RunStatus; message?: string };
export type RunSummary = { id: string; solutionId: string; status: RunStatus; startedAt: string; endedAt: string | null; pending: string[] };

export const startRun = (repoId: string, solutionId: string) => apiFetch<RunSummary>(`/repos/${repoId}/solutions/${solutionId}/run`, { method: 'POST', body: {} });
export const cancelRun = (repoId: string, runId: string) => apiFetch<void>(`/repos/${repoId}/runs/${runId}/cancel`, { method: 'POST', body: {} });
export const decidePermission = (repoId: string, runId: string, permissionId: string, allow: boolean) =>
  apiFetch<void>(`/repos/${repoId}/runs/${runId}/permissions/${permissionId}`, { method: 'POST', body: { allow } });

export const subscribeRun = (repoId: string, runId: string, onEvent: (event: RunEvent) => void): (() => void) => {
  const source = new EventSource(`/api/repos/${repoId}/runs/${runId}/events`);
  source.addEventListener('run', (e) => onEvent(JSON.parse((e as MessageEvent<string>).data) as RunEvent));
  return () => source.close();
};

/** One line per tool call for the run log; a permission request shows the command it is about. */
export const permissionLabel = (event: Extract<RunEvent, { type: 'permission' }>): string => {
  const detail = [event.input.command, event.input.file_path, event.input.pattern, event.input.url].find((v) => typeof v === 'string') as string | undefined;
  return detail ? `${event.tool}: ${detail}` : event.tool;
};
