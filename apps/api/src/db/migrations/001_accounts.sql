create extension if not exists citext;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  name text not null,
  password_hash text not null,
  email_verified_at timestamptz,
  ui_language text,
  explanation_language text,
  theme text,
  initial_level text,
  created_at timestamptz not null default now()
);

create table sessions (
  id_hash text primary key,
  public_id uuid unique not null default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip text
);
create index sessions_user_idx on sessions (user_id);

create table email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  token_hash text unique not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  default_ui_language text not null default 'en',
  default_explanation_language text not null default 'en',
  default_theme text not null default 'mission',
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  email citext not null,
  role text not null check (role in ('admin', 'member')),
  token_hash text unique not null,
  invited_by uuid references users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_org_idx on invitations (org_id);

create table github_installations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  installation_id bigint unique not null,
  account_login text not null,
  created_at timestamptz not null default now()
);

create table repos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  installation_id uuid references github_installations (id) on delete set null,
  full_name text not null,
  default_branch text not null default 'main',
  languages text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'indexing', 'ready', 'error')),
  stages jsonb not null default '[]',
  error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, full_name)
);
