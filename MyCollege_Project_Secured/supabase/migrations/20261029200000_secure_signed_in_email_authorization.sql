begin;

drop function if exists public.mycollege_is_authorized_email(text);

create or replace function public.mycollege_is_authorized_email()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as u
    join public.approved_students as a
      on a.email = lower(u.email)
    where u.id = (select auth.uid())
      and a.status = 'authorized'
  )
  or exists (
    select 1
    from auth.users as u
    join public.faculty_directory as f
      on f.email = lower(u.email)
    where u.id = (select auth.uid())
      and f.is_active
  )
$$;

revoke all on function public.mycollege_is_authorized_email()
  from public, anon, authenticated;
grant execute on function public.mycollege_is_authorized_email()
  to authenticated;

commit;
