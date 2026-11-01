begin;

create or replace function public.mycollege_admin_save_approved_student(
  p_email text,
  p_division_ids uuid[],
  p_status text default null,
  p_new_email text default null,
  p_replace_divisions boolean default false,
  p_allow_create boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor_institution_id uuid;
  clean_email text := lower(btrim(p_email));
  clean_new_email text := nullif(lower(btrim(p_new_email)), '');
  effective_email text;
  resolved_status text;
  student public.approved_students%rowtype;
  existing_divisions uuid[] := '{}'::uuid[];
  requested_divisions uuid[] := '{}'::uuid[];
  saved_divisions uuid[] := '{}'::uuid[];
begin
  select p.institution_id
  into actor_institution_id
  from public.profiles as p
  where p.id = (select auth.uid())
    and p.role = 'admin';

  if actor_institution_id is null then
    raise exception 'Administrative privileges are required.'
      using errcode = '42501';
  end if;

  if clean_email is null
    or clean_email = ''
    or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'A valid student email address is required.'
      using errcode = '22023';
  end if;

  if clean_new_email is not null
    and clean_new_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'A valid replacement email address is required.'
      using errcode = '22023';
  end if;

  if p_status is not null and p_status not in ('authorized', 'revoked') then
    raise exception 'Student status must be authorized or revoked.'
      using errcode = '22023';
  end if;

  resolved_status := coalesce(p_status, 'authorized');
  effective_email := coalesce(clean_new_email, clean_email);

  if p_division_ids is not null then
    select coalesce(array_agg(distinct requested.id), '{}'::uuid[])
    into requested_divisions
    from unnest(p_division_ids) as requested(id);

    if cardinality(requested_divisions) = 0 then
      raise exception 'At least one division must be assigned.'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from unnest(requested_divisions) as requested(id)
      where not exists (
        select 1
        from public.divisions as d
        where d.id = requested.id
          and d.institution_id = actor_institution_id
      )
    ) then
      raise exception 'One or more selected divisions are not available in your institution.'
        using errcode = '22023';
    end if;
  end if;

  select a.*
  into student
  from public.approved_students as a
  where a.email = clean_email
    and a.institution_id = actor_institution_id
  for update;

  if not found and not p_allow_create then
    raise exception 'Student email not found in approved roster.'
      using errcode = 'P0002';
  end if;

  if not found then
    if p_division_ids is null then
      raise exception 'At least one division must be assigned.'
        using errcode = '22023';
    end if;

    insert into public.approved_students (email, institution_id, status)
    values (effective_email, actor_institution_id, resolved_status)
    returning * into student;
  else
    select coalesce(array_agg(ad.division_id), '{}'::uuid[])
    into existing_divisions
    from public.approved_student_divisions as ad
    where ad.student_email = clean_email;

    if effective_email <> clean_email then
      if exists (
        select 1
        from public.approved_students as a
        where a.email = effective_email
      ) then
        raise exception 'The replacement email is already in the approved roster.'
          using errcode = '23505';
      end if;

      delete from public.approved_student_divisions
      where student_email = clean_email;

      update public.approved_students
      set email = effective_email,
          status = resolved_status,
          registered_user_id = null,
          registered_at = null,
          updated_at = now()
      where email = clean_email
        and institution_id = actor_institution_id
      returning * into student;
    else
      update public.approved_students
      set status = resolved_status,
          updated_at = now()
      where email = clean_email
        and institution_id = actor_institution_id
      returning * into student;
    end if;
  end if;

  if p_replace_divisions then
    if p_division_ids is null then
      raise exception 'Division assignments are required when replacing divisions.'
        using errcode = '22023';
    end if;
    delete from public.approved_student_divisions
    where student_email = effective_email;
    saved_divisions := requested_divisions;
  else
    select coalesce(array_agg(distinct division_id), '{}'::uuid[])
    into saved_divisions
    from unnest(existing_divisions || requested_divisions) as membership(division_id);
  end if;

  insert into public.approved_student_divisions (student_email, division_id)
  select effective_email, membership.division_id
  from unnest(saved_divisions) as membership(division_id);

  return jsonb_build_object(
    'email', student.email,
    'status', student.status,
    'registered_user_id', student.registered_user_id,
    'registered_at', student.registered_at,
    'updated_at', student.updated_at,
    'division_ids', to_jsonb(saved_divisions)
  );
end;
$$;

revoke all on function public.mycollege_admin_save_approved_student(
  text, uuid[], text, text, boolean, boolean
) from public, anon;
grant execute on function public.mycollege_admin_save_approved_student(
  text, uuid[], text, text, boolean, boolean
) to authenticated;

create or replace function mycollege_private.sync_approved_student_division()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.profile_divisions as pd
    using public.profiles as p
    where p.id = pd.profile_id
      and p.email = old.student_email
      and pd.division_id = old.division_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.profile_divisions (profile_id, division_id)
    select p.id, new.division_id
    from public.profiles as p
    join public.approved_students as a
      on a.email = p.email
     and a.institution_id = p.institution_id
     and a.status = 'authorized'
    where p.email = new.student_email
    on conflict (profile_id, division_id) do nothing;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function mycollege_private.sync_approved_student_division()
  from public, anon, authenticated;

drop trigger if exists sync_approved_student_division
  on public.approved_student_divisions;
create trigger sync_approved_student_division
after insert or update or delete on public.approved_student_divisions
for each row execute function mycollege_private.sync_approved_student_division();

commit;
