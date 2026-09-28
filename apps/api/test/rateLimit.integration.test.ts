import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/auth/rateLimit';
import { createRedisClient } from '../src/checks';
import { TEST_REDIS_URL } from './setup/env';

const redis = createRedisClient(TEST_REDIS_URL);
const limiter = createRateLimiter(redis, 'rltest-unit');

beforeEach(async () => {
  const keys = await redis.keys('rltest-unit:*');
  if (keys.length) await redis.del(...keys);
});
afterAll(() => redis.disconnect());

describe('createRateLimiter', () => {
  it('allows up to the limit then blocks with a retry-after', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit('login:ip:1.2.3.4', 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfter).toBeGreaterThan(0);
    expect(results[3]!.retryAfter).toBeLessThanOrEqual(60);
  });

  it('keeps keys independent', async () => {
    await limiter.hit('a', 1, 60);
    expect((await limiter.hit('b', 1, 60)).allowed).toBe(true);
  });
});
