import type { TaskStatus } from '@rdi/scene';
import type { Redis } from 'ioredis';
import type { Author } from '../db/queries/solutions';

export type SolutionEvent = { type: 'version'; n: number; author: Author } | { type: 'task'; taskId: string; status: TaskStatus } | { type: 'meta' };

export const solutionChannel = (id: string) => `rdi:solution:${id}`;

export const publishSolutionEvent = async (redis: Redis, id: string, event: SolutionEvent): Promise<void> => {
  await redis.publish(solutionChannel(id), JSON.stringify(event));
};
