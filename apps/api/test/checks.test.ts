import { describe, expect, it } from 'vitest';
import { createPgPool, createRedisClient } from '../src/checks';

describe('infra clients', () => {
  it('pg pool survives idle client errors instead of crashing the process', async () => {
    const pool = createPgPool('postgres://nobody:x@127.0.0.1:1/none');
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    await pool.end();
  });

  it('redis client survives connection errors instead of logging unhandled events', () => {
    const redis = createRedisClient('redis://127.0.0.1:1');
    expect(() => redis.emit('error', new Error('ECONNRESET'))).not.toThrow();
    redis.disconnect();
  });
});
