-- Migration: 20261107010000_allow_channel_members_visibility.sql
-- Description: Allow authenticated users to view profiles of fellow members in channels and allow group deletion by creators/admins

begin;

-- 1. Ensure authenticated users in the institution can view profile info (name, role, designation, avatar)
-- so students can see all group participants and admins.
drop policy if exists profiles_read_same_institution on public.profiles;
create policy profiles_read_same_institution
  on public.profiles
  for select
  to authenticated
  using (
    institution_id = (
      select p.institution_id from public.profiles p where p.id = (select auth.uid())
    )
    or id = (select auth.uid())
  );

-- 2. Ensure delete policy on channels allows channel creators or managers/admins to delete groups
drop policy if exists channels_delete_manager on public.channels;
drop policy if exists channels_delete_creator_or_admin on public.channels;
create policy channels_delete_creator_or_admin
  on public.channels
  for delete
  to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
      and p.role in ('admin', 'faculty', 'teacher')
    )
    or exists (
      select 1 from public.channel_members cm
      where cm.channel_id = id
      and cm.profile_id = (select auth.uid())
      and cm.role = 'admin'
    )
  );

-- 3. Also allow updating channel settings (title, description, permissions)
drop policy if exists channels_update_manager on public.channels;
drop policy if exists channels_update_creator_or_admin on public.channels;
create policy channels_update_creator_or_admin
  on public.channels
  for update
  to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
      and p.role in ('admin', 'faculty', 'teacher')
    )
    or exists (
      select 1 from public.channel_members cm
      where cm.channel_id = id
      and cm.profile_id = (select auth.uid())
      and cm.role = 'admin'
    )
  )
  with check (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
      and p.role in ('admin', 'faculty', 'teacher')
    )
    or exists (
      select 1 from public.channel_members cm
      where cm.channel_id = id
      and cm.profile_id = (select auth.uid())
      and cm.role = 'admin'
    )
  );

commit;
