import type { TaskStatus } from '@rdi/scene';
import type { Redis } from 'ioredis';
import type { Author } from '../db/queries/solutions';

export type SolutionEvent = { type: 'version'; n: number; author: Author } | { type: 'task'; taskId: string; status: TaskStatus } | { type: 'meta' };

export const solutionChannel = (id: string) => `rdi:solution:${id}`;

export const publishSolutionEvent = async (redis: Redis, id: string, event: SolutionEvent): Promise<void> => {
  await redis.publish(solutionChannel(id), JSON.stringify(event));
};

type Listener = (message: string) => void;
export type SolutionHub = { listen(id: string, listener: Listener): Promise<() => void>; close(): Promise<void> };

/** One Redis subscriber per API process, fanned out to every open solution stream. */
export const createSolutionHub = (redis: Redis): SolutionHub => {
  let subscriber: Redis | null = null;
  const listeners = new Map<string, Set<Listener>>();
  const connection = () => {
    if (subscriber) return subscriber;
    subscriber = redis.duplicate();
    subscriber.on('error', () => {});
    subscriber.on('message', (channel: string, message: string) => {
      for (const listener of listeners.get(channel) ?? []) listener(message);
    });
    return subscriber;
  };
  return {
    async listen(id, listener) {
      const channel = solutionChannel(id);
      const existing = listeners.get(channel);
      if (existing) {
        existing.add(listener);
      } else {
        listeners.set(channel, new Set([listener]));
        await connection().subscribe(channel);
      }
      return () => {
        const set = listeners.get(channel);
        if (!set) return;
        set.delete(listener);
        if (set.size > 0) return;
        listeners.delete(channel);
        void subscriber?.unsubscribe(channel).catch(() => {});
      };
    },
    async close() {
      listeners.clear();
      subscriber?.disconnect();
      subscriber = null;
    },
  };
};
