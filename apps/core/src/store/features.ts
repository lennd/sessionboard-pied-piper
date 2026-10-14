import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { readJson, withLock, writeJson } from './json';

export const FEATURE_STATUSES = ['draft', 'planned', 'in_progress', 'done', 'archived'] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];
export type FeatureFile = { id: string; title: string; status: FeatureStatus; repoIds: string[]; brief: string; createdAt: string; updatedAt: string };

const DIR = 'features';
const FILE = 'feature.json';

export const featureDir = (home: string, id: string): string => join(home, DIR, id);
const file = (home: string, id: string) => join(featureDir(home, id), FILE);

export const createFeature = async (home: string, now: Date, input: { title: string; repoIds: string[]; brief?: string }): Promise<FeatureFile> => {
  const stamp = now.toISOString();
  const feature: FeatureFile = { id: randomUUID(), title: input.title, status: 'draft', repoIds: [...new Set(input.repoIds)], brief: input.brief ?? '', createdAt: stamp, updatedAt: stamp };
  await writeJson(file(home, feature.id), feature);
  return feature;
};

export const listFeatures = async (home: string): Promise<FeatureFile[]> => {
  let ids: string[] = [];
  try {
    ids = (await readdir(join(home, DIR), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const features = await Promise.all(ids.map((id) => readJson<FeatureFile | null>(file(home, id), null)));
  return features.filter((f): f is FeatureFile => f !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const findFeature = (home: string, id: string): Promise<FeatureFile | null> => readJson<FeatureFile | null>(file(home, id), null);

export const updateFeature = (home: string, id: string, now: Date, patch: Partial<Pick<FeatureFile, 'title' | 'brief' | 'repoIds' | 'status'>>): Promise<FeatureFile | null> =>
  withLock(file(home, id), async () => {
    const current = await findFeature(home, id);
    if (!current) return null;
    const next: FeatureFile = { ...current, ...patch, repoIds: patch.repoIds ? [...new Set(patch.repoIds)] : current.repoIds, updatedAt: now.toISOString() };
    await writeJson(file(home, id), next);
    return next;
  });

export const removeFeature = async (home: string, id: string): Promise<boolean> => {
  if (!(await findFeature(home, id))) return false;
  await rm(featureDir(home, id), { recursive: true, force: true });
  return true;
};
