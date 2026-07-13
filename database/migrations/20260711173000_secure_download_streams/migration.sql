alter table file_download_intents
  add column if not exists version_id text,
  add column if not exists purpose text not null default 'download',
  add column if not exists consumed_at timestamptz,
  add column if not exists use_count integer not null default 0,
  add column if not exists request_ip_hash text,
  add column if not exists user_agent_hash text;

update file_download_intents
set method = case
  when method = 'presigned-url' then 'stream'
  when method = 'backend-manifest' then 'manifest'
  else method
end;

create index if not exists file_download_intents_node_id_version_id_idx
  on file_download_intents(node_id, version_id);

create index if not exists file_download_intents_expires_at_idx
  on file_download_intents(expires_at);

alter table share_download_intents
  add column if not exists purpose text not null default 'download',
  add column if not exists use_count integer not null default 0;

update share_download_intents
set method = case
  when method = 'presigned-url' then 'stream'
  when method = 'backend-manifest' then 'manifest'
  else method
end;

alter table upload_sessions
  add column if not exists owner_user_id text,
  add column if not exists conflict_strategy text not null default 'version';

create index if not exists upload_sessions_owner_user_id_idx
  on upload_sessions(owner_user_id);

alter table transfer_tasks
  add column if not exists owner_user_id text;

create index if not exists transfer_tasks_owner_user_id_idx
  on transfer_tasks(owner_user_id);

alter table share_links
  add column if not exists creator_user_id text;

create index if not exists share_links_creator_user_id_idx
  on share_links(creator_user_id);
