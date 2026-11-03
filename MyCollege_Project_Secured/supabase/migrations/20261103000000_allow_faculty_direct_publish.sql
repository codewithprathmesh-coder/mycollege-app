-- ============================================================
-- Migration: allow_faculty_direct_publish
-- Purpose  : 1. Seed faculty directory with verified faculty
--            2. Update public.profiles to role = 'faculty'
--            3. Fix current_role() to recognize faculty automatically
--            4. Allow faculty/teachers to directly publish announcements
--               without requiring Dean/Admin approval
--            5. Fix RLS check on announcements insert
-- ============================================================
begin;

-- 1. Ensure faculty_directory table exists and has RLS
create table if not exists public.faculty_directory (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  email text not null,
  full_name text not null,
  designation text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.faculty_directory enable row level security;

-- Create unique index if not exists
create unique index if not exists faculty_directory_email_idx
  on public.faculty_directory (lower(email));

-- Seed new faculty members using WHERE NOT EXISTS (safe across all PostgreSQL schema states)
insert into public.faculty_directory (
  institution_id,
  department_id,
  email,
  full_name,
  designation,
  is_active
)
select
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000015'::uuid,
  v.email,
  v.full_name,
  v.designation,
  true
from (
  values
    ('mnemade@somaiya.edu', 'Dr. Milind U. Nemade', 'HOD & Professor'),
    ('vwadhe@somaiya.edu', 'Dr. Vaishali R. Wadhwe', 'I/C HOD & Professor'),
    ('gwadmare@somaiya.edu', 'Mr. Ganesh B. Wadmare', 'Asst.Professor'),
    ('devanandkb@somaiya.edu', 'Mr. Devanand K. Bathe', 'Asst.Professor'),
    ('sheetaljagtap@somaiya.edu', 'Dr. Sheetal G. Jagtap', 'Asst.Professor'),
    ('pankaj@somaiya.edu', 'Mr. Pankaj V. Deshmukh', 'Asst.Professor'),
    ('medha@somaiya.edu', 'Ms. Medha S. Asurlekar', 'Asst.Professor'),
    ('sshah@somaiya.edu', 'Ms. Sejal B. Shah', 'Asst.Professor'),
    ('vsagvekar@somaiya.edu', 'Dr. Vidya R. Sagvekar', 'Asst.Professor'),
    ('sarika@somaiya.edu', 'Dr. Sarika Y. Mane', 'Asst.Professor'),
    ('deepali.c@somaiya.edu', 'Ms. Deepali Chavan', 'Asst.Professor'),
    ('pravin.patil@somaiya.edu', 'Mr. Pravin Patil', 'Asst.Professor'),
    ('pradnya28@somaiya.edu', 'Ms. Pradnya Jadhav', 'Asst.Professor'),
    ('prashant.sb@somaiya.edu', 'Mr. Prashant Bhandare', 'Asst.Professor'),
    ('bhagyashree.i@somaiya.edu', 'Ms. Bhagyashree Ingale', 'Asst.Professor'),
    ('skasar@somaiya.edu', 'Mr. Sudhir Kasar', 'Skilled Asst.'),
    ('kpashte@somaiya.edu', 'Ms. Kavita Pashte', 'Tech.Asst.'),
    ('sdhale@somaiya.edu', 'Mr. Sachin Dhale', 'Lab.Asst.'),
    ('bharati@somaiya.edu', 'Ms. Bharati Sansare', 'Lab.Asst.'),
    ('lokmat874@gmail.com', 'lokmat', 'trial')
) as v(email, full_name, designation)
where not exists (
  select 1 from public.faculty_directory as f
  where lower(f.email) = lower(v.email)
);

-- Update existing rows in faculty_directory
update public.faculty_directory as f
set full_name = v.full_name,
    designation = v.designation,
    institution_id = '00000000-0000-4000-8000-000000000001'::uuid,
    department_id = '00000000-0000-4000-8000-000000000015'::uuid,
    is_active = true
from (
  values
    ('mnemade@somaiya.edu', 'Dr. Milind U. Nemade', 'HOD & Professor'),
    ('vwadhe@somaiya.edu', 'Dr. Vaishali R. Wadhwe', 'I/C HOD & Professor'),
    ('gwadmare@somaiya.edu', 'Mr. Ganesh B. Wadmare', 'Asst.Professor'),
    ('devanandkb@somaiya.edu', 'Mr. Devanand K. Bathe', 'Asst.Professor'),
    ('sheetaljagtap@somaiya.edu', 'Dr. Sheetal G. Jagtap', 'Asst.Professor'),
    ('pankaj@somaiya.edu', 'Mr. Pankaj V. Deshmukh', 'Asst.Professor'),
    ('medha@somaiya.edu', 'Ms. Medha S. Asurlekar', 'Asst.Professor'),
    ('sshah@somaiya.edu', 'Ms. Sejal B. Shah', 'Asst.Professor'),
    ('vsagvekar@somaiya.edu', 'Dr. Vidya R. Sagvekar', 'Asst.Professor'),
    ('sarika@somaiya.edu', 'Dr. Sarika Y. Mane', 'Asst.Professor'),
    ('deepali.c@somaiya.edu', 'Ms. Deepali Chavan', 'Asst.Professor'),
    ('pravin.patil@somaiya.edu', 'Mr. Pravin Patil', 'Asst.Professor'),
    ('pradnya28@somaiya.edu', 'Ms. Pradnya Jadhav', 'Asst.Professor'),
    ('prashant.sb@somaiya.edu', 'Mr. Prashant Bhandare', 'Asst.Professor'),
    ('bhagyashree.i@somaiya.edu', 'Ms. Bhagyashree Ingale', 'Asst.Professor'),
    ('skasar@somaiya.edu', 'Mr. Sudhir Kasar', 'Skilled Asst.'),
    ('kpashte@somaiya.edu', 'Ms. Kavita Pashte', 'Tech.Asst.'),
    ('sdhale@somaiya.edu', 'Mr. Sachin Dhale', 'Lab.Asst.'),
    ('bharati@somaiya.edu', 'Ms. Bharati Sansare', 'Lab.Asst.'),
    ('lokmat874@gmail.com', 'lokmat', 'trial')
) as v(email, full_name, designation)
where lower(f.email) = lower(v.email);

-- 2. Update existing profiles for faculty to have role = 'faculty'
update public.profiles
set role = 'faculty',
    institution_id = coalesce(institution_id, '00000000-0000-4000-8000-000000000001'::uuid),
    department_id = coalesce(department_id, '00000000-0000-4000-8000-000000000015'::uuid)
where lower(email) in (
  'mnemade@somaiya.edu', 'vwadhe@somaiya.edu', 'gwadmare@somaiya.edu',
  'devanandkb@somaiya.edu', 'sheetaljagtap@somaiya.edu', 'pankaj@somaiya.edu',
  'medha@somaiya.edu', 'sshah@somaiya.edu', 'vsagvekar@somaiya.edu',
  'sarika@somaiya.edu', 'deepali.c@somaiya.edu', 'pravin.patil@somaiya.edu',
  'pradnya28@somaiya.edu', 'prashant.sb@somaiya.edu', 'bhagyashree.i@somaiya.edu',
  'skasar@somaiya.edu', 'kpashte@somaiya.edu', 'sdhale@somaiya.edu',
  'bharati@somaiya.edu', 'lokmat874@gmail.com'
)
or exists (
  select 1 from public.faculty_directory as f
  where lower(f.email) = lower(profiles.email) and f.is_active
);

-- 3. Update mycollege_private.current_role()
create or replace function mycollege_private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.faculty_directory as f
      where lower(f.email) = lower(p.email) and f.is_active
    ) then 'faculty'
    when lower(p.email) in (
      'mnemade@somaiya.edu', 'vwadhe@somaiya.edu', 'gwadmare@somaiya.edu',
      'devanandkb@somaiya.edu', 'sheetaljagtap@somaiya.edu', 'pankaj@somaiya.edu',
      'medha@somaiya.edu', 'sshah@somaiya.edu', 'vsagvekar@somaiya.edu',
      'sarika@somaiya.edu', 'deepali.c@somaiya.edu', 'pravin.patil@somaiya.edu',
      'pradnya28@somaiya.edu', 'prashant.sb@somaiya.edu', 'bhagyashree.i@somaiya.edu',
      'skasar@somaiya.edu', 'kpashte@somaiya.edu', 'sdhale@somaiya.edu',
      'bharati@somaiya.edu', 'lokmat874@gmail.com'
    ) then 'faculty'
    else coalesce(p.role, 'student')
  end
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

grant execute on function mycollege_private.current_role() to authenticated;

-- 4. Update author metadata trigger
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

  new.author_id := (select auth.uid());
  new.institution_id := coalesce(new.institution_id, author_profile.institution_id, '00000000-0000-4000-8000-000000000001'::uuid);
  new.author_name := coalesce(author_profile.full_name, split_part(coalesce(author_profile.email, ''), '@', 1), 'Faculty');
  new.author_role := coalesce(mycollege_private.current_role(), author_profile.role, 'faculty');
  return new;
end;
$$;

-- 5. Update guard_announcement_changes trigger to permit faculty direct publishing
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

-- 6. Update can_view_announcement so newly inserted announcements can be read immediately
create or replace function mycollege_private.can_view_announcement(
  target_announcement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.announcements as a
    left join public.profiles as p
      on p.id = (select auth.uid())
    where a.id = target_announcement_id
      and (
        a.author_id = (select auth.uid())
        or mycollege_private.current_role() in ('admin', 'faculty', 'teacher')
        or (
          p.institution_id = a.institution_id
          and a.status = 'published'
          and (
            a.audience_type = 'all'
            or (
              a.audience_type = 'department'
              and exists (
                select 1
                from public.announcement_departments as ad
                where ad.announcement_id = a.id
                  and ad.department_id = p.department_id
              )
            )
            or (
              a.audience_type = 'division'
              and exists (
                select 1
                from public.announcement_divisions as av
                join public.profile_divisions as pv
                  on pv.division_id = av.division_id
                 and pv.profile_id = p.id
                where av.announcement_id = a.id
              )
            )
            or (
              a.audience_type = 'course'
              and coalesce(a.audience_data -> 'courses', '[]'::jsonb)
                ? coalesce(p.course, '')
            )
            or (
              a.audience_type = 'year'
              and coalesce(a.audience_data -> 'years', '[]'::jsonb)
                ? coalesce(p.year, '')
            )
          )
        )
      )
  )
$$;

grant execute on function mycollege_private.can_view_announcement(uuid) to authenticated;

-- 7. Replace announcements_create_staff RLS policy
drop policy if exists announcements_create_staff on public.announcements;
create policy announcements_create_staff
  on public.announcements for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and mycollege_private.current_role() in ('teacher', 'faculty', 'coordinator', 'admin')
  );

commit;
