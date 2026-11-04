begin;

create table if not exists public.channel_member_invites (
  channel_id uuid not null references public.channels(id) on delete cascade,
  email text not null,
  added_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, email),
  check (email = lower(btrim(email)))
);

alter table public.channel_member_invites enable row level security;
revoke all on public.channel_member_invites from public, anon, authenticated;

create or replace function mycollege_private.is_channel_member_or_division(
  target_channel_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.channels as c
    join public.profiles as p
      on p.id = (select auth.uid())
     and p.institution_id = c.institution_id
    where c.id = target_channel_id
      and (
        p.role in ('admin', 'faculty', 'teacher')
        or exists (
          select 1
          from public.channel_members as cm
          where cm.channel_id = c.id
            and cm.profile_id = p.id
            and cm.status = 'active'
        )
      )
  )
$$;

revoke all on function mycollege_private.is_channel_member_or_division(uuid)
  from public, anon;
grant execute on function mycollege_private.is_channel_member_or_division(uuid)
  to authenticated;

create or replace function public.mycollege_list_channel_member_candidates(
  p_channel_id uuid
)
returns table (
  id uuid,
  name text,
  email text,
  role text,
  designation text,
  roll_no text,
  membership_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorized_actor as (
    select c.id as channel_id, c.institution_id
    from public.channels as c
    join public.profiles as actor
      on actor.id = (select auth.uid())
     and actor.institution_id = c.institution_id
    where c.id = p_channel_id
      and (
        actor.role in ('faculty', 'teacher', 'admin')
        or mycollege_private.can_manage_channel(c.id)
      )
  ),
  eligible as (
    select
      p.id,
      coalesce(nullif(btrim(p.full_name), ''), p.email) as full_name,
      lower(p.email) as email,
      case when p.role in ('teacher', 'faculty') then 'faculty' else 'student' end as role,
      p.designation,
      batch.roll_no
    from public.profiles as p
    join authorized_actor as actor on actor.institution_id = p.institution_id
    left join public.mycollege_batch_directory as batch
      on batch.institution_id = p.institution_id
     and batch.email = lower(p.email)
    where p.role in ('student', 'teacher', 'faculty')

    union all

    select
      null::uuid,
      batch.full_name,
      batch.email,
      'student',
      null::text,
      batch.roll_no
    from public.mycollege_batch_directory as batch
    join authorized_actor as actor on actor.institution_id = batch.institution_id
    join public.approved_students as approved
      on approved.institution_id = batch.institution_id
     and approved.email = batch.email
     and approved.status = 'authorized'
    where not exists (
      select 1
      from public.profiles as p
      where p.institution_id = batch.institution_id
        and lower(p.email) = batch.email
    )

    union all

    select
      null::uuid,
      coalesce(nullif(btrim(approved.email), ''), approved.email),
      approved.email,
      'student',
      null::text,
      null::text
    from public.approved_students as approved
    join authorized_actor as actor on actor.institution_id = approved.institution_id
    where approved.status = 'authorized'
      and not exists (
        select 1
        from public.profiles as p
        where p.institution_id = approved.institution_id
          and lower(p.email) = approved.email
      )
      and not exists (
        select 1
        from public.mycollege_batch_directory as batch
        where batch.institution_id = approved.institution_id
          and batch.email = approved.email
      )

    union all

    select
      null::uuid,
      coalesce(nullif(btrim(faculty.full_name), ''), faculty.email),
      lower(faculty.email),
      'faculty',
      faculty.designation,
      null::text
    from public.faculty_directory as faculty
    join authorized_actor as actor on actor.institution_id = faculty.institution_id
    where faculty.is_active
      and not exists (
        select 1
        from public.profiles as p
        where p.institution_id = faculty.institution_id
          and lower(p.email) = lower(faculty.email)
      )
  )
  select
    eligible.id,
    eligible.full_name,
    eligible.email,
    eligible.role,
    eligible.designation,
    eligible.roll_no,
    case
      when eligible.id is not null and exists (
        select 1
        from public.channel_members as cm
        where cm.channel_id = actor.channel_id
          and cm.profile_id = eligible.id
          and cm.status = 'active'
      ) then 'active'
      when exists (
        select 1
        from public.channel_member_invites as invite
        where invite.channel_id = actor.channel_id
          and invite.email = eligible.email
      ) then 'pending'
      else 'not_added'
    end
  from eligible
  cross join authorized_actor as actor
  order by eligible.full_name, eligible.email
$$;

revoke all on function public.mycollege_list_channel_member_candidates(uuid)
  from public, anon;
grant execute on function public.mycollege_list_channel_member_candidates(uuid)
  to authenticated;

create or replace function public.mycollege_add_channel_member(
  p_channel_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target_channel public.channels%rowtype;
  target_profile public.profiles%rowtype;
  clean_email text := lower(btrim(p_email));
begin
  select p.* into actor
  from public.profiles as p
  where p.id = (select auth.uid());

  select c.* into target_channel
  from public.channels as c
  where c.id = p_channel_id;

  if actor.id is null
    or target_channel.id is null
    or actor.institution_id <> target_channel.institution_id
    or not (
      actor.role in ('faculty', 'teacher', 'admin')
      or mycollege_private.can_manage_channel(target_channel.id)
    )
  then
    raise exception 'You do not have permission to add members to this group.'
      using errcode = '42501';
  end if;

  if clean_email is null
    or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'A valid institutional email is required.'
      using errcode = '22023';
  end if;

  select p.* into target_profile
  from public.profiles as p
  where p.institution_id = target_channel.institution_id
    and lower(p.email) = clean_email
    and p.role in ('student', 'teacher', 'faculty');

  if target_profile.id is not null then
    insert into public.channel_members (channel_id, profile_id, role, status)
    values (target_channel.id, target_profile.id, 'member', 'active')
    on conflict (channel_id, profile_id)
    do update set status = 'active';

    delete from public.channel_member_invites
    where channel_id = target_channel.id
      and email = clean_email;

    return jsonb_build_object(
      'status', 'active',
      'profile_id', target_profile.id
    );
  end if;

  if not exists (
    select 1
    from public.approved_students as approved
    where approved.institution_id = target_channel.institution_id
      and approved.email = clean_email
      and approved.status = 'authorized'
  ) and not exists (
    select 1
    from public.faculty_directory as faculty
    where faculty.institution_id = target_channel.institution_id
      and lower(faculty.email) = clean_email
      and faculty.is_active
  ) then
    raise exception 'This person is not in the authorized student or faculty directory.'
      using errcode = 'P0002';
  end if;

  insert into public.channel_member_invites (channel_id, email, added_by)
  values (target_channel.id, clean_email, actor.id)
  on conflict (channel_id, email) do nothing;

  return jsonb_build_object('status', 'pending');
end
$$;

revoke all on function public.mycollege_add_channel_member(uuid, text)
  from public, anon;
grant execute on function public.mycollege_add_channel_member(uuid, text)
  to authenticated;

create or replace function mycollege_private.activate_channel_member_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channel_members (channel_id, profile_id, role, status)
  select invite.channel_id, new.id, 'member', 'active'
  from public.channel_member_invites as invite
  join public.channels as channel
    on channel.id = invite.channel_id
   and channel.institution_id = new.institution_id
  where invite.email = lower(new.email)
    and new.role in ('student', 'teacher', 'faculty')
  on conflict (channel_id, profile_id) do nothing;

  delete from public.channel_member_invites
  where email = lower(new.email)
    and exists (
      select 1
      from public.channels as channel
      where channel.id = channel_member_invites.channel_id
        and channel.institution_id = new.institution_id
    );

  return new;
end
$$;

revoke all on function mycollege_private.activate_channel_member_invites()
  from public, anon, authenticated;
drop trigger if exists activate_channel_member_invites on public.profiles;
create trigger activate_channel_member_invites
  after insert on public.profiles
  for each row execute function mycollege_private.activate_channel_member_invites();

commit;

notify pgrst, 'reload schema';
