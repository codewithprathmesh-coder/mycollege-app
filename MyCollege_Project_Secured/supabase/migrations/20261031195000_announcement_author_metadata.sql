begin;

alter table public.announcements
  add column if not exists author_name text,
  add column if not exists author_role text;

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
  where p.id = (select auth.uid())
    and p.institution_id = new.institution_id;

  if author_profile.id is null then
    raise exception 'Announcement author must have a profile in this institution';
  end if;

  new.author_id := author_profile.id;
  new.author_name := author_profile.full_name;
  new.author_role := author_profile.role;
  return new;
end
$$;

revoke all on function mycollege_private.set_announcement_author_metadata()
  from public, anon, authenticated;

drop trigger if exists set_announcement_author_metadata
  on public.announcements;
create trigger set_announcement_author_metadata
  before insert on public.announcements
  for each row execute function mycollege_private.set_announcement_author_metadata();

create or replace function public.mycollege_announcement_metrics(
  requested_ids uuid[]
)
returns table (
  announcement_id uuid,
  views bigint,
  saves bigint,
  registrations bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    (select count(*) from public.announcement_views av where av.announcement_id = a.id),
    (select count(*) from public.announcement_saves as av where av.announcement_id = a.id),
    (select count(*) from public.event_registrations as er where er.announcement_id = a.id)
  from public.announcements as a
  join public.profiles as p
    on p.id = (select auth.uid())
   and p.institution_id = a.institution_id
  where a.id = any(requested_ids)
    and mycollege_private.can_view_announcement(a.id)
$$;

revoke all on function public.mycollege_announcement_metrics(uuid[])
  from public, anon;
grant execute on function public.mycollege_announcement_metrics(uuid[])
  to authenticated;

commit;
