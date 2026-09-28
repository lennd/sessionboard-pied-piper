import { createPgPool } from '../../src/checks';
import { ensureDatabase } from '../../src/db/ensureDatabase';
import { runMigrations } from '../../src/db/migrate';
import { TEST_DATABASE_URL } from './env';

export default async () => {
  await ensureDatabase(TEST_DATABASE_URL);
  const pool = createPgPool(TEST_DATABASE_URL);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
};
