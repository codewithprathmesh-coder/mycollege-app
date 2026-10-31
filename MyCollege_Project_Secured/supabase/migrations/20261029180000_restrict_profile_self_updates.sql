begin;

revoke update on table public.profiles from authenticated;

grant update (
  full_name,
  username,
  phone,
  avatar_url,
  is_profile_completed,
  terms_accepted_at,
  updated_at
)
on table public.profiles
to authenticated;

commit;
