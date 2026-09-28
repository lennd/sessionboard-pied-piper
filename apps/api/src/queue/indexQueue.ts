import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const INDEX_QUEUE = 'index-repo';
export type IndexJobData = { repoId: string; orgId: string; reason: 'added' | 'reindex' | 'push' };
export type IndexQueue = { enqueue(job: IndexJobData): Promise<void>; close(): Promise<void> };

export const createIndexQueue = (redisUrl: string): IndexQueue => {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<IndexJobData>(INDEX_QUEUE, { connection });
  return {
    async enqueue(job) {
      await queue.add(job.reason, job, { jobId: job.repoId, removeOnComplete: true, removeOnFail: true });
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
};
