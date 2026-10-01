create table solutions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  created_by uuid references users (id) on delete set null,
  conversation_id uuid references conversations (id) on delete set null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'done', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index solutions_org on solutions (org_id, updated_at desc);

create table solution_versions (
  solution_id uuid not null references solutions (id) on delete cascade,
  n integer not null,
  author text not null check (author in ('web', 'claude-code')),
  draft jsonb not null,
  created_at timestamptz not null default now(),
  primary key (solution_id, n)
);

create table solution_task_status (
  solution_id uuid not null references solutions (id) on delete cascade,
  task_id text not null,
  status text not null check (status in ('todo', 'in_progress', 'done', 'blocked')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (solution_id, task_id)
);

create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  prefix text not null,
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_tokens_owner on api_tokens (org_id, user_id);
