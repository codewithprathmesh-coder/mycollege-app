begin;

alter table public.event_registrations
  add column if not exists registered_at timestamptz not null default now(),
  add column if not exists status text not null default 'confirmed',
  add column if not exists ticket_code text;

alter table public.event_registrations
  drop constraint if exists event_registrations_status_check;
alter table public.event_registrations
  add constraint event_registrations_status_check
  check (status in ('confirmed', 'waitlisted', 'cancelled'));

create index if not exists event_registrations_profile_created_idx
  on public.event_registrations (profile_id, registered_at desc);
create index if not exists event_registrations_announcement_idx
  on public.event_registrations (announcement_id);
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
  new.ticket_code := upper(regexp_replace(coalesce(institution_short_name, 'COLLEGE'), '\s+', '', 'g'))
    || '-REG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  return new;
end
$$;

create or replace function public.mycollege_notify_announcement(
  target_announcement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  announcement_row public.announcements%rowtype;
begin
  select a.*
  into announcement_row
  from public.announcements as a
  where a.id = target_announcement_id
    and a.author_id = (select auth.uid())
    and a.institution_id = mycollege_private.current_institution_id();
  if announcement_row.id is null then
    raise exception 'Announcement notification request is not authorized';
  end if;

  if announcement_row.status = 'pending_approval' then
    insert into public.notifications (
      institution_id,
      profile_id,
      announcement_id,
      title,
      message,
      type,
      is_read
    )
    select
      announcement_row.institution_id,
      p.id,
      announcement_row.id,
      'Review Required: Pending Announcement',
      coalesce(announcement_row.author_name, 'A college user') || ' submitted "' || announcement_row.title || '" for publication approval.',
      'approval',
      false
    from public.profiles as p
    where p.institution_id = announcement_row.institution_id
      and p.role = 'admin'
      and not exists (
        select 1
        from public.notifications as n
        where n.announcement_id = announcement_row.id
          and n.profile_id = p.id
          and n.type = 'approval'
      );
  elsif announcement_row.status = 'published' then
    insert into public.notifications (
      institution_id,
      profile_id,
      announcement_id,
      title,
      message,
      type,
      is_read
    )
    select
      announcement_row.institution_id,
      p.id,
      announcement_row.id,
      case when announcement_row.priority = 'urgent' then 'Urgent: ' || announcement_row.title else 'New: ' || announcement_row.title end,
      coalesce(announcement_row.publishing_department, 'College') || ': ' || left(announcement_row.title, 90),
      case when announcement_row.priority = 'urgent' then 'urgent' else 'announcement' end,
      false
    from public.profiles as p
    where p.institution_id = announcement_row.institution_id
      and p.id <> announcement_row.author_id
      and (
        announcement_row.audience_type = 'all'
        or (
          announcement_row.audience_type = 'department'
          and exists (
            select 1
            from public.announcement_departments as ad
            where ad.announcement_id = announcement_row.id
              and ad.department_id = p.department_id
          )
        )
        or (
          announcement_row.audience_type = 'division'
          and exists (
            select 1
            from public.announcement_divisions as ad
            join public.profile_divisions as pd
              on pd.division_id = ad.division_id
             and pd.profile_id = p.id
            where ad.announcement_id = announcement_row.id
          )
        )
        or (
          announcement_row.audience_type = 'course'
          and coalesce(announcement_row.audience_data -> 'courses', '[]'::jsonb)
            ? coalesce(p.course, '')
        )
        or (
          announcement_row.audience_type = 'year'
          and coalesce(announcement_row.audience_data -> 'years', '[]'::jsonb)
            ? coalesce(p.year, '')
        )
      )
      and not exists (
        select 1
        from public.notifications as n
        where n.announcement_id = announcement_row.id
          and n.profile_id = p.id
          and n.type in ('announcement', 'urgent')
      );
  end if;
end
$$;

create or replace function mycollege_private.notify_announcement_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('published', 'archived')
    and new.reviewed_by is not null
  then
    insert into public.notifications (
      institution_id,
      profile_id,
      announcement_id,
      title,
      message,
      type,
      is_read
    )
    values (
      new.institution_id,
      new.author_id,
      new.id,
      case when new.status = 'published' then 'Announcement Approved' else 'Announcement Declined' end,
      case
        when new.status = 'published'
          then 'Your announcement "' || new.title || '" has been approved and published.'
        else
          'Your submission "' || new.title || '" was declined: '
            || coalesce(new.rejection_reason, 'Does not meet institutional posting guidelines.')
      end,
      case when new.status = 'published' then 'announcement' else 'approval' end,
      false
    );
  end if;
  return new;
end
$$;

revoke all on function public.mycollege_notify_announcement(uuid)
  from public, anon, authenticated;
grant execute on function public.mycollege_notify_announcement(uuid)
  to authenticated;
revoke all on function mycollege_private.notify_announcement_review()
  from public, anon, authenticated;
revoke all on function mycollege_private.guard_event_registration()
  from public, anon, authenticated;

drop trigger if exists guard_event_registration
  on public.event_registrations;
create trigger guard_event_registration
  before insert on public.event_registrations
  for each row execute function mycollege_private.guard_event_registration();

drop trigger if exists notify_announcement_review
  on public.announcements;
create trigger notify_announcement_review
  after update of status on public.announcements
  for each row execute function mycollege_private.notify_announcement_review();

commit;
