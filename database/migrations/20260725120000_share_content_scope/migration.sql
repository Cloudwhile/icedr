alter table share_links
  add column if not exists scope_mode text not null default 'legacy';

create table if not exists share_content_members (
  share_token text not null,
  node_id text not null,
  role text not null,
  snapshot_parent_node_id text,
  snapshot_name text,
  snapshot_kind text,
  snapshot_mime_type text,
  snapshot_size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint share_content_members_pkey primary key (share_token, node_id),
  constraint share_content_members_share_token_fkey
    foreign key (share_token) references share_links(token) on delete cascade
);

create index if not exists share_content_members_node_id_idx
  on share_content_members(node_id);

with raw_members as (
  select
    share.token as share_token,
    share.created_at,
    root_id.node_id,
    2 as role_priority
  from share_links share
  cross join lateral jsonb_array_elements_text(
    coalesce(share.root_item_ids, '[]'::jsonb)
  ) as root_id(node_id)

  union all

  select
    share.token as share_token,
    share.created_at,
    allowed_id.node_id,
    1 as role_priority
  from share_links share
  cross join lateral jsonb_array_elements_text(
    coalesce(share.allowed_item_ids, '[]'::jsonb)
  ) as allowed_id(node_id)
),
deduplicated_members as (
  select distinct on (share_token, node_id)
    share_token,
    created_at,
    node_id,
    role_priority
  from raw_members
  where node_id <> ''
  order by share_token, node_id, role_priority desc
)
insert into share_content_members (
  share_token,
  node_id,
  role,
  snapshot_parent_node_id,
  snapshot_name,
  snapshot_kind,
  snapshot_mime_type,
  snapshot_size_bytes,
  created_at
)
select
  member.share_token,
  member.node_id,
  case when member.role_priority = 2 then 'root' else 'selected' end,
  node.parent_node_id,
  node.name,
  node.kind,
  node.mime_type,
  node.size_bytes,
  member.created_at
from deduplicated_members member
left join file_nodes node on node.id = member.node_id
on conflict (share_token, node_id) do nothing;
