import { buildApp } from './app';
import { createInfraChecks, createPgPool, createRedisClient } from './checks';
import { loadConfig } from './config';
import { ensureDatabase } from './db/ensureDatabase';
import { runMigrations } from './db/migrate';
import { createDevMailer } from './mail/mailer';

const APP_POOL_SIZE = 10;

const config = loadConfig();
if (config.dbEnsure) await ensureDatabase(config.databaseUrl);
const pool = createPgPool(config.databaseUrl, APP_POOL_SIZE);
const applied = await runMigrations(pool);
if (applied.length > 0) console.log(`applied migrations: ${applied.join(', ')}`);
const redis = createRedisClient(config.redisUrl);
const mailer = createDevMailer();
const infra = createInfraChecks(config);

const app = buildApp({
  checks: infra.checks,
  onClose: async () => {
    await infra.close();
    await pool.end();
    redis.disconnect();
  },
  deps: { config, pool, redis, mailer },
});

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`api listening on http://localhost:${config.port}${config.devRoutes ? ' (dev routes on)' : ''}`);
