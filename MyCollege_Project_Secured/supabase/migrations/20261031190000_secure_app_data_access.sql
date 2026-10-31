begin;

alter table public.announcements
  add column if not exists audience_data jsonb not null default '{}'::jsonb;

create table if not exists public.app_user_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  interests text[] not null default '{}'::text[],
  ordered_preferences text[] not null default '{}'::text[],
  notification_preferences jsonb not null default
    '{"academic":true,"events":true,"deadlines":true,"clubs":true}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint app_user_settings_ordered_preferences_count
    check (cardinality(ordered_preferences) in (0, 3)),
  constraint app_user_settings_notification_preferences_object
    check (
      jsonb_typeof(notification_preferences) = 'object'
      and jsonb_typeof(notification_preferences -> 'academic') = 'boolean'
      and jsonb_typeof(notification_preferences -> 'events') = 'boolean'
      and jsonb_typeof(notification_preferences -> 'deadlines') = 'boolean'
      and jsonb_typeof(notification_preferences -> 'clubs') = 'boolean'
    )
);

create schema if not exists mycollege_private;
revoke all on schema mycollege_private from public, anon;
grant usage on schema mycollege_private to authenticated;

create or replace function mycollege_private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

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
        c.division_id is null
        or exists (
          select 1
          from public.profile_divisions as pd
          where pd.profile_id = p.id
            and pd.division_id = c.division_id
        )
        or exists (
          select 1
          from public.channel_members as cm
          where cm.channel_id = c.id
            and cm.profile_id = p.id
            and cm.status = 'active'
        )
        or p.role in ('teacher', 'faculty', 'admin')
      )
  )
$$;

create or replace function mycollege_private.can_manage_channel(
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
        p.role in ('teacher', 'faculty', 'admin')
        or c.creator_id = p.id
        or exists (
          select 1
          from public.channel_members as cm
          where cm.channel_id = c.id
            and cm.profile_id = p.id
            and cm.role in ('admin', 'owner')
            and cm.status = 'active'
        )
      )
  )
$$;

create or replace function mycollege_private.can_post_to_channel(
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
    where c.id = target_channel_id
      and mycollege_private.is_channel_member_or_division(c.id)
      and (
        not c.only_admins_can_message
        or mycollege_private.can_manage_channel(c.id)
      )
  )
$$;

create or replace function mycollege_private.can_view_announcement(
  target_announcement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.announcements as a
    join public.profiles as p
      on p.id = (select auth.uid())
     and p.institution_id = a.institution_id
    where a.id = target_announcement_id
      and (
        p.role = 'admin'
        or a.author_id = p.id
        or (
          a.status = 'published'
          and (
            a.audience_type = 'all'
            or (
              a.audience_type = 'department'
              and exists (
                select 1
                from public.announcement_departments as ad
                where ad.announcement_id = a.id
                  and ad.department_id = p.department_id
              )
            )
            or (
              a.audience_type = 'division'
              and exists (
                select 1
                from public.announcement_divisions as av
                join public.profile_divisions as pv
                  on pv.division_id = av.division_id
                 and pv.profile_id = p.id
                where av.announcement_id = a.id
              )
            )
            or (
              a.audience_type = 'course'
              and coalesce(a.audience_data -> 'courses', '[]'::jsonb)
                ? coalesce(p.course, '')
            )
            or (
              a.audience_type = 'year'
              and coalesce(a.audience_data -> 'years', '[]'::jsonb)
                ? coalesce(p.year, '')
            )
          )
        )
      )
  )
$$;

create or replace function mycollege_private.guard_announcement_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := mycollege_private.current_role();
begin
  if tg_op = 'INSERT' then
    if new.is_official and actor_role not in ('faculty', 'admin') then
      raise exception 'Only faculty or administrators may publish official announcements';
    end if;
    if new.status = 'published'
      and actor_role <> 'admin'
      and exists (
        select 1
        from public.institutions as i
        where i.id = new.institution_id
          and i.require_approval
      )
    then
      raise exception 'This institution requires administrator approval';
    end if;
    if new.reviewed_by is not null or new.rejection_reason is not null then
      raise exception 'Only administrators may set announcement review fields';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
    or new.reviewed_by is distinct from old.reviewed_by
    or new.rejection_reason is distinct from old.rejection_reason
    or new.is_official is distinct from old.is_official
  then
    if actor_role <> 'admin' then
      raise exception 'Only administrators may change announcement review state';
    end if;
  end if;

  if new.is_pinned is distinct from old.is_pinned
    and actor_role not in ('faculty', 'admin')
  then
    raise exception 'Only faculty or administrators may pin announcements';
  end if;
  return new;
end
$$;

create or replace function mycollege_private.guard_channel_message_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if new.id is distinct from old.id
    or new.channel_id is distinct from old.channel_id
    or new.sender_id is distinct from old.sender_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Message identity and ownership fields cannot be changed';
  end if;

  if new.is_pinned is distinct from old.is_pinned
    or new.is_starred is distinct from old.is_starred
    or new.status is distinct from old.status
  then
    if not mycollege_private.can_manage_channel(old.channel_id) then
      raise exception 'Only channel managers may change message moderation fields';
    end if;
  end if;

  if new.is_deleted is distinct from old.is_deleted
    and old.sender_id is distinct from actor_id
    and not mycollege_private.can_manage_channel(old.channel_id)
  then
    raise exception 'Only the message author or a channel manager may delete a message';
  end if;
  return new;
end
$$;

revoke all on function mycollege_private.current_role()
  from public, anon, authenticated;
revoke all on function mycollege_private.is_channel_member_or_division(uuid)
  from public, anon, authenticated;
revoke all on function mycollege_private.can_manage_channel(uuid)
  from public, anon, authenticated;
revoke all on function mycollege_private.can_post_to_channel(uuid)
  from public, anon, authenticated;
revoke all on function mycollege_private.can_view_announcement(uuid)
  from public, anon, authenticated;
grant execute on function mycollege_private.current_role() to authenticated;
grant execute on function mycollege_private.is_channel_member_or_division(uuid) to authenticated;
grant execute on function mycollege_private.can_manage_channel(uuid) to authenticated;
grant execute on function mycollege_private.can_post_to_channel(uuid) to authenticated;
grant execute on function mycollege_private.can_view_announcement(uuid) to authenticated;
revoke all on function mycollege_private.guard_announcement_changes()
  from public, anon, authenticated;
revoke all on function mycollege_private.guard_channel_message_changes()
  from public, anon, authenticated;

grant select on public.institutions, public.departments, public.divisions to authenticated;
grant insert, update, delete on public.departments to authenticated;
grant update (require_approval, allowed_domains)
  on public.institutions to authenticated;
grant select, insert, update, delete
  on public.app_user_settings
  to authenticated;
grant select, insert, update, delete
  on public.approved_students, public.approved_student_divisions,
     public.faculty_directory, public.profile_divisions,
     public.user_preferences, public.notification_preferences,
     public.announcements, public.announcement_attachments,
     public.announcement_departments, public.announcement_divisions,
     public.announcement_saves, public.announcement_views,
     public.event_registrations, public.notifications, public.audit_logs,
     public.channels, public.channel_members, public.channel_messages,
     public.message_reactions, public.channel_polls, public.poll_options,
     public.poll_votes, public.channel_announcements
  to authenticated;
revoke all on public.approved_students, public.approved_student_divisions,
  public.faculty_directory, public.profile_divisions, public.user_preferences,
  public.notification_preferences, public.announcements,
  public.announcement_attachments, public.announcement_departments,
  public.announcement_divisions, public.announcement_saves,
  public.announcement_views, public.event_registrations, public.notifications,
  public.audit_logs, public.channels, public.channel_members,
  public.channel_messages, public.message_reactions, public.channel_polls,
  public.poll_options, public.poll_votes, public.channel_announcements
  from public, anon;
revoke all on public.app_user_settings from public, anon;

alter table public.approved_students enable row level security;
alter table public.approved_student_divisions enable row level security;
alter table public.faculty_directory enable row level security;
alter table public.profile_divisions enable row level security;
alter table public.user_preferences enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.app_user_settings enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_attachments enable row level security;
alter table public.announcement_departments enable row level security;
alter table public.announcement_divisions enable row level security;
alter table public.announcement_saves enable row level security;
alter table public.announcement_views enable row level security;
alter table public.event_registrations enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.channel_messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.channel_polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.channel_announcements enable row level security;

drop trigger if exists guard_announcement_changes
  on public.announcements;
create trigger guard_announcement_changes
  before insert or update on public.announcements
  for each row execute function mycollege_private.guard_announcement_changes();
drop trigger if exists guard_channel_message_changes
  on public.channel_messages;
create trigger guard_channel_message_changes
  before update on public.channel_messages
  for each row execute function mycollege_private.guard_channel_message_changes();

create policy approved_students_admin_access
  on public.approved_students for all to authenticated
  using (
    institution_id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  )
  with check (
    institution_id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  );

create policy approved_student_divisions_admin_access
  on public.approved_student_divisions for all to authenticated
  using (
    mycollege_private.current_role() = 'admin'
    and exists (
      select 1
      from public.approved_students as s
      join public.divisions as d
        on d.institution_id = s.institution_id
      where lower(s.email) = lower(approved_student_divisions.student_email)
        and d.id = approved_student_divisions.division_id
        and s.institution_id = mycollege_private.current_institution_id()
    )
  )
  with check (
    mycollege_private.current_role() = 'admin'
    and exists (
      select 1
      from public.approved_students as s
      join public.divisions as d
        on d.institution_id = s.institution_id
      where lower(s.email) = lower(approved_student_divisions.student_email)
        and d.id = approved_student_divisions.division_id
        and s.institution_id = mycollege_private.current_institution_id()
    )
  );

create policy faculty_directory_admin_access
  on public.faculty_directory for all to authenticated
  using (
    institution_id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  )
  with check (
    institution_id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  );

create policy profile_divisions_read_self_or_staff
  on public.profile_divisions for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      mycollege_private.is_staff_for_institution(mycollege_private.current_institution_id())
      and exists (
        select 1
        from public.profiles as p
        join public.divisions as d
          on d.id = profile_divisions.division_id
        where p.id = profile_divisions.profile_id
          and p.institution_id = mycollege_private.current_institution_id()
          and d.institution_id = p.institution_id
      )
    )
  );

create policy profile_divisions_admin_manage
  on public.profile_divisions for all to authenticated
  using (
    mycollege_private.current_role() = 'admin'
    and exists (
      select 1
      from public.profiles as p
      join public.divisions as d
        on d.id = profile_divisions.division_id
      where p.id = profile_divisions.profile_id
        and p.institution_id = mycollege_private.current_institution_id()
        and d.institution_id = p.institution_id
    )
  )
  with check (
    mycollege_private.current_role() = 'admin'
    and exists (
      select 1
      from public.profiles as p
      join public.divisions as d
        on d.id = profile_divisions.division_id
      where p.id = profile_divisions.profile_id
        and p.institution_id = mycollege_private.current_institution_id()
        and d.institution_id = p.institution_id
    )
  );

create policy app_user_settings_self_access
  on public.app_user_settings for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy user_preferences_self_access
  on public.user_preferences for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy notification_preferences_self_access
  on public.notification_preferences for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy institutions_read_current
  on public.institutions for select to authenticated
  using (id = mycollege_private.current_institution_id());

create policy institutions_admin_update_current
  on public.institutions for update to authenticated
  using (
    id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  )
  with check (
    id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  );

create policy departments_read_current
  on public.departments for select to authenticated
  using (institution_id = mycollege_private.current_institution_id());
create policy departments_admin_manage_current
  on public.departments for all to authenticated
  using (
    institution_id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  )
  with check (
    institution_id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  );

create policy divisions_read_current
  on public.divisions for select to authenticated
  using (institution_id = mycollege_private.current_institution_id());

create policy announcements_read_authorized
  on public.announcements for select to authenticated
  using (mycollege_private.can_view_announcement(id));

create policy announcements_create_staff
  on public.announcements for insert to authenticated
  with check (
    institution_id = mycollege_private.current_institution_id()
    and author_id = (select auth.uid())
    and mycollege_private.current_role() in ('teacher', 'faculty', 'coordinator', 'admin')
  );

create policy announcements_update_author_or_staff
  on public.announcements for update to authenticated
  using (
    institution_id = mycollege_private.current_institution_id()
    and (
      author_id = (select auth.uid())
      or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
    )
  )
  with check (
    institution_id = mycollege_private.current_institution_id()
    and (
      author_id = (select auth.uid())
      or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
    )
  );

create policy announcements_delete_author_or_staff
  on public.announcements for delete to authenticated
  using (
    institution_id = mycollege_private.current_institution_id()
    and (
      author_id = (select auth.uid())
      or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
    )
  );

create policy announcement_children_read_visible
  on public.announcement_attachments for select to authenticated
  using (mycollege_private.can_view_announcement(announcement_id));
drop policy if exists announcement_children_insert_staff
  on public.announcement_attachments;
create policy announcement_attachments_manage_author_or_staff
  on public.announcement_attachments for all to authenticated
  using (
    exists (
      select 1 from public.announcements a
      where a.id = announcement_id
        and a.institution_id = mycollege_private.current_institution_id()
        and (
          a.author_id = (select auth.uid())
          or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
        )
    )
  )
  with check (
    exists (
      select 1 from public.announcements a
      where a.id = announcement_id
        and a.institution_id = mycollege_private.current_institution_id()
        and (
          a.author_id = (select auth.uid())
          or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
        )
    )
  );
create policy announcement_departments_read_visible
  on public.announcement_departments for select to authenticated
  using (mycollege_private.can_view_announcement(announcement_id));
create policy announcement_departments_write_author
  on public.announcement_departments for all to authenticated
  using (
    exists (
      select 1
      from public.announcements a
      join public.departments d
        on d.id = announcement_departments.department_id
      where a.id = announcement_id
        and a.institution_id = mycollege_private.current_institution_id()
        and d.institution_id = a.institution_id
        and (
          a.author_id = (select auth.uid())
          or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
        )
    )
  )
  with check (
    exists (
      select 1
      from public.announcements a
      join public.departments d
        on d.id = announcement_departments.department_id
      where a.id = announcement_id
        and a.institution_id = mycollege_private.current_institution_id()
        and d.institution_id = a.institution_id
        and (
          a.author_id = (select auth.uid())
          or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
        )
    )
  );
create policy announcement_divisions_read_visible
  on public.announcement_divisions for select to authenticated
  using (mycollege_private.can_view_announcement(announcement_id));
create policy announcement_divisions_write_author
  on public.announcement_divisions for all to authenticated
  using (
    exists (
      select 1
      from public.announcements a
      join public.divisions d
        on d.id = announcement_divisions.division_id
      where a.id = announcement_id
        and a.institution_id = mycollege_private.current_institution_id()
        and d.institution_id = a.institution_id
        and (
          a.author_id = (select auth.uid())
          or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
        )
    )
  )
  with check (
    exists (
      select 1
      from public.announcements a
      join public.divisions d
        on d.id = announcement_divisions.division_id
      where a.id = announcement_id
        and a.institution_id = mycollege_private.current_institution_id()
        and d.institution_id = a.institution_id
        and (
          a.author_id = (select auth.uid())
          or mycollege_private.current_role() in ('teacher', 'faculty', 'admin')
        )
    )
  );
create policy announcement_saves_self_access
  on public.announcement_saves for all to authenticated
  using (
    profile_id = (select auth.uid())
    and mycollege_private.can_view_announcement(announcement_id)
  )
  with check (
    profile_id = (select auth.uid())
    and mycollege_private.can_view_announcement(announcement_id)
  );
create policy announcement_views_read_self_or_staff
  on public.announcement_views for select to authenticated
  using (
    profile_id = (select auth.uid())
    or mycollege_private.is_staff_for_institution(
      mycollege_private.current_institution_id()
    )
  );
create policy announcement_views_insert_self
  on public.announcement_views for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and mycollege_private.can_view_announcement(announcement_id)
  );

create policy event_registrations_read_self_or_staff
  on public.event_registrations for select to authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.announcements a
      where a.id = announcement_id
        and mycollege_private.is_staff_for_institution(a.institution_id)
    )
  );
create policy event_registrations_insert_self
  on public.event_registrations for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and mycollege_private.can_view_announcement(announcement_id)
  );
create policy event_registrations_update_self_or_staff
  on public.event_registrations for update to authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.announcements a
      where a.id = announcement_id
        and mycollege_private.is_staff_for_institution(a.institution_id)
    )
  )
  with check (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.announcements a
      where a.id = announcement_id
        and mycollege_private.is_staff_for_institution(a.institution_id)
    )
  );
create policy event_registrations_delete_self_or_staff
  on public.event_registrations for delete to authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.announcements a
      where a.id = announcement_id
        and mycollege_private.is_staff_for_institution(a.institution_id)
    )
  );

create policy notifications_read_self
  on public.notifications for select to authenticated
  using (profile_id = (select auth.uid()));
create policy notifications_insert_self_or_staff
  on public.notifications for insert to authenticated
  with check (
    institution_id = mycollege_private.current_institution_id()
    and (
      profile_id = (select auth.uid())
      or mycollege_private.is_staff_for_institution(institution_id)
    )
  );
create policy notifications_update_read_self
  on public.notifications for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
grant update (is_read) on public.notifications to authenticated;
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;

create policy audit_logs_read_admin
  on public.audit_logs for select to authenticated
  using (
    institution_id = mycollege_private.current_institution_id()
    and mycollege_private.current_role() = 'admin'
  );
create policy audit_logs_insert_self
  on public.audit_logs for insert to authenticated
  with check (
    institution_id = mycollege_private.current_institution_id()
    and profile_id = (select auth.uid())
  );

create policy channels_read_authorized
  on public.channels for select to authenticated
  using (
    institution_id = mycollege_private.current_institution_id()
    and mycollege_private.is_channel_member_or_division(id)
  );
create policy channels_insert_staff
  on public.channels for insert to authenticated
  with check (
    institution_id = mycollege_private.current_institution_id()
    and creator_id = (select auth.uid())
    and mycollege_private.current_role() in ('teacher', 'faculty', 'coordinator', 'admin')
  );
create policy channels_update_manager
  on public.channels for update to authenticated
  using (mycollege_private.can_manage_channel(id))
  with check (mycollege_private.can_manage_channel(id));
create policy channels_delete_manager
  on public.channels for delete to authenticated
  using (mycollege_private.can_manage_channel(id));

create policy channel_members_read_channel_access
  on public.channel_members for select to authenticated
  using (mycollege_private.is_channel_member_or_division(channel_id));
create policy channel_members_insert_self_or_manager
  on public.channel_members for insert to authenticated
  with check (
    (profile_id = (select auth.uid())
      and mycollege_private.is_channel_member_or_division(channel_id))
    or mycollege_private.can_manage_channel(channel_id)
  );
create policy channel_members_update_manager
  on public.channel_members for update to authenticated
  using (mycollege_private.can_manage_channel(channel_id))
  with check (mycollege_private.can_manage_channel(channel_id));
create policy channel_members_delete_self_or_manager
  on public.channel_members for delete to authenticated
  using (
    profile_id = (select auth.uid())
    or mycollege_private.can_manage_channel(channel_id)
  );

create policy channel_messages_read_member
  on public.channel_messages for select to authenticated
  using (mycollege_private.is_channel_member_or_division(channel_id));
create policy channel_messages_insert_self_member
  on public.channel_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and mycollege_private.can_post_to_channel(channel_id)
  );
create policy channel_messages_update_author_or_manager
  on public.channel_messages for update to authenticated
  using (
    (
      sender_id = (select auth.uid())
      and mycollege_private.is_channel_member_or_division(channel_id)
    )
    or mycollege_private.can_manage_channel(channel_id)
  )
  with check (
    (
      sender_id = (select auth.uid())
      and mycollege_private.is_channel_member_or_division(channel_id)
    )
    or mycollege_private.can_manage_channel(channel_id)
  );
create policy channel_messages_delete_author_or_manager
  on public.channel_messages for delete to authenticated
  using (
    sender_id = (select auth.uid())
    or mycollege_private.can_manage_channel(channel_id)
  );

create policy message_reactions_read_member
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.channel_messages m
      where m.id = message_id
        and mycollege_private.is_channel_member_or_division(m.channel_id)
    )
  );
create policy message_reactions_insert_self
  on public.message_reactions for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.channel_messages m
      where m.id = message_id
        and mycollege_private.is_channel_member_or_division(m.channel_id)
    )
  );
create policy message_reactions_delete_self
  on public.message_reactions for delete to authenticated
  using (profile_id = (select auth.uid()));

create policy channel_polls_read_member
  on public.channel_polls for select to authenticated
  using (mycollege_private.is_channel_member_or_division(channel_id));
create policy channel_polls_insert_member
  on public.channel_polls for insert to authenticated
  with check (mycollege_private.can_post_to_channel(channel_id));
create policy channel_polls_update_manager
  on public.channel_polls for update to authenticated
  using (mycollege_private.can_manage_channel(channel_id))
  with check (mycollege_private.can_manage_channel(channel_id));
create policy channel_polls_delete_manager
  on public.channel_polls for delete to authenticated
  using (mycollege_private.can_manage_channel(channel_id));

create policy poll_options_read_member
  on public.poll_options for select to authenticated
  using (
    exists (
      select 1 from public.channel_polls cp
      where cp.id = poll_id
        and mycollege_private.is_channel_member_or_division(cp.channel_id)
    )
  );
create policy poll_options_insert_member
  on public.poll_options for insert to authenticated
  with check (
    exists (
      select 1 from public.channel_polls cp
      where cp.id = poll_id
        and mycollege_private.can_post_to_channel(cp.channel_id)
    )
  );
create policy poll_options_delete_manager
  on public.poll_options for delete to authenticated
  using (
    exists (
      select 1 from public.channel_polls cp
      where cp.id = poll_id
        and mycollege_private.can_manage_channel(cp.channel_id)
    )
  );
create policy poll_options_update_manager
  on public.poll_options for update to authenticated
  using (
    exists (
      select 1 from public.channel_polls cp
      where cp.id = poll_id
        and mycollege_private.can_manage_channel(cp.channel_id)
    )
  )
  with check (
    exists (
      select 1 from public.channel_polls cp
      where cp.id = poll_id
        and mycollege_private.can_manage_channel(cp.channel_id)
    )
  );

create policy poll_votes_read_member
  on public.poll_votes for select to authenticated
  using (
    exists (
      select 1 from public.channel_polls cp
      where cp.id = poll_id
        and mycollege_private.is_channel_member_or_division(cp.channel_id)
    )
  );
create policy poll_votes_insert_self_member
  on public.poll_votes for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.channel_polls cp
      where cp.id = poll_id
        and mycollege_private.can_post_to_channel(cp.channel_id)
    )
  );
create policy poll_votes_delete_self
  on public.poll_votes for delete to authenticated
  using (profile_id = (select auth.uid()));

create policy channel_announcements_read_member
  on public.channel_announcements for select to authenticated
  using (mycollege_private.is_channel_member_or_division(channel_id));
create policy channel_announcements_insert_manager
  on public.channel_announcements for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and mycollege_private.can_manage_channel(channel_id)
  );
create policy channel_announcements_update_manager
  on public.channel_announcements for update to authenticated
  using (mycollege_private.can_manage_channel(channel_id))
  with check (mycollege_private.can_manage_channel(channel_id));
create policy channel_announcements_delete_manager
  on public.channel_announcements for delete to authenticated
  using (mycollege_private.can_manage_channel(channel_id));

commit;
