import { afterAll, describe, expect, it } from 'vitest';
import { createPgPool } from '../src/checks';
import { runMigrations } from '../src/db/migrate';
import { TEST_DATABASE_URL } from './setup/env';

const pool = createPgPool(TEST_DATABASE_URL);
afterAll(() => pool.end());

describe('runMigrations', () => {
  it('has created every table', async () => {
    const { rows } = await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by table_name");
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(['email_tokens', 'github_installations', 'invitations', 'memberships', 'orgs', 'repos', 'schema_migrations', 'sessions', 'users']),
    );
  });

  it('is idempotent', async () => {
    expect(await runMigrations(pool)).toEqual([]);
  });
});
