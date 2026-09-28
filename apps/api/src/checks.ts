import { Redis } from 'ioredis';
import neo4j from 'neo4j-driver';
import pg from 'pg';
import type { Config } from './config';

export type Check = () => Promise<void>;
export type InfraChecks = { checks: Record<string, Check>; close: () => Promise<void> };

const ignoreClientError = () => {};

/**
 * Pool with an `error` listener: idle clients emit `error` when Postgres restarts, and an unhandled
 * `error` event would crash the process instead of letting `/health` report degraded.
 */
export const createPgPool = (connectionString: string): pg.Pool => {
  const pool = new pg.Pool({ connectionString, max: 2 });
  pool.on('error', ignoreClientError);
  return pool;
};

/** Lazy Redis client whose reconnect errors surface through `/health` instead of unhandled events. */
export const createRedisClient = (url: string): Redis => {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', ignoreClientError);
  return redis;
};

export const createInfraChecks = (config: Config): InfraChecks => {
  const pool = createPgPool(config.databaseUrl);
  const driver = neo4j.driver(config.neo4jUrl, neo4j.auth.basic(config.neo4jUser, config.neo4jPassword));
  const redis = createRedisClient(config.redisUrl);

  return {
    checks: {
      postgres: async () => {
        await pool.query('SELECT 1');
      },
      neo4j: async () => {
        await driver.verifyConnectivity();
      },
      redis: async () => {
        if (redis.status === 'wait') await redis.connect();
        await redis.ping();
      },
    },
    close: async () => {
      await Promise.allSettled([pool.end(), driver.close(), redis.quit()]);
    },
  };
};
