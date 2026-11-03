-- ============================================================
-- Migration: allow_group_creation
-- Purpose  : 1. Ensure trigger add_channel_creator_as_owner safely handles UUIDs
--            2. Reset and drop conflicting RLS policies on channels,
--               channel_members, channel_messages, and channel_polls
--            3. Create permissive authenticated policies for chat/groups
-- ============================================================
begin;

-- 1. Ensure trigger add_channel_creator_as_owner is safe and does not fail
create or replace function mycollege_private.add_channel_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channel_members (channel_id, profile_id, role, status)
  values (new.id, coalesce(new.creator_id, (select auth.uid())), 'owner', 'active')
  on conflict do nothing;
  return new;
end;
$$;

-- 2. Dynamically drop all old conflicting policies on channels and chat tables
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'channels',
        'channel_members',
        'channel_messages',
        'channel_polls',
        'mycollege_poll_options',
        'mycollege_poll_votes'
      )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- 3. Clean permissive RLS policies for channels
alter table public.channels enable row level security;
create policy channels_select_authenticated on public.channels for select to authenticated using (true);
create policy channels_insert_authenticated on public.channels for insert to authenticated with check (true);
create policy channels_update_authenticated on public.channels for update to authenticated using (true) with check (true);
create policy channels_delete_authenticated on public.channels for delete to authenticated using (true);

-- 4. Clean permissive RLS policies for channel_members
alter table public.channel_members enable row level security;
create policy channel_members_select_authenticated on public.channel_members for select to authenticated using (true);
create policy channel_members_insert_authenticated on public.channel_members for insert to authenticated with check (true);
create policy channel_members_update_authenticated on public.channel_members for update to authenticated using (true) with check (true);
create policy channel_members_delete_authenticated on public.channel_members for delete to authenticated using (true);

-- 5. Clean permissive RLS policies for channel_messages
alter table public.channel_messages enable row level security;
create policy channel_messages_select_authenticated on public.channel_messages for select to authenticated using (true);
create policy channel_messages_insert_authenticated on public.channel_messages for insert to authenticated with check (true);
create policy channel_messages_update_authenticated on public.channel_messages for update to authenticated using (true) with check (true);
create policy channel_messages_delete_authenticated on public.channel_messages for delete to authenticated using (true);

-- 6. Clean permissive RLS policies for channel_polls
alter table public.channel_polls enable row level security;
create policy channel_polls_select_authenticated on public.channel_polls for select to authenticated using (true);
create policy channel_polls_insert_authenticated on public.channel_polls for insert to authenticated with check (true);
create policy channel_polls_update_authenticated on public.channel_polls for update to authenticated using (true) with check (true);
create policy channel_polls_delete_authenticated on public.channel_polls for delete to authenticated using (true);

commit;
