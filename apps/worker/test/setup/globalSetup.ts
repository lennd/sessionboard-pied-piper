import { createPgPool } from '../../../api/src/checks';
import { ensureDatabase } from '../../../api/src/db/ensureDatabase';
import { runMigrations } from '../../../api/src/db/migrate';

export const WORKER_TEST_DB = process.env.WORKER_TEST_DATABASE_URL ?? 'postgres://rdi:rdi@localhost:5548/rdi_test';

export default async () => {
  await ensureDatabase(WORKER_TEST_DB);
  const pool = createPgPool(WORKER_TEST_DB);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
};
