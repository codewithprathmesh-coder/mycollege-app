begin;

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
  existing_profile public.profiles%rowtype;
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

  select p.*
  into existing_profile
  from public.profiles as p
  where lower(p.email) = clean_email
  for update;

  if existing_profile.id is not null
    and (
      existing_profile.institution_id <> actor.institution_id
      or existing_profile.role <> 'student'
    )
  then
    raise exception 'A non-student profile already exists for this email address.'
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
      and b.email <> clean_email
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
    profile_id,
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
    existing_profile.id,
    actor.institution_id,
    clean_name,
    clean_roll_no,
    p_department_id,
    clean_year,
    p_division_id,
    clean_phone
  )
  on conflict (email) do update
  set profile_id = excluded.profile_id,
      full_name = excluded.full_name,
      roll_no = excluded.roll_no,
      department_id = excluded.department_id,
      academic_year = excluded.academic_year,
      division_id = excluded.division_id,
      phone = excluded.phone,
      updated_at = now();

  return jsonb_build_object('email', clean_email);
end
$$;

revoke all on function public.mycollege_add_batch_student(
  text, text, text, uuid, text, uuid, text
) from public, anon;
grant execute on function public.mycollege_add_batch_student(
  text, text, text, uuid, text, uuid, text
) to authenticated;

commit;
