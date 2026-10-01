import { diffScenes, type Scene, type SolutionDraft, type SolutionStatus, type TaskStatus } from '@rdi/scene';
import type { MessageKey } from '../../i18n/messages';

export type SolutionSummary = { id: string; title: string; status: SolutionStatus; latestVersion: number; progress: { done: number; total: number }; updatedAt: string };
export type SolutionDetail = {
  id: string; title: string; status: SolutionStatus; conversationId: string | null;
  versions: { n: number; author: 'web' | 'claude-code'; summary: string; createdAt: string }[];
  version: { n: number; author: 'web' | 'claude-code'; createdAt: string; draft: SolutionDraft };
  tasks: Record<string, { status: TaskStatus; note: string | null; updatedAt: string }>;
};
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export const solutionKey = (orgId: string, id: string, n?: number) => ['solution', orgId, id, n ?? 'latest'] as const;

export const solutionScenes = (detail: SolutionDetail, t: Translate): Scene[] => {
  const { n, draft } = detail.version;
  const base = `${detail.id}-v${n}`;
  const scenes: Scene[] = [];
  if (draft.sceneProposed) scenes.push({ ...draft.sceneProposed, id: `${base}-proposed`, title: t('scene.proposed', { n }) });
  if (draft.sceneCurrent) scenes.push({ ...draft.sceneCurrent, id: `${base}-current`, title: t('scene.current', { n }) });
  if (draft.sceneProposed && draft.sceneCurrent) scenes.push({ ...diffScenes(draft.sceneCurrent, draft.sceneProposed), id: `${base}-changes`, title: t('scene.changes', { n }) });
  return scenes;
};

export const subscribeSolution = (orgId: string, id: string, onEvent: () => void): (() => void) => {
  const source = new EventSource(`/api/orgs/${orgId}/solutions/${id}/events`, { withCredentials: true });
  source.addEventListener('solution', onEvent);
  return () => source.close();
};
