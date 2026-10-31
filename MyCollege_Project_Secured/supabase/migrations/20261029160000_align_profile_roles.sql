begin;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'teacher', 'faculty', 'coordinator', 'admin'));

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

commit;
