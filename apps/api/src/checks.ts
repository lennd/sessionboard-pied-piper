import { Redis } from 'ioredis';
import neo4j from 'neo4j-driver';
import pg from 'pg';
import type { Config } from './config';

export type Check = () => Promise<void>;
export type InfraChecks = { checks: Record<string, Check>; close: () => Promise<void> };

export const createInfraChecks = (config: Config): InfraChecks => {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  const driver = neo4j.driver(config.neo4jUrl, neo4j.auth.basic(config.neo4jUser, config.neo4jPassword));
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

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
