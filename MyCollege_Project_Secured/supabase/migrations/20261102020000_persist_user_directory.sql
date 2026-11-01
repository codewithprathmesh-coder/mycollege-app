begin;

create or replace function public.mycollege_list_institution_users(
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
  division_ids uuid[]
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
    case when actor.role = 'admin' then target.phone else null end,
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
    )
  from public.profiles as actor
  join public.profiles as target
    on target.institution_id = actor.institution_id
  where actor.id = (select auth.uid())
    and actor.institution_id = p_institution_id
  order by target.full_name, target.email
$$;

revoke all on function public.mycollege_list_institution_users(uuid)
  from public, anon;
grant execute on function public.mycollege_list_institution_users(uuid)
  to authenticated;

create or replace function public.mycollege_admin_update_profile_role(
  p_profile_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
begin
  select p.*
  into actor
  from public.profiles as p
  where p.id = (select auth.uid());

  if actor.id is null or actor.role <> 'admin' then
    raise exception 'Administrative privileges are required.'
      using errcode = '42501';
  end if;

  if p_role not in ('student', 'faculty', 'coordinator', 'admin') then
    raise exception 'The requested role is not supported.'
      using errcode = '22023';
  end if;

  if p_profile_id = actor.id then
    raise exception 'Administrators cannot change their own role.'
      using errcode = '42501';
  end if;

  select p.*
  into target
  from public.profiles as p
  where p.id = p_profile_id
  for update;

  if target.id is null then
    raise exception 'User profile not found.'
      using errcode = 'P0002';
  end if;

  if target.institution_id <> actor.institution_id then
    raise exception 'You cannot modify users from another institution.'
      using errcode = '42501';
  end if;

  update public.profiles
  set role = p_role,
      updated_at = now()
  where id = target.id
  returning * into target;

  delete from public.mycollege_server_sessions
  where profile_id = target.id;

  return jsonb_build_object(
    'id', target.id,
    'institution_id', target.institution_id,
    'full_name', target.full_name,
    'email', target.email,
    'role', target.role,
    'department_id', target.department_id,
    'designation', target.designation,
    'username', target.username,
    'avatar_url', target.avatar_url,
    'is_verified', target.is_verified,
    'is_profile_completed', target.is_profile_completed,
    'terms_accepted_at', target.terms_accepted_at
  );
end
$$;

revoke all on function public.mycollege_admin_update_profile_role(uuid, text)
  from public, anon;
grant execute on function public.mycollege_admin_update_profile_role(uuid, text)
  to authenticated;

commit;
