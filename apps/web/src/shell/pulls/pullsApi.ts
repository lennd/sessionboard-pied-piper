import { validateScene, type Scene } from '@rdi/scene';
import { apiFetch } from '../api';
import type { FileChange } from '../sessions/sessionsApi';

export type PullSummary = { number: number; title: string; author: string; draft: boolean; headRef: string; baseRef: string; updatedAt: string; url: string; additions: number; deletions: number; changedFiles: number };
export type PullFile = { path: string; additions: number; deletions: number; change: FileChange };
export type PullDetail = { pull: PullSummary & { body: string }; files: PullFile[] };
export type BranchCompare = { branch: string; base: string; ahead: number; touched: { path: string; change: FileChange }[] };
export type PullsList = { available: boolean; reason?: string; pulls: PullSummary[]; branch: BranchCompare | null };
export const BRANCH = 'branch';

export const fetchPulls = (repoId: string, refresh = false) => apiFetch<PullsList>(`/repos/${repoId}/pulls${refresh ? '?refresh=1' : ''}`);
export const fetchPull = (repoId: string, number: number) => apiFetch<PullDetail>(`/repos/${repoId}/pulls/${number}`);

const scene = async (path: string): Promise<Scene> => {
  const result = validateScene(await apiFetch<unknown>(path));
  if (!result.ok) throw new Error('invalid_scene');
  return result.scene;
};
export const fetchPullImpact = (repoId: string, target: number | typeof BRANCH) => scene(target === BRANCH ? `/repos/${repoId}/branch/impact` : `/repos/${repoId}/pulls/${target}/impact`);

export const explainPull = async (repoId: string, target: number | typeof BRANCH): Promise<{ scene: Scene; text: string }> => {
  const result = await apiFetch<{ scene: unknown; text: string }>(`/repos/${repoId}/impact/explain`, { method: 'POST', body: { pull: target } });
  const valid = validateScene(result.scene);
  if (!valid.ok) throw new Error('invalid_scene');
  return { scene: valid.scene, text: result.text };
};
