begin;

do $$
declare
  missing_table text;
  missing_column text;
begin
  select required.table_name
  into missing_table
  from (
    values
      ('profiles'),
      ('groups'),
      ('group_members'),
      ('messages'),
      ('notices'),
      ('preferences')
  ) as required(table_name)
  where to_regclass(format('public.%I', required.table_name)) is null
  limit 1;

  if missing_table is not null then
    raise exception 'Required table public.% is missing.', missing_table;
  end if;

  select required.table_name || '.' || required.column_name
  into missing_column
  from (
    values
      ('profiles', 'id'),
      ('profiles', 'role'),
      ('profiles', 'institution_id'),
      ('profiles', 'full_name'),
      ('profiles', 'username'),
      ('profiles', 'phone'),
      ('profiles', 'avatar_url'),
      ('groups', 'id'),
      ('groups', 'name'),
      ('groups', 'description'),
      ('group_members', 'group_id'),
      ('group_members', 'user_id'),
      ('group_members', 'joined_at'),
      ('messages', 'id'),
      ('messages', 'group_id'),
      ('messages', 'user_id'),
      ('messages', 'content'),
      ('messages', 'created_at'),
      ('notices', 'id'),
      ('notices', 'group_id'),
      ('notices', 'created_by'),
      ('notices', 'title'),
      ('notices', 'content'),
      ('notices', 'deadline'),
      ('preferences', 'user_id'),
      ('preferences', 'interests'),
      ('preferences', 'updated_at')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name = required.table_name
      and c.column_name = required.column_name
  )
  limit 1;

  if missing_column is not null then
    raise exception 'Required column public.% is missing.', missing_column;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'groups',
        'group_members',
        'messages',
        'notices',
        'preferences'
      )
      and policyname not in (
        'Read own memberships',
        'Signed-in users view groups',
        'Members read group messages',
        'Members send own messages',
        'Signed-in users read notices',
        'Create own preferences',
        'Read own preferences',
        'Update own preferences',
        'Read own profile',
        'Update own basic profile',
        'profiles_read_self',
        'preferences_read_self',
        'messages_read_group_members'
      )
  ) then
    raise exception
      'Additional RLS policies were found that were not included in the policy list you shared. Inspect them before applying this migration; they were not changed.';
  end if;
end
$$;

drop policy if exists "Read own memberships" on public.group_members;
drop policy if exists "Signed-in users view groups" on public.groups;
drop policy if exists "Members read group messages" on public.messages;
drop policy if exists "Members send own messages" on public.messages;
drop policy if exists "Signed-in users read notices" on public.notices;
drop policy if exists "Create own preferences" on public.preferences;
drop policy if exists "Read own preferences" on public.preferences;
drop policy if exists "Update own preferences" on public.preferences;
drop policy if exists "Read own profile" on public.profiles;
drop policy if exists "Update own basic profile" on public.profiles;
drop policy if exists profiles_read_self on public.profiles;
drop policy if exists preferences_read_self on public.preferences;
drop policy if exists messages_read_group_members on public.messages;

alter table public.groups
  add column if not exists institution_id uuid;
alter table public.groups
  add column if not exists created_by uuid;

alter table public.groups
  alter column created_by set default auth.uid();
alter table public.group_members
  alter column joined_at set default now();
alter table public.messages
  alter column user_id set default auth.uid();
alter table public.messages
  alter column created_at set default now();
alter table public.notices
  alter column created_by set default auth.uid();
alter table public.preferences
  alter column updated_at set default now();

create schema if not exists mycollege_private;
revoke all on schema mycollege_private from public, anon;
grant usage on schema mycollege_private to authenticated;

create or replace function mycollege_private.current_institution_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.institution_id
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

create or replace function mycollege_private.is_staff_for_institution(
  target_institution_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.institution_id = target_institution_id
      and p.role in ('teacher', 'faculty', 'admin')
  )
$$;

create or replace function mycollege_private.is_group_member(
  target_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members as gm
    where gm.group_id = target_group_id
      and gm.user_id = (select auth.uid())
  )
$$;

create or replace function mycollege_private.is_staff_for_group(
  target_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups as g
    join public.profiles as p
      on p.institution_id = g.institution_id
    where g.id = target_group_id
      and p.id = (select auth.uid())
      and p.role in ('teacher', 'faculty', 'admin')
  )
$$;

create or replace function mycollege_private.prepare_group_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.institution_id
  into new.institution_id
  from public.profiles as p
  where p.id = (select auth.uid());

  if new.institution_id is null then
    raise exception 'Authenticated user must have an assigned institution.'
      using errcode = '42501';
  end if;

  new.created_by := (select auth.uid());
  return new;
end
$$;

create or replace function mycollege_private.add_group_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id)
  select new.id, new.created_by
  where not exists (
    select 1
    from public.group_members as gm
    where gm.group_id = new.id
      and gm.user_id = new.created_by
  );
  return new;
end
$$;

create or replace function mycollege_private.validate_group_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_institution uuid;
  member_institution uuid;
begin
  select g.institution_id
  into group_institution
  from public.groups as g
  where g.id = new.group_id;

  select p.institution_id
  into member_institution
  from public.profiles as p
  where p.id = new.user_id;

  if group_institution is null
    or member_institution is distinct from group_institution then
    raise exception 'Group membership must be within the group institution.'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create or replace function mycollege_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function mycollege_private.current_institution_id()
  from public, anon, authenticated;
revoke all on function mycollege_private.is_staff_for_institution(uuid)
  from public, anon, authenticated;
revoke all on function mycollege_private.is_group_member(uuid)
  from public, anon, authenticated;
revoke all on function mycollege_private.is_staff_for_group(uuid)
  from public, anon, authenticated;
revoke all on function mycollege_private.prepare_group_insert()
  from public, anon, authenticated;
revoke all on function mycollege_private.add_group_creator_as_member()
  from public, anon, authenticated;
revoke all on function mycollege_private.validate_group_membership()
  from public, anon, authenticated;
revoke all on function mycollege_private.set_updated_at()
  from public, anon, authenticated;

grant execute on function mycollege_private.current_institution_id()
  to authenticated;
grant execute on function mycollege_private.is_staff_for_institution(uuid)
  to authenticated;
grant execute on function mycollege_private.is_group_member(uuid)
  to authenticated;
grant execute on function mycollege_private.is_staff_for_group(uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'mycollege_prepare_group_insert',
        'mycollege_group_creator_membership',
        'mycollege_validate_group_membership',
        'mycollege_preferences_updated_at'
      )
  ) then
    raise exception
      'A MyCollege security trigger already exists. Inspect it before applying this migration; no existing trigger was changed.';
  end if;
end
$$;

create trigger mycollege_prepare_group_insert
before insert on public.groups
for each row execute function mycollege_private.prepare_group_insert();

create trigger mycollege_group_creator_membership
after insert on public.groups
for each row execute function mycollege_private.add_group_creator_as_member();

create trigger mycollege_validate_group_membership
before insert or update on public.group_members
for each row execute function mycollege_private.validate_group_membership();

create trigger mycollege_preferences_updated_at
before update on public.preferences
for each row execute function mycollege_private.set_updated_at();

create index if not exists groups_institution_id_idx
  on public.groups (institution_id);
create index if not exists group_members_group_id_user_id_idx
  on public.group_members (group_id, user_id);
create index if not exists group_members_user_id_idx
  on public.group_members (user_id);
create index if not exists messages_group_id_created_at_idx
  on public.messages (group_id, created_at);
create index if not exists notices_group_id_idx
  on public.notices (group_id);

update public.groups as g
set institution_id = (
  select min(p.institution_id::text)::uuid
  from public.group_members as gm
  left join public.profiles as p on p.id = gm.user_id
  where gm.group_id = g.id
    and p.institution_id is not null
)
where g.institution_id is null
  and exists (
    select 1
    from public.group_members as gm
    left join public.profiles as p on p.id = gm.user_id
    where gm.group_id = g.id
    group by gm.group_id
    having count(gm.user_id) = count(p.id)
      and count(gm.user_id) = count(p.institution_id)
      and count(distinct p.institution_id) = 1
  );

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.groups enable row level security;
alter table public.groups force row level security;
alter table public.group_members enable row level security;
alter table public.group_members force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;
alter table public.notices enable row level security;
alter table public.notices force row level security;
alter table public.preferences enable row level security;
alter table public.preferences force row level security;

revoke all on table
  public.profiles,
  public.groups,
  public.group_members,
  public.messages,
  public.notices,
  public.preferences
from public, anon, authenticated;

do $$
declare
  column_record record;
begin
  for column_record in
    select c.table_name, c.column_name
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name in (
        'profiles',
        'groups',
        'group_members',
        'messages',
        'notices',
        'preferences'
      )
  loop
    execute format(
      'revoke all (%I) on table public.%I from public, anon, authenticated',
      column_record.column_name,
      column_record.table_name
    );
  end loop;
end
$$;

grant all on table
  public.profiles,
  public.groups,
  public.group_members,
  public.messages,
  public.notices,
  public.preferences
to service_role;

grant select (
  id,
  full_name,
  username,
  role,
  institution_id,
  department_id,
  designation,
  course,
  year,
  avatar_url,
  is_verified,
  is_profile_completed,
  terms_accepted_at,
  created_at,
  updated_at
) on public.profiles to authenticated;
grant update (full_name, username, phone, avatar_url)
  on public.profiles to authenticated;

grant select on public.groups to authenticated;
grant insert (name, description) on public.groups to authenticated;
grant update (name, description) on public.groups to authenticated;

grant select on public.group_members to authenticated;
grant insert (group_id, user_id) on public.group_members to authenticated;
grant delete on public.group_members to authenticated;

grant select on public.messages to authenticated;
grant insert (group_id, user_id, content) on public.messages to authenticated;
grant update (content) on public.messages to authenticated;
grant delete on public.messages to authenticated;

grant select on public.notices to authenticated;
grant insert (group_id, title, content, deadline)
  on public.notices to authenticated;
grant update (title, content, deadline) on public.notices to authenticated;

grant select on public.preferences to authenticated;
grant insert (user_id, interests) on public.preferences to authenticated;
grant update (interests) on public.preferences to authenticated;

create policy profiles_read_self_or_same_institution_staff
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or mycollege_private.is_staff_for_institution(institution_id)
);

create policy profiles_update_self
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy groups_read_member_or_same_institution_staff
on public.groups for select to authenticated
using (
  mycollege_private.is_group_member(id)
  or mycollege_private.is_staff_for_institution(institution_id)
);

create policy groups_insert_staff
on public.groups for insert to authenticated
with check (
  created_by = (select auth.uid())
  and institution_id = mycollege_private.current_institution_id()
  and mycollege_private.is_staff_for_institution(institution_id)
);

create policy groups_update_staff
on public.groups for update to authenticated
using (mycollege_private.is_staff_for_institution(institution_id))
with check (mycollege_private.is_staff_for_institution(institution_id));

create policy group_members_read_group_member_or_staff
on public.group_members for select to authenticated
using (
  user_id = (select auth.uid())
  or mycollege_private.is_group_member(group_id)
  or mycollege_private.is_staff_for_group(group_id)
);

create policy group_members_insert_staff
on public.group_members for insert to authenticated
with check (
  mycollege_private.is_staff_for_group(group_id)
  and exists (
    select 1
    from public.groups as g
    join public.profiles as target on target.id = group_members.user_id
    where g.id = group_members.group_id
      and target.institution_id = g.institution_id
  )
);

create policy group_members_delete_self_or_staff
on public.group_members for delete to authenticated
using (
  user_id = (select auth.uid())
  or mycollege_private.is_staff_for_group(group_id)
);

create policy messages_read_group_member
on public.messages for select to authenticated
using (mycollege_private.is_group_member(group_id));

create policy messages_insert_group_member_as_self
on public.messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and mycollege_private.is_group_member(group_id)
);

create policy messages_update_sender_or_staff
on public.messages for update to authenticated
using (
  (
    user_id = (select auth.uid())
    and mycollege_private.is_group_member(group_id)
  )
  or mycollege_private.is_staff_for_group(group_id)
)
with check (
  (
    user_id = (select auth.uid())
    and mycollege_private.is_group_member(group_id)
  )
  or mycollege_private.is_staff_for_group(group_id)
);

create policy messages_delete_sender_or_staff
on public.messages for delete to authenticated
using (
  (
    user_id = (select auth.uid())
    and mycollege_private.is_group_member(group_id)
  )
  or mycollege_private.is_staff_for_group(group_id)
);

create policy notices_read_group_member_or_same_institution_staff
on public.notices for select to authenticated
using (
  (
    group_id is not null
    and (
      mycollege_private.is_group_member(group_id)
      or mycollege_private.is_staff_for_group(group_id)
    )
  )
  or (
    group_id is null
    and exists (
      select 1
      from public.profiles as author
      where author.id = notices.created_by
        and mycollege_private.is_staff_for_institution(author.institution_id)
    )
  )
);

create policy notices_insert_staff
on public.notices for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (
      group_id is not null
      and mycollege_private.is_staff_for_group(group_id)
    )
    or (
      group_id is null
      and mycollege_private.is_staff_for_institution(
        mycollege_private.current_institution_id()
      )
    )
  )
);

create policy notices_update_staff
on public.notices for update to authenticated
using (
  (
    group_id is not null
    and mycollege_private.is_staff_for_group(group_id)
  )
  or (
    group_id is null
    and exists (
      select 1
      from public.profiles as author
      where author.id = notices.created_by
        and mycollege_private.is_staff_for_institution(author.institution_id)
    )
  )
)
with check (
  (
    group_id is not null
    and mycollege_private.is_staff_for_group(group_id)
  )
  or (
    group_id is null
    and exists (
      select 1
      from public.profiles as author
      where author.id = notices.created_by
        and mycollege_private.is_staff_for_institution(author.institution_id)
    )
  )
);

create policy preferences_read_self
on public.preferences for select to authenticated
using (user_id = (select auth.uid()));

create policy preferences_insert_self
on public.preferences for insert to authenticated
with check (user_id = (select auth.uid()));

create policy preferences_update_self
on public.preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

do $$
declare
  unprotected_table text;
begin
  select required.table_name
  into unprotected_table
  from (
    values
      ('profiles'),
      ('groups'),
      ('group_members'),
      ('messages'),
      ('notices'),
      ('preferences')
  ) as required(table_name)
  join pg_class as c
    on c.oid = format('public.%I', required.table_name)::regclass
  where not c.relrowsecurity or not c.relforcerowsecurity
  limit 1;

  if unprotected_table is not null then
    raise exception 'RLS is not enabled and forced for public.%', unprotected_table;
  end if;
end
$$;

commit;
