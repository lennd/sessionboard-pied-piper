import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphStore } from '@rdi/graph';
import { buildRepoGraph, describeDetections, detect, parseRepository, walkRepository, type Detections, type FileFacts, type RepoGraph, type WalkResult } from '@rdi/indexer';
import { materialize, type CloneSource } from '@rdi/providers';
import type pg from 'pg';
import { listLiveRepoIds, loadRepo, saveProgress, type IndexableRepo, type Stage, type StageName } from './repoStore';

type PipelineDeps = { pool: pg.Pool; graph: GraphStore; workDir: string; resolveSource: (repo: IndexableRepo) => Promise<CloneSource> };

const STAGE_NAMES: StageName[] = ['clone', 'parse', 'detect', 'summarize', 'link'];
const TRUNCATED_NOTE = ' (truncated at 500k LOC)';

export const runIndexJob = async (deps: PipelineDeps, repoId: string): Promise<'ready' | 'error' | 'missing'> => {
  const repo = await loadRepo(deps.pool, repoId);
  if (!repo) return 'missing';
  const stages: Stage[] = STAGE_NAMES.map((name) => ({ name, status: 'pending' }));
  const dir = join(deps.workDir, `${repo.id}-${randomUUID()}`);
  const save = (status: 'indexing' | 'ready' | 'error', extra: { languages?: string[]; error?: string | null; lastSyncedAt?: Date } = {}) =>
    saveProgress(deps.pool, repo.id, { status, stages: stages.map((s) => ({ ...s })), ...extra });
  const stage = async <T>(name: StageName, work: () => Promise<T>, detail?: (result: T) => string): Promise<T> => {
    const current = stages.find((s) => s.name === name)!;
    current.status = 'running';
    await save('indexing');
    const result = await work();
    current.status = 'done';
    if (detail) current.detail = detail(result);
    await save('indexing');
    return result;
  };

  try {
    await stage('clone', async () => materialize(await deps.resolveSource(repo), dir));
    const { walk, facts } = await stage('parse', async () => {
      const w: WalkResult = await walkRepository(dir);
      const f: FileFacts[] = await parseRepository(w.files);
      return { walk: w, facts: f };
    }, ({ walk: w }) => `${w.files.length} files · ${w.totalLoc} LOC${w.truncated ? TRUNCATED_NOTE : ''}`);
    const detections = await stage('detect', async (): Promise<Detections> => detect(facts), describeDetections);
    const graph = await stage('summarize', async (): Promise<RepoGraph> => buildRepoGraph({ orgId: repo.orgId, repoId: repo.id, fullName: repo.fullName, walk, facts, detections }), (g) => `${g.nodes.length} pieces`);
    await stage('link', async () => deps.graph.commitRepoGraph(repo.orgId, repo.id, graph, await listLiveRepoIds(deps.pool, repo.orgId)), (links) => `${links} cross-repo links`);
    if (!(await loadRepo(deps.pool, repo.id))) {
      await deps.graph.pruneOrg(repo.orgId, await listLiveRepoIds(deps.pool, repo.orgId));
      return 'missing';
    }
    await save('ready', { languages: walk.languages, error: null, lastSyncedAt: new Date() });
    return 'ready';
  } catch (error) {
    const failed = stages.find((s) => s.status === 'running');
    if (failed) failed.status = 'error';
    const message = error instanceof Error ? error.message : String(error);
    if (failed) failed.detail = message;
    await save('error', { error: message });
    return 'error';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
