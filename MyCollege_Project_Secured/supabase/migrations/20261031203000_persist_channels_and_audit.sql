begin;

alter table public.channels
  add column if not exists group_icon text,
  add column if not exists only_admins_can_message boolean not null default false,
  add column if not exists only_admins_can_edit_info boolean not null default false,
  add column if not exists invite_code text,
  add column if not exists pinned_announcement_id uuid,
  add column if not exists pinned_message_id uuid;

alter table public.channel_messages
  add column if not exists sender_name text,
  add column if not exists sender_role text,
  add column if not exists sender_department text,
  add column if not exists reply_metadata jsonb,
  add column if not exists poll_data jsonb;

alter table public.message_reactions
  add column if not exists emoji text;

alter table public.channel_polls
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create table if not exists public.mycollege_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.channel_polls(id) on delete cascade,
  option_text text not null,
  position integer not null default 0,
  unique (id, poll_id),
  unique (poll_id, position)
);

create table if not exists public.mycollege_poll_votes (
  poll_id uuid not null,
  option_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, profile_id),
  foreign key (option_id, poll_id)
    references public.mycollege_poll_options (id, poll_id)
    on delete cascade
);

alter table public.channel_announcements
  add column if not exists author_name text,
  add column if not exists author_role text;

create index if not exists channel_messages_channel_created_idx
  on public.channel_messages (channel_id, created_at);
create index if not exists channel_members_profile_status_idx
  on public.channel_members (profile_id, status);
create index if not exists channel_announcements_channel_created_idx
  on public.channel_announcements (channel_id, created_at desc);
create unique index if not exists message_reactions_message_profile_emoji_uidx
  on public.message_reactions (message_id, profile_id, emoji)
  where emoji is not null;
create index if not exists audit_logs_institution_created_idx
  on public.audit_logs (institution_id, created_at desc);
create index if not exists mycollege_poll_votes_profile_poll_idx
  on public.mycollege_poll_votes (profile_id, poll_id);

grant select, insert, delete
  on public.mycollege_poll_options, public.mycollege_poll_votes
  to authenticated;
revoke all on public.mycollege_poll_options, public.mycollege_poll_votes
  from public, anon;
alter table public.mycollege_poll_options enable row level security;
alter table public.mycollege_poll_votes enable row level security;

create or replace function mycollege_private.add_channel_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channel_members (channel_id, profile_id, role, status)
  values (new.id, new.creator_id, 'owner', 'active')
  on conflict do nothing;
  return new;
end
$$;

revoke all on function mycollege_private.add_channel_creator_as_owner()
  from public, anon, authenticated;

drop trigger if exists add_channel_creator_as_owner on public.channels;
create trigger add_channel_creator_as_owner
  after insert on public.channels
  for each row execute function mycollege_private.add_channel_creator_as_owner();

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
  using (profile_id = (select auth.uid()));

commit;
