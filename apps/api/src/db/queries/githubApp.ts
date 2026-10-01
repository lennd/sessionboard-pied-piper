import type { ManifestApp } from '@rdi/providers';
import type { Db } from './users';

export type StoredGithubApp = ManifestApp & { stateSecret: string };

type Row = {
  app_id: string; slug: string; name: string; html_url: string; owner_login: string; private_key: string;
  webhook_secret: string; client_id: string; client_secret: string; state_secret: string;
};

/** Stores the single manifest-created App; fails if one already exists (the primary key only allows id 1). */
export const saveGithubApp = async (db: Db, app: StoredGithubApp): Promise<void> => {
  await db.query(
    `insert into github_app (app_id, slug, name, html_url, owner_login, private_key, webhook_secret, client_id, client_secret, state_secret)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [app.appId, app.slug, app.name, app.htmlUrl, app.ownerLogin, app.privateKey, app.webhookSecret, app.clientId, app.clientSecret, app.stateSecret],
  );
};

export const loadGithubAppRow = async (db: Db): Promise<StoredGithubApp | null> => {
  const row = (await db.query<Row>('select * from github_app where id = 1')).rows[0];
  if (!row) return null;
  return {
    appId: row.app_id, slug: row.slug, name: row.name, htmlUrl: row.html_url, ownerLogin: row.owner_login, privateKey: row.private_key,
    webhookSecret: row.webhook_secret, clientId: row.client_id, clientSecret: row.client_secret, stateSecret: row.state_secret,
  };
};
