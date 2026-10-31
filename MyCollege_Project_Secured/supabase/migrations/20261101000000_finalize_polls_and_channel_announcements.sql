-- ============================================================
-- Migration: finalize_polls_and_channel_announcements
-- Purpose  : Wire the dedicated poll-option / vote tables that
--            the server now uses (mycollege_poll_options &
--            mycollege_poll_votes), lock down the legacy
--            poll_options / poll_votes tables so they can no
--            longer be reached by client code, and tighten the
--            channel_announcements (group / circle announcements)
--            RLS so only channel managers can post them.
-- ============================================================
begin;

-- ──────────────────────────────────────────────────────────────
-- 0. Add created_by to channel_polls if it does not exist yet
--    (Migration 20261031203000 added this, but may not have run)
-- ──────────────────────────────────────────────────────────────
alter table public.channel_polls
  add column if not exists created_by uuid
    references public.profiles(id) on delete set null;

-- ──────────────────────────────────────────────────────────────
-- 1. Ensure channel_polls.created_by is always set on insert
--    (the RLS policy mycollege_poll_options_insert_creator
--     checks cp.created_by = auth.uid(), so we enforce it
--     server-side with a before-insert trigger).
-- ──────────────────────────────────────────────────────────────
create or replace function mycollege_private.guard_channel_poll_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Always stamp created_by with the authenticated user so the
  -- RLS policy on mycollege_poll_options can gate option inserts.
  new.created_by := (select auth.uid());
  if new.created_by is null then
    raise exception 'An authenticated user is required to create a poll';
  end if;
  if not mycollege_private.can_post_to_channel(new.channel_id) then
    raise exception 'You do not have permission to post polls in this group';
  end if;
  return new;
end;
$$;

revoke all on function mycollege_private.guard_channel_poll_insert()
  from public, anon, authenticated;

drop trigger if exists guard_channel_poll_insert on public.channel_polls;
create trigger guard_channel_poll_insert
  before insert on public.channel_polls
  for each row execute function mycollege_private.guard_channel_poll_insert();

-- ──────────────────────────────────────────────────────────────
-- 2. Lock down the legacy poll_options / poll_votes tables.
--    These tables may still exist from the original schema but
--    all server code now targets mycollege_poll_options /
--    mycollege_poll_votes.  Strip all grants so client JWTs
--    cannot reach them.
-- ──────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.poll_options') is not null then
    revoke all on public.poll_options from public, anon, authenticated;
    alter table public.poll_options enable row level security;
    -- Drop any permissive policies that might remain
    drop policy if exists poll_options_read_member   on public.poll_options;
    drop policy if exists poll_options_insert_member on public.poll_options;
    drop policy if exists poll_options_delete_manager on public.poll_options;
    drop policy if exists poll_options_update_manager on public.poll_options;
  end if;
  if to_regclass('public.poll_votes') is not null then
    revoke all on public.poll_votes from public, anon, authenticated;
    alter table public.poll_votes enable row level security;
    drop policy if exists poll_votes_read_member      on public.poll_votes;
    drop policy if exists poll_votes_insert_self_member on public.poll_votes;
    drop policy if exists poll_votes_delete_self      on public.poll_votes;
  end if;
end
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. Ensure mycollege_poll_options & mycollege_poll_votes exist
--    (they were created in 20261031203000 but we repeat the
--     CREATE TABLE IF NOT EXISTS to be idempotent).
-- ──────────────────────────────────────────────────────────────
create table if not exists public.mycollege_poll_options (
  id          uuid    primary key default gen_random_uuid(),
  poll_id     uuid    not null references public.channel_polls(id) on delete cascade,
  option_text text    not null,
  position    integer not null default 0,
  unique (id, poll_id),
  unique (poll_id, position)
);

create table if not exists public.mycollege_poll_votes (
  poll_id    uuid         not null,
  option_id  uuid         not null,
  profile_id uuid         not null references public.profiles(id) on delete cascade,
  created_at timestamptz  not null default now(),
  primary key (poll_id, option_id, profile_id),
  foreign key (option_id, poll_id)
    references public.mycollege_poll_options (id, poll_id)
    on delete cascade
);

-- Indexes (idempotent)
create index if not exists mycollege_poll_options_poll_position_idx
  on public.mycollege_poll_options (poll_id, position);
create index if not exists mycollege_poll_votes_profile_poll_idx
  on public.mycollege_poll_votes (profile_id, poll_id);

-- Grants & RLS (idempotent — ALTER TABLE … ENABLE ROW LEVEL
--   SECURITY is a no-op if already enabled)
grant select, insert, delete
  on public.mycollege_poll_options, public.mycollege_poll_votes
  to authenticated;
revoke all on public.mycollege_poll_options, public.mycollege_poll_votes
  from public, anon;
alter table public.mycollege_poll_options enable row level security;
alter table public.mycollege_poll_votes    enable row level security;

-- Policies — drop first so re-running this migration is safe
drop policy if exists mycollege_poll_options_read_member    on public.mycollege_poll_options;
drop policy if exists mycollege_poll_options_insert_creator on public.mycollege_poll_options;
drop policy if exists mycollege_poll_votes_read_member      on public.mycollege_poll_votes;
drop policy if exists mycollege_poll_votes_insert_self_member on public.mycollege_poll_votes;
drop policy if exists mycollege_poll_votes_delete_self      on public.mycollege_poll_votes;

-- Any channel member can read the options for polls in channels
-- they can access.
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

-- Only the poll creator (stamped by the trigger above) can add
-- options, and only via a channel they can post to.
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

-- Any channel member can read votes.
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

-- Members can vote for themselves in channels they can access.
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

-- Users can retract only their own vote.
create policy mycollege_poll_votes_delete_self
  on public.mycollege_poll_votes for delete to authenticated
  using (profile_id = (select auth.uid()));

-- ──────────────────────────────────────────────────────────────
-- 4. channel_announcements (Circle / Group announcements)
--    Ensure the table exists and tighten the RLS policies.
--    The server lets only circle admins / faculty / coordinators
--    post; the DB should enforce the same rule.
-- ──────────────────────────────────────────────────────────────

-- Extra columns that the server writes
alter table public.channel_announcements
  add column if not exists author_name text,
  add column if not exists author_role text,
  add column if not exists priority    text not null default 'normal',
  add column if not exists deadline    timestamptz,
  add column if not exists attachment  jsonb;

alter table public.channel_announcements
  drop constraint if exists channel_announcements_priority_check;
alter table public.channel_announcements
  add constraint channel_announcements_priority_check
  check (priority in ('urgent', 'high', 'normal', 'low'));

-- Helpful index for the GET /api/channels/:id/announcements query
create index if not exists channel_announcements_channel_created_desc_idx
  on public.channel_announcements (channel_id, created_at desc);

-- Grants
grant select, insert, update, delete
  on public.channel_announcements
  to authenticated;
revoke all on public.channel_announcements
  from public, anon;
alter table public.channel_announcements enable row level security;

-- Drop & recreate policies so this migration is re-runnable
drop policy if exists channel_announcements_read_member     on public.channel_announcements;
drop policy if exists channel_announcements_insert_manager  on public.channel_announcements;
drop policy if exists channel_announcements_update_manager  on public.channel_announcements;
drop policy if exists channel_announcements_delete_manager  on public.channel_announcements;

-- All members of the channel's institution who can view the
-- channel can read its announcements.
create policy channel_announcements_read_member
  on public.channel_announcements for select to authenticated
  using (mycollege_private.is_channel_member_or_division(channel_id));

-- Only channel managers (owner / admin members, faculty, or
-- institution admin) may post a new circle announcement.
-- author_id must match the current user.
create policy channel_announcements_insert_manager
  on public.channel_announcements for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and mycollege_private.can_manage_channel(channel_id)
  );

-- Managers may edit their own circle announcements.
create policy channel_announcements_update_manager
  on public.channel_announcements for update to authenticated
  using  (mycollege_private.can_manage_channel(channel_id))
  with check (mycollege_private.can_manage_channel(channel_id));

-- Managers may remove circle announcements.
create policy channel_announcements_delete_manager
  on public.channel_announcements for delete to authenticated
  using (mycollege_private.can_manage_channel(channel_id));

-- ──────────────────────────────────────────────────────────────
-- 5. Tighten channel_polls: grant exactly the operations the
--    server needs, nothing more.
-- ──────────────────────────────────────────────────────────────
revoke update, delete on public.channel_polls from authenticated;
grant select, insert on public.channel_polls to authenticated;
-- Channel managers may close / delete polls
grant update (question, multiple_answers), delete
  on public.channel_polls to authenticated;

commit;

