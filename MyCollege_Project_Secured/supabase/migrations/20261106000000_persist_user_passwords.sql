begin;

create table if not exists public.mycollege_user_passwords (
  email text primary key,
  profile_id uuid references public.profiles(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.mycollege_user_passwords enable row level security;
alter table public.mycollege_user_passwords force row level security;

revoke all on table public.mycollege_user_passwords from public, anon;
grant select, insert, update, delete on table public.mycollege_user_passwords to service_role, authenticated;

-- Allow authenticated users to view/manage their own credentials
create policy mycollege_user_passwords_owner on public.mycollege_user_passwords
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

commit;
