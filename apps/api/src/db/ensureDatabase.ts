import pg from 'pg';

const SAFE_NAME = /^[a-z0-9_]+$/;

export const ensureDatabase = async (databaseUrl: string): Promise<void> => {
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe database name "${name}"`);
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount === 0) await client.query(`create database ${name}`);
  } finally {
    await client.end();
  }
};
