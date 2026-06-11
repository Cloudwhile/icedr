alter table file_download_intents
  add column if not exists audit_metadata jsonb not null default '{}'::jsonb;
