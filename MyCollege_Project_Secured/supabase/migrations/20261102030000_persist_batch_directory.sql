begin;

create table if not exists public.mycollege_batch_directory (
  email text primary key
    check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  profile_id uuid unique
    references public.profiles(id) on delete set null,
  institution_id uuid not null
    references public.institutions(id) on delete cascade,
  full_name text not null,
  roll_no text not null,
  department_id uuid not null
    references public.departments(id) on delete restrict,
  academic_year text not null,
  division_id uuid not null
    references public.divisions(id) on delete restrict,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(full_name) between 2 and 100),
  check (char_length(roll_no) between 1 and 40),
  check (char_length(academic_year) between 1 and 40),
  check (phone is null or char_length(phone) between 7 and 20)
);

create unique index if not exists mycollege_batch_directory_roll_no_idx
  on public.mycollege_batch_directory (institution_id, lower(roll_no));

create index if not exists mycollege_batch_directory_filters_idx
  on public.mycollege_batch_directory (
    institution_id,
    department_id,
    division_id,
    academic_year
  );

alter table public.mycollege_batch_directory enable row level security;
alter table public.mycollege_batch_directory force row level security;
revoke all on table public.mycollege_batch_directory
  from public, anon, authenticated;
grant select on table public.mycollege_batch_directory to authenticated;

create policy mycollege_batch_directory_self_read
  on public.mycollege_batch_directory
  for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles as p
      where p.id = (select auth.uid())
        and p.email = mycollege_batch_directory.email
        and p.institution_id = mycollege_batch_directory.institution_id
    )
  );

create or replace function mycollege_private.link_batch_directory_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mycollege_batch_directory
  set profile_id = new.id,
      updated_at = now()
  where email = lower(new.email)
    and institution_id = new.institution_id
    and profile_id is null;
  return new;
end
$$;

revoke all on function mycollege_private.link_batch_directory_profile()
  from public, anon, authenticated;

drop trigger if exists mycollege_link_batch_directory_profile on public.profiles;
create trigger mycollege_link_batch_directory_profile
after insert on public.profiles
for each row execute function mycollege_private.link_batch_directory_profile();

update public.mycollege_batch_directory as batch
set profile_id = profile.id,
    updated_at = now()
from public.profiles as profile
where profile.email = batch.email
  and profile.institution_id = batch.institution_id
  and batch.profile_id is null;

create or replace function public.mycollege_add_batch_student(
  p_name text,
  p_email text,
  p_roll_no text,
  p_department_id uuid,
  p_year text,
  p_division_id uuid,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  existing_student public.approved_students%rowtype;
  clean_email text := lower(btrim(p_email));
  clean_name text := btrim(p_name);
  clean_roll_no text := btrim(p_roll_no);
  clean_year text := btrim(p_year);
  clean_phone text := nullif(btrim(p_phone), '');
  resolved_department_id uuid;
begin
  select p.*
  into actor
  from public.profiles as p
  where p.id = (select auth.uid());

  if actor.id is null or actor.role not in ('faculty', 'teacher', 'admin') then
    raise exception 'Faculty or administrative privileges are required.'
      using errcode = '42501';
  end if;

  if clean_email is null
    or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or clean_name is null
    or char_length(clean_name) not between 2 and 100
    or clean_roll_no is null
    or char_length(clean_roll_no) not between 1 and 40
    or clean_year is null
    or char_length(clean_year) not between 1 and 40
    or (clean_phone is not null and char_length(clean_phone) not between 7 and 20)
  then
    raise exception 'One or more student details are invalid.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.profiles as p
    where lower(p.email) = clean_email
  ) then
    raise exception 'A profile already exists for this email address.'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.approved_students as a
    where a.email = clean_email
      and a.institution_id <> actor.institution_id
  ) then
    raise exception 'This email is already registered to another institution.'
      using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.institutions as i
    where i.id = actor.institution_id
      and split_part(clean_email, '@', 2) = any(i.allowed_domains)
  ) then
    raise exception 'Student email must use an authorized institutional email domain.'
      using errcode = '22023';
  end if;

  select d.id
  into resolved_department_id
  from public.departments as d
  join public.divisions as v
    on v.id = p_division_id
   and v.institution_id = d.institution_id
   and v.department_id = d.id
  where d.id = p_department_id
    and d.institution_id = actor.institution_id;

  if resolved_department_id is null then
    raise exception 'The department and division must belong to your institution.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.mycollege_batch_directory as b
    where b.institution_id = actor.institution_id
      and lower(b.roll_no) = lower(clean_roll_no)
  ) then
    raise exception 'A student with this roll number already exists.'
      using errcode = '23505';
  end if;

  select a.*
  into existing_student
  from public.approved_students as a
  where a.email = clean_email
    and a.institution_id = actor.institution_id
  for update;

  if existing_student.email is null then
    insert into public.approved_students (email, institution_id, status)
    values (clean_email, actor.institution_id, 'authorized');
  else
    update public.approved_students
    set status = 'authorized',
        updated_at = now()
    where email = clean_email
      and institution_id = actor.institution_id;
  end if;

  insert into public.approved_student_divisions (student_email, division_id)
  values (clean_email, p_division_id)
  on conflict (student_email, division_id) do nothing;

  insert into public.mycollege_batch_directory (
    email,
    institution_id,
    full_name,
    roll_no,
    department_id,
    academic_year,
    division_id,
    phone
  )
  values (
    clean_email,
    actor.institution_id,
    clean_name,
    clean_roll_no,
    p_department_id,
    clean_year,
    p_division_id,
    clean_phone
  );

  return jsonb_build_object('email', clean_email);
end
$$;

revoke all on function public.mycollege_add_batch_student(
  text, text, text, uuid, text, uuid, text
) from public, anon;
grant execute on function public.mycollege_add_batch_student(
  text, text, text, uuid, text, uuid, text
) to authenticated;

create or replace function public.mycollege_count_batch_students(
  p_institution_id uuid,
  p_department_id uuid default null,
  p_division_id uuid default null,
  p_academic_year text default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  result_count bigint;
begin
  select p.*
  into actor
  from public.profiles as p
  where p.id = (select auth.uid());

  if actor.id is null or actor.institution_id <> p_institution_id then
    raise exception 'You cannot view another institution’s batch summary.'
      using errcode = '42501';
  end if;

  select count(*)
  into result_count
  from public.mycollege_batch_directory as b
  where b.institution_id = p_institution_id
    and (p_department_id is null or b.department_id = p_department_id)
    and (p_division_id is null or b.division_id = p_division_id)
    and (
      p_academic_year is null
      or b.academic_year = p_academic_year
      or (p_academic_year = '2nd Year' and b.academic_year = 'Second Year')
      or (p_academic_year = 'Second Year' and b.academic_year = '2nd Year')
    );

  return result_count;
end
$$;

revoke all on function public.mycollege_count_batch_students(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.mycollege_count_batch_students(uuid, uuid, uuid, text)
  to authenticated;

drop function if exists public.mycollege_list_institution_users(uuid);

create function public.mycollege_list_institution_users(
  p_institution_id uuid
)
returns table (
  id uuid,
  institution_id uuid,
  full_name text,
  email text,
  role text,
  department_id uuid,
  designation text,
  username text,
  phone text,
  avatar_url text,
  is_verified boolean,
  is_profile_completed boolean,
  terms_accepted_at timestamptz,
  division_ids uuid[],
  roll_no text,
  academic_year text,
  course text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    target.id,
    target.institution_id,
    target.full_name,
    target.email,
    target.role,
    target.department_id,
    target.designation,
    target.username,
    case when actor.role = 'admin' then coalesce(batch.phone, target.phone) else null end,
    target.avatar_url,
    target.is_verified,
    target.is_profile_completed,
    target.terms_accepted_at,
    coalesce(
      (
        select array_agg(pd.division_id order by pd.division_id)
        from public.profile_divisions as pd
        where pd.profile_id = target.id
      ),
      '{}'::uuid[]
    ),
    batch.roll_no,
    coalesce(batch.academic_year, target.year),
    target.course
  from public.profiles as actor
  join public.profiles as target
    on target.institution_id = actor.institution_id
  left join public.mycollege_batch_directory as batch
    on batch.email = target.email
   and batch.institution_id = target.institution_id
  where actor.id = (select auth.uid())
    and actor.institution_id = p_institution_id
  order by target.full_name, target.email
$$;

revoke all on function public.mycollege_list_institution_users(uuid)
  from public, anon;
grant execute on function public.mycollege_list_institution_users(uuid)
  to authenticated;

commit;
