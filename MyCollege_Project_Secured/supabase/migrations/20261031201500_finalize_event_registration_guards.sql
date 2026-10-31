begin;

alter table public.event_registrations
  add column if not exists registered_at timestamptz not null default now(),
  add column if not exists status text not null default 'confirmed',
  add column if not exists ticket_code text;

update public.event_registrations as er
set ticket_code =
  upper(regexp_replace(coalesce(i.short_name, 'COLLEGE'), '\s+', '', 'g'))
  || '-REG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
from public.announcements as a
join public.institutions as i
  on i.id = a.institution_id
where er.announcement_id = a.id
  and er.ticket_code is null;

create unique index if not exists event_registrations_profile_announcement_uidx
  on public.event_registrations (profile_id, announcement_id);

revoke update on public.event_registrations from authenticated;

create or replace function mycollege_private.guard_event_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  institution_short_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'An authenticated user is required to register for an event';
  end if;
  if not exists (
    select 1
    from public.announcements as a
    where a.id = new.announcement_id
      and a.status = 'published'
  ) or not mycollege_private.can_view_announcement(new.announcement_id) then
    raise exception 'Registration is allowed only for a visible announcement';
  end if;

  select i.short_name
  into institution_short_name
  from public.announcements as a
  join public.institutions as i
    on i.id = a.institution_id
  where a.id = new.announcement_id;

  new.profile_id := (select auth.uid());
  new.status := 'confirmed';
  new.registered_at := now();
  new.ticket_code :=
    upper(regexp_replace(coalesce(institution_short_name, 'COLLEGE'), '\s+', '', 'g'))
    || '-REG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  return new;
end;
$$;

revoke all on function mycollege_private.guard_event_registration()
  from public, anon, authenticated;

drop trigger if exists guard_event_registration
  on public.event_registrations;
create trigger guard_event_registration
  before insert on public.event_registrations
  for each row execute function mycollege_private.guard_event_registration();

commit;
