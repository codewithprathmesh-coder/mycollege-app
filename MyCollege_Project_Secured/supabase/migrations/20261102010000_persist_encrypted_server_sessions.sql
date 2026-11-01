begin;

create table if not exists public.mycollege_server_sessions (
  token_hash text primary key
    check (token_hash ~ '^[0-9a-f]{64}$'),
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  auth_user_id uuid not null
    references auth.users(id) on delete cascade,
  encrypted_data text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index if not exists mycollege_server_sessions_expires_at_idx
  on public.mycollege_server_sessions (expires_at);

alter table public.mycollege_server_sessions enable row level security;
alter table public.mycollege_server_sessions force row level security;

revoke all on table public.mycollege_server_sessions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.mycollege_server_sessions
  to service_role;

commit;
