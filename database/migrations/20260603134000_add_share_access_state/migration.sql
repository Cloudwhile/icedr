create table if not exists share_email_codes (
  id text primary key,
  share_token text not null,
  email text not null,
  email_domain text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count integer not null default 0,
  request_ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists share_email_codes_share_token_email_idx
on share_email_codes (share_token, email);

create index if not exists share_email_codes_expires_at_idx
on share_email_codes (expires_at);

delete from share_email_codes c
where not exists (
  select 1
  from share_links s
  where s.token = c.share_token
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'share_email_codes_share_token_fkey'
  ) then
    alter table share_email_codes
    add constraint share_email_codes_share_token_fkey
    foreign key (share_token)
    references share_links(token)
    on delete cascade;
  end if;
end $$;

create table if not exists share_access_sessions (
  id text primary key,
  share_token text not null,
  identity_type text not null,
  email text,
  email_domain text,
  available_at timestamptz not null,
  wait_seconds integer not null,
  download_limit text not null default '',
  speed_limit jsonb,
  policy_decision jsonb,
  expires_at timestamptz not null,
  request_ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

alter table share_access_sessions
add column if not exists policy_decision jsonb;

create index if not exists share_access_sessions_share_token_idx
on share_access_sessions (share_token);

create index if not exists share_access_sessions_expires_at_idx
on share_access_sessions (expires_at);

delete from share_access_sessions a
where not exists (
  select 1
  from share_links s
  where s.token = a.share_token
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'share_access_sessions_share_token_fkey'
  ) then
    alter table share_access_sessions
    add constraint share_access_sessions_share_token_fkey
    foreign key (share_token)
    references share_links(token)
    on delete cascade;
  end if;
end $$;

create table if not exists share_download_intents (
  id text primary key,
  share_token text not null,
  node_id text not null,
  filename text not null,
  method text not null,
  identity_type text not null default 'anonymous',
  email text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  request_ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

alter table share_download_intents
add column if not exists identity_type text not null default 'anonymous',
add column if not exists email text;

create index if not exists share_download_intents_share_token_node_id_idx
on share_download_intents (share_token, node_id);

create index if not exists share_download_intents_expires_at_idx
on share_download_intents (expires_at);

delete from share_download_intents d
where not exists (
  select 1
  from share_links s
  where s.token = d.share_token
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'share_download_intents_share_token_fkey'
  ) then
    alter table share_download_intents
    add constraint share_download_intents_share_token_fkey
    foreign key (share_token)
    references share_links(token)
    on delete cascade;
  end if;
end $$;
