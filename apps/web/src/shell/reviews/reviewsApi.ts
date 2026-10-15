import { validateScene, type Scene } from '@rdi/scene';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../api';
import { explainToScene } from '../chat/chatApi';
import { setActivityDetail } from '../../components/activity';
import type { PullSummary } from '../pulls/pullsApi';

export type ReviewTarget = number | 'branch';
export type ReviewSelection = { repoId: string; pull: ReviewTarget };
export type ReviewPart = { repoId: string; name: string; pull: ReviewTarget; available: boolean; url: string | null };
export type ReviewInfo = { id: string; title: string; selections: ReviewSelection[]; parts: ReviewPart[]; explainedAt: string | null; createdAt: string; updatedAt: string };
export type ReviewMatch = { headRef: string; pulls: { repoId: string; number: number; title: string }[] };
export type ReviewSuggestions = { repos: { repoId: string; name: string; pulls: PullSummary[]; branch: { branch: string; base: string; ahead: number } | null }[]; matches: ReviewMatch[] };

export const REVIEWS_KEY = ['reviews'] as const;
export const reviewKey = (id: string) => ['review', id] as const;
export const reviewBase = (id: string) => `/reviews/${id}`;
const STALE_MS = 10_000;
const NOT_FOUND = 404;

export const useReviews = () => useQuery({ queryKey: REVIEWS_KEY, queryFn: () => apiFetch<ReviewInfo[]>('/reviews'), staleTime: STALE_MS });
export const useReview = (id: string) => useQuery({ queryKey: reviewKey(id), queryFn: () => apiFetch<ReviewInfo>(`/reviews/${id}`), enabled: Boolean(id), retry: false, staleTime: STALE_MS });
export const fetchSuggestions = (repoIds: string[]) => apiFetch<ReviewSuggestions>(`/reviews/suggest?repoIds=${encodeURIComponent(repoIds.join(','))}`);

export const useCreateReview = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; selections: ReviewSelection[] }) => apiFetch<ReviewInfo>('/reviews', { method: 'POST', body: input }),
    onSuccess: () => void client.invalidateQueries({ queryKey: REVIEWS_KEY }),
  });
};

export const deleteReview = (id: string) => apiFetch<void>(`/reviews/${id}`, { method: 'DELETE' });

const sceneOrNull = async (path: string): Promise<Scene | null> => {
  try {
    const result = validateScene((await apiFetch<{ scene: unknown }>(path)).scene);
    return result.ok ? result.scene : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === NOT_FOUND) return null;
    throw error;
  }
};

/** The selected pull requests overlaid on the combined map; null until every repository has a map. */
export const fetchReviewImpact = (id: string) => sceneOrNull(`/reviews/${id}/impact`);

export const fetchReviewExplanation = async (id: string): Promise<{ text: string; at: string; scene: Scene } | null> => {
  try {
    const cached = await apiFetch<{ text: string; at: string; scene: unknown }>(`/reviews/${id}/explanation`);
    const valid = validateScene(cached.scene);
    return valid.ok ? { text: cached.text, at: cached.at, scene: valid.scene } : null;
  } catch {
    return null;
  }
};

export const explainReview = async (id: string): Promise<{ scene: Scene; text: string }> => {
  const result = await explainToScene(reviewBase(id), {}, setActivityDetail);
  const valid = validateScene(result.scene);
  if (!valid.ok) throw new Error('invalid_scene');
  return { scene: valid.scene, text: result.text };
};
