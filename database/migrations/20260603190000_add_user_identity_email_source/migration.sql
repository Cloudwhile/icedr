alter table user_identities
add column if not exists email_source text;

update user_identities
set email_source = 'provider'
where email_source is null
  or email_source not in ('provider', 'derived');

update user_identities i
set email_source = 'derived'
from users u
where i.user_id = u.id
  and i.provider <> 'local'
  and lower(u.email) like '%@identity.local'
  and i.email_source <> 'derived';

alter table user_identities
alter column email_source set default 'provider';

alter table user_identities
alter column email_source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_identities_email_source_check'
      and conrelid = 'user_identities'::regclass
  ) then
    alter table user_identities
    add constraint user_identities_email_source_check
    check (email_source in ('provider', 'derived'));
  end if;
end $$;
