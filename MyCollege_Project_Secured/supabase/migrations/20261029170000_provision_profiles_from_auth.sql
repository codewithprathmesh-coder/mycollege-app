begin;

create or replace function public.mycollege_provision_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  student public.approved_students%rowtype;
  faculty public.faculty_directory%rowtype;
  resolved_role text;
  resolved_institution_id uuid;
  resolved_department_id uuid;
  resolved_full_name text;
begin
  if new.email is null then
    raise exception 'College email address is required.'
      using errcode = '42501';
  end if;

  select a.*
  into student
  from public.approved_students as a
  where a.email = lower(new.email)
    and a.status = 'authorized';

  select f.*
  into faculty
  from public.faculty_directory as f
  where f.email = lower(new.email)
    and f.is_active;

  if student.email is null and faculty.id is null then
    raise exception 'This email is not authorized to create a MyCollege account.'
      using errcode = '42501';
  end if;

  if faculty.id is not null then
    resolved_role := 'faculty';
    resolved_institution_id := faculty.institution_id;
    resolved_department_id := faculty.department_id;
    resolved_full_name := faculty.full_name;
  else
    resolved_role := 'student';
    resolved_institution_id := student.institution_id;

    select d.department_id
    into resolved_department_id
    from public.approved_student_divisions as ad
    join public.divisions as d on d.id = ad.division_id
    where ad.student_email = lower(new.email)
      and d.institution_id = student.institution_id
    order by d.created_at, d.id
    limit 1;

    resolved_full_name := nullif(new.raw_user_meta_data ->> 'full_name', '');
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    institution_id,
    department_id,
    designation,
    is_verified,
    is_profile_completed
  )
  values (
    new.id,
    lower(new.email),
    coalesce(
      resolved_full_name,
      split_part(lower(new.email), '@', 1)
    ),
    resolved_role,
    resolved_institution_id,
    resolved_department_id,
    case when faculty.id is not null then faculty.designation else null end,
    new.email_confirmed_at is not null,
    false
  )
  on conflict (id) do nothing;

  if student.email is not null then
    insert into public.profile_divisions (profile_id, division_id)
    select new.id, ad.division_id
    from public.approved_student_divisions as ad
    join public.divisions as d on d.id = ad.division_id
    where ad.student_email = lower(new.email)
      and d.institution_id = student.institution_id
    on conflict (profile_id, division_id) do nothing;

    update public.approved_students
    set registered_user_id = new.id,
        registered_at = coalesce(registered_at, now()),
        updated_at = now()
    where email = lower(new.email)
      and status = 'authorized';
  end if;

  return new;
end
$$;

create or replace function public.mycollege_sync_auth_email_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set is_verified = (new.email_confirmed_at is not null),
      updated_at = now()
  where id = new.id;

  return new;
end
$$;

revoke all on function public.mycollege_provision_auth_profile()
  from public, anon, authenticated;
revoke all on function public.mycollege_sync_auth_email_verification()
  from public, anon, authenticated;

drop trigger if exists mycollege_provision_auth_profile on auth.users;
create trigger mycollege_provision_auth_profile
after insert on auth.users
for each row execute function public.mycollege_provision_auth_profile();

drop trigger if exists mycollege_sync_auth_email_verification on auth.users;
create trigger mycollege_sync_auth_email_verification
after update of email_confirmed_at on auth.users
for each row
when (new.email_confirmed_at is distinct from old.email_confirmed_at)
execute function public.mycollege_sync_auth_email_verification();

insert into public.profiles (
  id,
  email,
  full_name,
  role,
  institution_id,
  department_id,
  designation,
  is_verified,
  is_profile_completed
)
select
  u.id,
  lower(u.email),
  coalesce(
    f.full_name,
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    split_part(lower(u.email), '@', 1)
  ),
  case when f.id is not null then 'faculty' else 'student' end,
  coalesce(f.institution_id, a.institution_id),
  coalesce(f.department_id, d.department_id),
  f.designation,
  u.email_confirmed_at is not null,
  false
from auth.users as u
left join public.approved_students as a
  on a.email = lower(u.email)
  and a.status = 'authorized'
left join public.faculty_directory as f
  on f.email = lower(u.email)
  and f.is_active
left join lateral (
  select v.department_id
  from public.approved_student_divisions as ad
  join public.divisions as v on v.id = ad.division_id
  where ad.student_email = lower(u.email)
    and v.institution_id = a.institution_id
  order by v.created_at, v.id
  limit 1
) as d on true
where u.email is not null
  and (a.email is not null or f.id is not null)
on conflict (id) do nothing;

insert into public.profile_divisions (profile_id, division_id)
select p.id, ad.division_id
from public.profiles as p
join public.approved_student_divisions as ad
  on ad.student_email = p.email
join public.divisions as d
  on d.id = ad.division_id
 and d.institution_id = p.institution_id
where p.role = 'student'
on conflict (profile_id, division_id) do nothing;

update public.approved_students as a
set registered_user_id = p.id,
    registered_at = coalesce(a.registered_at, now()),
    updated_at = now()
from public.profiles as p
where p.email = a.email
  and a.status = 'authorized'
  and a.registered_user_id is distinct from p.id;

commit;
