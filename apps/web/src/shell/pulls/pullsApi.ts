import { validateScene, type Scene } from '@rdi/scene';
import { setActivityDetail } from '../../components/activity';
import { apiFetch } from '../api';
import { explainToScene } from '../chat/chatApi';
import type { FileChange } from '../sessions/sessionsApi';

export type ReviewState = { decision: 'approved' | 'changes_requested' | 'pending'; approvedByMe: boolean; approvals: number; changesRequested: number };
export type TriageState = 'reviewed' | 'dismissed';
export type Triage = { state: TriageState; at: string; note: string | null } | null;
export type PullSummary = { number: number; title: string; author: string; draft: boolean; headRef: string; baseRef: string; updatedAt: string; url: string; additions: number; deletions: number; changedFiles: number; review: ReviewState; triage?: Triage };
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
  const result = await explainToScene(`/repos/${repoId}`, { pull: target }, setActivityDetail);
  const valid = validateScene(result.scene);
  if (!valid.ok) throw new Error('invalid_scene');
  return { scene: valid.scene, text: result.text };
};

export type RiskAnchor = { id: string; title: string; severity: string; category: string; pieces: string[]; anchor: { path: string; line: number } | null };
export type ReviewPosted = { id: number; url: string; inline: number; summary: number };

export const previewRisks = (repoId: string, number: number, scene: Scene) => apiFetch<{ risks: RiskAnchor[] }>(`/repos/${repoId}/pulls/${number}/risks`, { method: 'POST', body: { scene } });
export const postReview = (repoId: string, number: number, scene: Scene, riskIds: string[]) => apiFetch<ReviewPosted>(`/repos/${repoId}/pulls/${number}/review`, { method: 'POST', body: { scene, riskIds } });

export type Decision = { id: number; url: string; decision: 'approve' | 'request_changes' };
export const decidePull = (repoId: string, number: number, decision: 'approve' | 'request_changes', note: string) =>
  apiFetch<Decision>(`/repos/${repoId}/pulls/${number}/decision`, { method: 'POST', body: { decision, ...(note.trim() ? { note: note.trim() } : {}) } });

export const setTriage = (repoId: string, number: number, state: TriageState) => apiFetch<{ number: number; triage: Triage }>(`/repos/${repoId}/pulls/${number}/triage`, { method: 'PUT', body: { state } });
export const clearTriage = (repoId: string, number: number) => apiFetch<void>(`/repos/${repoId}/pulls/${number}/triage`, { method: 'DELETE' });
