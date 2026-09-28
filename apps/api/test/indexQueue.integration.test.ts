import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { createIndexQueue, INDEX_QUEUE } from '../src/queue/indexQueue';
import { TEST_REDIS_URL } from './setup/env';

const connection = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
const inspect = new Queue(INDEX_QUEUE, { connection });
const queue = createIndexQueue(TEST_REDIS_URL);

afterAll(async () => {
  await inspect.obliterate({ force: true });
  await inspect.close();
  await queue.close();
  connection.disconnect();
});

describe('createIndexQueue', () => {
  it('keeps at most one pending job per repository', async () => {
    await inspect.obliterate({ force: true });
    await queue.enqueue({ repoId: 'r1', orgId: 'o1', reason: 'added' });
    await queue.enqueue({ repoId: 'r1', orgId: 'o1', reason: 'reindex' });
    await queue.enqueue({ repoId: 'r2', orgId: 'o1', reason: 'added' });
    expect(await inspect.getWaitingCount()).toBe(2);
  });
});
