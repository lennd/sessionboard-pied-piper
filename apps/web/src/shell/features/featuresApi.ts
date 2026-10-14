import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api';
import type { RunStatus } from '../solutions/runsApi';

export type FeatureStatus = 'draft' | 'planned' | 'in_progress' | 'done' | 'archived';
export type FeatureRepo = { id: string; name: string; path: string | null; available: boolean };
export type FeatureInfo = {
  id: string; title: string; status: FeatureStatus; repoIds: string[]; brief: string; createdAt: string; updatedAt: string;
  repos: FeatureRepo[]; plan: { id: string; status: string; latestVersion: number; progress: { done: number; total: number } } | null;
};
export type FeaturePatch = Partial<Pick<FeatureInfo, 'title' | 'brief' | 'repoIds' | 'status'>>;
export type FeatureRun = { id: string; repoId: string; featureId: string | null; solutionId: string; status: RunStatus; startedAt: string; endedAt: string | null; pending: string[] };

export const FEATURES_KEY = ['features'] as const;
export const featureKey = (id: string) => ['feature', id] as const;
export const featureBase = (id: string) => `/features/${id}`;
const STALE_MS = 10_000;

export const useFeatures = () => useQuery({ queryKey: FEATURES_KEY, queryFn: () => apiFetch<FeatureInfo[]>('/features'), staleTime: STALE_MS });
export const useFeature = (id: string) => useQuery({ queryKey: featureKey(id), queryFn: () => apiFetch<FeatureInfo>(`/features/${id}`), enabled: Boolean(id), retry: false, staleTime: STALE_MS });
export const useFeatureRuns = (id: string, enabled: boolean) => useQuery({ queryKey: ['feature-runs', id], queryFn: () => apiFetch<FeatureRun[]>(`/features/${id}/runs`), enabled, refetchInterval: 3000 });

export const useCreateFeature = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; repoIds: string[]; brief?: string }) => apiFetch<FeatureInfo>('/features', { method: 'POST', body: input }),
    onSuccess: () => void client.invalidateQueries({ queryKey: FEATURES_KEY }),
  });
};

export const useUpdateFeature = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: FeaturePatch) => apiFetch<FeatureInfo>(`/features/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (feature) => {
      client.setQueryData(featureKey(id), feature);
      void client.invalidateQueries({ queryKey: FEATURES_KEY });
    },
  });
};

export const startFeatureRun = (featureId: string, repoId: string) => apiFetch<FeatureRun>(`/features/${featureId}/repos/${repoId}/run`, { method: 'POST', body: {} });
