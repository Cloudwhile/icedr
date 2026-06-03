alter table auth_oauth_states
add column if not exists provider_snapshot jsonb;
