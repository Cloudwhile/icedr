alter table auth_settings
  add column if not exists minimum_authentication_methods integer not null default 1;

alter table auth_passkeys
  add column if not exists aaguid text,
  add column if not exists created_user_agent text,
  add column if not exists created_ip_hash text,
  add column if not exists last_used_user_agent text,
  add column if not exists last_used_ip_hash text;

alter table auth_challenges
  drop column if exists email,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_token_hash text;

create index if not exists auth_challenges_flow_expires_at_used_at_idx
  on auth_challenges(flow, expires_at, used_at);

create table if not exists auth_rate_limits (
  id text primary key,
  action text not null,
  scope_hash text not null,
  window_started_at timestamptz not null,
  count integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (action, scope_hash)
);

create index if not exists auth_rate_limits_updated_at_idx
  on auth_rate_limits(updated_at);

create table if not exists auth_step_up_tokens (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  session_token_hash text not null,
  method text not null,
  purpose text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_step_up_tokens_user_id_purpose_expires_at_idx
  on auth_step_up_tokens(user_id, purpose, expires_at);

create table if not exists auth_recovery_codes (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  batch_id text not null,
  code_hash text not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_recovery_codes_user_id_used_at_idx
  on auth_recovery_codes(user_id, used_at);

alter table auth_oauth_states
  add column if not exists user_id text references users(id) on delete cascade,
  add column if not exists session_token_hash text,
  add column if not exists purpose text;

alter table auth_oauth_exchange_codes
  add column if not exists flow text not null default 'login',
  add column if not exists session_token_hash text,
  add column if not exists purpose text;
