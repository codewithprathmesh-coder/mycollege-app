-- ============================================================
-- Migration: allow_faculty_direct_publish
-- Purpose  : Allow faculty and teachers to directly publish
--            announcements without requiring dean/admin approval,
--            and make author metadata assignment robust.
-- ============================================================
begin;

-- 1. Update guard_announcement_changes to permit faculty/teacher direct publishing
create or replace function mycollege_private.guard_announcement_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := mycollege_private.current_role();
begin
  if tg_op = 'INSERT' then
    if new.is_official and actor_role not in ('faculty', 'teacher', 'admin') then
      raise exception 'Only faculty or administrators may publish official announcements';
    end if;

    -- Faculty, teachers, and admins can publish directly without approval
    if new.status = 'published'
      and actor_role not in ('faculty', 'teacher', 'admin')
      and exists (
        select 1
        from public.institutions as i
        where i.id = new.institution_id
          and i.require_approval
      )
    then
      raise exception 'This institution requires administrator approval';
    end if;

    if new.reviewed_by is not null or new.rejection_reason is not null then
      if actor_role not in ('faculty', 'teacher', 'admin') then
        raise exception 'Only administrators or faculty may set announcement review fields';
      end if;
    end if;

    return new;
  end if;

  if new.status is distinct from old.status
    or new.reviewed_by is distinct from old.reviewed_by
    or new.rejection_reason is distinct from old.rejection_reason
    or new.is_official is distinct from old.is_official
  then
    if actor_role not in ('admin', 'faculty', 'teacher') then
      raise exception 'Only administrators or faculty may change announcement review state';
    end if;
  end if;

  if new.is_pinned is distinct from old.is_pinned
    and actor_role not in ('faculty', 'teacher', 'admin')
  then
    raise exception 'Only faculty or administrators may pin announcements';
  end if;

  return new;
end;
$$;

-- 2. Make author metadata trigger resilient and ensure institution_id matches
create or replace function mycollege_private.set_announcement_author_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_profile public.profiles%rowtype;
begin
  select p.*
  into author_profile
  from public.profiles as p
  where p.id = (select auth.uid());

  if author_profile.id is not null then
    new.author_id := author_profile.id;
    new.institution_id := coalesce(author_profile.institution_id, new.institution_id);
    new.author_name := coalesce(author_profile.full_name, split_part(author_profile.email, '@', 1));
    new.author_role := coalesce(author_profile.role, 'faculty');
  end if;

  return new;
end;
$$;

-- 3. Ensure announcements_create_staff policy allows staff inserts cleanly
drop policy if exists announcements_create_staff on public.announcements;
create policy announcements_create_staff
  on public.announcements for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and mycollege_private.current_role() in ('teacher', 'faculty', 'coordinator', 'admin')
  );

commit;
