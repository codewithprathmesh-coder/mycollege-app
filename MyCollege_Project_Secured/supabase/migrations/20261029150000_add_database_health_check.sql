begin;

create or replace function public.mycollege_health_check()
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select true
$$;

revoke all on function public.mycollege_health_check() from public;
grant execute on function public.mycollege_health_check() to anon, authenticated;

commit;
