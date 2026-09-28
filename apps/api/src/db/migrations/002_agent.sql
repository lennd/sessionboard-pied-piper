create table source_files (
  repo_id uuid not null references repos (id) on delete cascade,
  path text not null,
  language text not null,
  content text not null,
  primary key (repo_id, path)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_org_user on conversations (org_id, user_id, updated_at desc);

create table conversation_messages (
  id bigserial primary key,
  conversation_id uuid not null references conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index conversation_messages_conversation on conversation_messages (conversation_id, id);

create table scenes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete cascade,
  source_scene_id uuid references scenes (id) on delete set null,
  turn integer not null default 0,
  scene jsonb not null,
  created_at timestamptz not null default now()
);
create index scenes_conversation on scenes (conversation_id, created_at);

create table agent_usage (
  org_id uuid not null references orgs (id) on delete cascade,
  month text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (org_id, month)
);
