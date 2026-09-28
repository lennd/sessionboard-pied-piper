import type { Redis } from 'ioredis';

export type RateLimiter = { hit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> };

export const createRateLimiter = (redis: Redis, prefix: string): RateLimiter => ({
  async hit(key, limit, windowSeconds) {
    const full = `${prefix}:${key}`;
    const count = await redis.incr(full);
    if (count === 1) await redis.expire(full, windowSeconds);
    if (count <= limit) return { allowed: true, retryAfter: 0 };
    const ttl = await redis.ttl(full);
    return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSeconds };
  },
});
