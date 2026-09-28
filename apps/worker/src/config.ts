import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GitHubAppConfig } from '@rdi/providers';

export const INDEX_QUEUE = 'index-repo';
export type IndexJobData = { repoId: string; orgId: string; reason: 'added' | 'reindex' | 'push' };

export type WorkerConfig = {
  databaseUrl: string; redisUrl: string; neo4jUrl: string; neo4jUser: string; neo4jPassword: string;
  workDir: string; fixturesDir: string; github: GitHubAppConfig | null; concurrency: number;
};

const DEFAULT_FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
const DEFAULT_CONCURRENCY = 2;

export const loadWorkerConfig = (env: NodeJS.ProcessEnv = process.env): WorkerConfig => {
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://rdi:rdi@localhost:5548/rdi',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6391',
    neo4jUrl: env.NEO4J_URL ?? 'bolt://localhost:7690',
    neo4jUser: env.NEO4J_USER ?? 'neo4j',
    neo4jPassword: env.NEO4J_PASSWORD ?? 'rdi-dev-password',
    workDir: env.WORK_DIR ?? join(tmpdir(), 'rdi-work'),
    fixturesDir: env.FIXTURES_DIR ?? DEFAULT_FIXTURES,
    github: env.GITHUB_APP_ID && privateKey && env.GITHUB_APP_SLUG ? { appId: env.GITHUB_APP_ID, privateKey, slug: env.GITHUB_APP_SLUG } : null,
    concurrency: Number(env.WORKER_CONCURRENCY ?? DEFAULT_CONCURRENCY),
  };
};
