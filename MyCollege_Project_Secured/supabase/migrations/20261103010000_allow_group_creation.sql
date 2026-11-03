-- ============================================================
-- Migration: allow_group_creation
-- Purpose  : 1. Add missing channels and channel_messages columns
--            2. Ensure trigger add_channel_creator_as_owner safely handles UUIDs
--            3. Reset and drop conflicting RLS policies on channels,
--               channel_members, channel_messages, and channel_polls
--            4. Create permissive authenticated policies for chat/groups
--            5. Reload PostgREST schema cache
-- ============================================================
begin;

-- 1. Add missing columns to channels
alter table public.channels
  add column if not exists group_icon text,
  add column if not exists only_admins_can_message boolean not null default false,
  add column if not exists only_admins_can_edit_info boolean not null default false,
  add column if not exists invite_code text,
  add column if not exists pinned_announcement_id uuid,
  add column if not exists pinned_message_id uuid;

-- 2. Add missing columns to channel_messages
alter table public.channel_messages
  add column if not exists sender_name text,
  add column if not exists sender_role text,
  add column if not exists sender_department text,
  add column if not exists reply_metadata jsonb,
  add column if not exists poll_data jsonb;

-- 3. Add missing columns to channel_polls
alter table public.channel_polls
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- 4. Ensure trigger add_channel_creator_as_owner is safe and does not fail
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

-- 5. Dynamically drop all old conflicting policies on channels and chat tables
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

-- 6. Clean permissive RLS policies for channels
alter table public.channels enable row level security;
create policy channels_select_authenticated on public.channels for select to authenticated using (true);
create policy channels_insert_authenticated on public.channels for insert to authenticated with check (true);
create policy channels_update_authenticated on public.channels for update to authenticated using (true) with check (true);
create policy channels_delete_authenticated on public.channels for delete to authenticated using (true);

-- 7. Clean permissive RLS policies for channel_members
alter table public.channel_members enable row level security;
create policy channel_members_select_authenticated on public.channel_members for select to authenticated using (true);
create policy channel_members_insert_authenticated on public.channel_members for insert to authenticated with check (true);
create policy channel_members_update_authenticated on public.channel_members for update to authenticated using (true) with check (true);
create policy channel_members_delete_authenticated on public.channel_members for delete to authenticated using (true);

-- 8. Clean permissive RLS policies for channel_messages
alter table public.channel_messages enable row level security;
create policy channel_messages_select_authenticated on public.channel_messages for select to authenticated using (true);
create policy channel_messages_insert_authenticated on public.channel_messages for insert to authenticated with check (true);
create policy channel_messages_update_authenticated on public.channel_messages for update to authenticated using (true) with check (true);
create policy channel_messages_delete_authenticated on public.channel_messages for delete to authenticated using (true);

-- 9. Clean permissive RLS policies for channel_polls
alter table public.channel_polls enable row level security;
create policy channel_polls_select_authenticated on public.channel_polls for select to authenticated using (true);
create policy channel_polls_insert_authenticated on public.channel_polls for insert to authenticated with check (true);
create policy channel_polls_update_authenticated on public.channel_polls for update to authenticated using (true) with check (true);
create policy channel_polls_delete_authenticated on public.channel_polls for delete to authenticated using (true);

commit;

-- 10. Reload PostgREST schema cache
notify pgrst, 'reload schema';
