create table if not exists auth_settings (
  setting_key text primary key,
  local_enabled boolean not null,
  oauth_enabled boolean not null,
  passkey_enabled boolean not null,
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users
add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_role_check'
  ) then
    alter table users
    add constraint users_role_check
    check (role in ('admin', 'member'));
  end if;
end $$;

create table if not exists user_meta (
  user_id text primary key references users(id) on delete cascade,
  avatar_url text,
  locale text,
  theme text,
  timezone text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_identities (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject)
);

create table if not exists auth_sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists auth_password_resets (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table auth_password_resets
add column if not exists attempt_count integer not null default 0;

create table if not exists auth_passkeys (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports jsonb not null default '[]'::jsonb,
  device_type text not null,
  backed_up boolean not null default false,
  name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists auth_challenges (
  id text primary key,
  flow text not null,
  challenge text not null,
  user_id text references users(id) on delete cascade,
  email text,
  expires_at timestamptz not null,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists auth_oauth_states (
  state text primary key,
  flow text not null,
  share_token text,
  code_verifier text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth_oauth_exchange_codes (
  code_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  parent_meta text not null,
  meta text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (parent_meta, meta)
);

create table if not exists workspaces (
  id text primary key,
  name text not null,
  root_node_id text not null,
  member_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_share_settings (
  workspace_id text primary key,
  anonymous_access text not null,
  email_rule text not null,
  allowed_domains jsonb not null,
  default_expires_days integer not null,
  max_expires_days integer not null,
  allow_permanent boolean not null,
  audit_settings jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists file_nodes (
  id text primary key,
  workspace_id text not null,
  parent_node_id text,
  name text not null,
  kind text not null,
  mime_type text not null,
  size_bytes bigint,
  object_key text,
  owner_name text not null,
  starred boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table file_nodes
add column if not exists starred boolean not null default false,
add column if not exists archived_at timestamptz;

create table if not exists preview_artifacts (
  id text primary key,
  node_id text not null,
  source_object_key text,
  preview_object_key text,
  preview_type text not null,
  status text not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists file_download_intents (
  id text primary key,
  node_id text not null,
  filename text not null,
  method text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists upload_sessions (
  id text primary key,
  transfer_id text not null,
  workspace_id text not null,
  object_key text not null,
  multipart_upload_id text,
  resume_key text,
  file_name text not null,
  parent_node_id text,
  mime_type text not null,
  size_bytes bigint not null,
  chunk_size_bytes integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table upload_sessions
add column if not exists multipart_upload_id text;

create unique index if not exists upload_sessions_resume_key_active_idx
on upload_sessions (workspace_id, resume_key)
where resume_key is not null and status in ('running', 'paused', 'failed');

create table if not exists upload_session_parts (
  session_id text not null references upload_sessions(id) on delete cascade,
  part_index integer not null,
  start_byte bigint not null,
  end_byte bigint not null,
  size_bytes bigint not null,
  e_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, part_index)
);

alter table upload_session_parts
add column if not exists e_tag text;

create table if not exists storage_settings (
  setting_key text primary key,
  distributed_storage_enabled boolean not null,
  endpoint text not null default '',
  region text not null default 'us-east-1',
  bucket text not null default '',
  access_key_id text not null default '',
  secret_access_key text not null default '',
  force_path_style boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table storage_settings
add column if not exists endpoint text not null default '',
add column if not exists region text not null default 'us-east-1',
add column if not exists bucket text not null default '',
add column if not exists access_key_id text not null default '',
add column if not exists secret_access_key text not null default '',
add column if not exists force_path_style boolean not null default true;

create table if not exists transfer_tasks (
  id text primary key,
  workspace_id text not null,
  node_id text,
  object_key text,
  name text not null,
  transfer_type text not null,
  progress numeric(5, 1) not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'transfer_tasks'
      and column_name = 'progress'
      and (
        data_type <> 'numeric'
        or numeric_precision is distinct from 5
        or numeric_scale is distinct from 1
      )
  ) then
    alter table transfer_tasks
    alter column progress type numeric(5, 1)
    using round(progress::numeric, 1);
  end if;
end $$;

create table if not exists share_links (
  token text primary key,
  workspace_id text not null default 'workspace-default',
  title text not null,
  mode text not null,
  owner_name text not null,
  root_item_ids jsonb not null,
  allowed_item_ids jsonb not null,
  dynamic_root_id text,
  allow_download boolean not null,
  allow_preview boolean not null,
  expires_days integer not null,
  remark text,
  policy_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table share_links
add column if not exists workspace_id text not null default 'workspace-default';

create table if not exists audit_events (
  id text primary key,
  action text not null,
  actor text not null,
  target text not null,
  workspace_id text,
  share_token text,
  node_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table audit_events
add column if not exists workspace_id text,
add column if not exists node_id text;

create table if not exists blob_reconcile_tasks (
  id text primary key,
  workspace_id text,
  status text not null,
  cleanup boolean not null,
  stale_upload_minutes integer not null,
  missing_objects jsonb not null default '[]'::jsonb,
  orphan_objects jsonb not null default '[]'::jsonb,
  stale_uploads jsonb not null default '[]'::jsonb,
  deleted_objects jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  finished_at timestamptz not null
);
