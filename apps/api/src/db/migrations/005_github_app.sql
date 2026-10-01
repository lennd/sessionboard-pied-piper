create table github_app (
  id smallint primary key default 1 check (id = 1),
  app_id text not null,
  slug text not null,
  name text not null,
  html_url text not null,
  owner_login text not null,
  private_key text not null,
  webhook_secret text not null,
  client_id text not null,
  client_secret text not null,
  state_secret text not null,
  created_at timestamptz not null default now()
);
