begin;

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
        p.role = 'admin'
        or exists (
          select 1
          from public.channel_members as cm
          where cm.channel_id = c.id
            and cm.profile_id = p.id
            and cm.status = 'active'
        )
        or (
          c.type = 'class'
          and c.division_id is not null
          and exists (
            select 1
            from public.profile_divisions as pd
            where pd.profile_id = p.id
              and pd.division_id = c.division_id
          )
        )
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
        p.role = 'admin'
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

revoke all on function mycollege_private.is_channel_member_or_division(uuid)
  from public, anon;
revoke all on function mycollege_private.can_manage_channel(uuid)
  from public, anon;
grant execute on function mycollege_private.is_channel_member_or_division(uuid)
  to authenticated;
grant execute on function mycollege_private.can_manage_channel(uuid)
  to authenticated;

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'channels',
        'channel_members',
        'channel_messages',
        'message_reactions',
        'channel_polls',
        'channel_announcements',
        'mycollege_poll_options',
        'mycollege_poll_votes'
      )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end
$$;

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
    (
      profile_id = (select auth.uid())
      and mycollege_private.is_channel_member_or_division(channel_id)
    )
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
    (
      sender_id = (select auth.uid())
      and mycollege_private.is_channel_member_or_division(channel_id)
    )
    or mycollege_private.can_manage_channel(channel_id)
  );

create policy message_reactions_read_member
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.channel_messages as m
      where m.id = message_id
        and mycollege_private.is_channel_member_or_division(m.channel_id)
    )
  );
create policy message_reactions_insert_self
  on public.message_reactions for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.channel_messages as m
      where m.id = message_id
        and mycollege_private.is_channel_member_or_division(m.channel_id)
    )
  );
create policy message_reactions_delete_self
  on public.message_reactions for delete to authenticated
  using (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.channel_messages as m
      where m.id = message_id
        and mycollege_private.is_channel_member_or_division(m.channel_id)
    )
  );

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

create policy mycollege_poll_options_read_member
  on public.mycollege_poll_options for select to authenticated
  using (
    exists (
      select 1
      from public.channel_polls as cp
      where cp.id = poll_id
        and mycollege_private.is_channel_member_or_division(cp.channel_id)
    )
  );
create policy mycollege_poll_options_insert_creator
  on public.mycollege_poll_options for insert to authenticated
  with check (
    exists (
      select 1
      from public.channel_polls as cp
      where cp.id = poll_id
        and cp.created_by = (select auth.uid())
        and mycollege_private.can_post_to_channel(cp.channel_id)
    )
  );
create policy mycollege_poll_votes_read_member
  on public.mycollege_poll_votes for select to authenticated
  using (
    exists (
      select 1
      from public.channel_polls as cp
      where cp.id = poll_id
        and mycollege_private.is_channel_member_or_division(cp.channel_id)
    )
  );
create policy mycollege_poll_votes_insert_self_member
  on public.mycollege_poll_votes for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.channel_polls as cp
      where cp.id = poll_id
        and mycollege_private.is_channel_member_or_division(cp.channel_id)
    )
  );
create policy mycollege_poll_votes_delete_self
  on public.mycollege_poll_votes for delete to authenticated
  using (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.channel_polls as cp
      where cp.id = poll_id
        and mycollege_private.is_channel_member_or_division(cp.channel_id)
    )
  );

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

notify pgrst, 'reload schema';
