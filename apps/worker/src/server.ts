import { createGraphStore } from '@rdi/graph';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { INDEX_QUEUE, loadWorkerConfig, type IndexJobData } from './config';
import { createGithubLoader } from './github';
import { runIndexJob } from './pipeline';
import { createSourceResolver } from './sources';

const POOL_SIZE = 5;
const config = loadWorkerConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: POOL_SIZE });
pool.on('error', () => {});
const graph = createGraphStore(config.neo4jUrl, config.neo4jUser, config.neo4jPassword);
await graph.ensureSchema();
const resolveSource = createSourceResolver({ fixturesDir: config.fixturesDir, github: createGithubLoader({ pool, envConfig: config.github, production: process.env.NODE_ENV === 'production' }) });
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<IndexJobData>(
  INDEX_QUEUE,
  async (job) => {
    const result = await runIndexJob({ pool, graph, workDir: config.workDir, resolveSource }, job.data.repoId);
    console.log(`[worker] ${job.data.reason} ${job.data.repoId} → ${result}`);
    return result;
  },
  { connection, concurrency: config.concurrency },
);

const shutdown = async () => {
  await worker.close();
  await graph.close();
  await pool.end();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log(`worker listening on queue ${INDEX_QUEUE}`);
