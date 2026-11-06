-- Migration: Allow all college members (including students) to create and join project/club/interest groups
-- File: supabase/migrations/20261106010000_allow_all_users_to_create_groups.sql

-- 1. Drop existing restrictive policies
drop policy if exists channels_insert_staff on public.channels;
drop policy if exists channels_insert_authorized on public.channels;
drop policy if exists channels_read_authorized on public.channels;
drop policy if exists channel_members_insert_self_or_manager on public.channel_members;
drop policy if exists channel_members_insert_authorized on public.channel_members;

-- 2. Allow authenticated users to view channels they belong to, or their division, or channels they created
create policy channels_read_authorized
  on public.channels for select to authenticated
  using (
    institution_id = mycollege_private.current_institution_id()
    and (
      creator_id = (select auth.uid())
      or mycollege_private.is_channel_member_or_division(id)
    )
  );

-- 3. Allow students & faculty to create project, club, and interest circles. Restrict official class channels to faculty/admins.
create policy channels_insert_authorized
  on public.channels for insert to authenticated
  with check (
    institution_id = mycollege_private.current_institution_id()
    and creator_id = (select auth.uid())
    and (
      type in ('project', 'club', 'interest')
      or mycollege_private.current_role() in ('teacher', 'faculty', 'coordinator', 'admin')
    )
  );

-- 4. Allow users to insert themselves as owner/member of channels they created, or channels they have access to
create policy channel_members_insert_authorized
  on public.channel_members for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    or mycollege_private.can_manage_channel(channel_id)
    or exists (
      select 1 from public.channels c
      where c.id = channel_id
        and c.creator_id = (select auth.uid())
    )
  );
