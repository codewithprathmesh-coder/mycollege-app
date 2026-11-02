<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# MyCollege

## Run locally

Prerequisite: Node.js.

1. Copy `.env.example` to `.env` and fill in the values you need. The Express
   server loads `.env`; putting server secrets only in `.env.local` will not
   configure the server. Keep `.env` private and never commit it.
   - Configure `GEMINI_API_KEY` to enable AI summarization.
   - Email OTPs are generated and verified by Supabase Auth, then delivered by
     the server's SMTP transport. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and
     `SMTP_PASS` in `.env`; keep these credentials server-side. This delivery
     path also requires `SUPABASE_SERVICE_ROLE_KEY`. If SMTP is not configured,
     the server falls back to Supabase Auth's configured email provider.
   - Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for the server's
     Supabase health check. These values do not connect the app's in-memory
     application data to the database.
   - Configure `SUPABASE_SERVICE_ROLE_KEY` and `SESSION_ENCRYPTION_KEY` for
     durable Express sessions. Keep both server-side and out of `VITE_`
     variables. Generate an encryption key with
     `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are for browser
     code only. Publishable keys are public; never put a service-role key or
     database password in a `VITE_` variable.
2. Install dependencies with `npm install`.
3. Run `npm run lint` and `npm run build` to validate the app.
4. Run `npm run dev` and open the local URL printed by the server.

Supabase Auth now handles email OTP verification and profile provisioning.
The Express session lookup can persist across restarts after applying the
session migration and configuring both server-only session secrets. Supabase
is not yet the app's primary feature-data store. Complete and test the
remaining database integration before using this app for real multi-user or
production data.

User preferences, institution/department/division data, announcements, event
registrations, saved announcements, notifications, channel listings/creation,
basic messages, reactions, polls/votes, channel membership/settings,
message pin/delete state, circle announcements, and audit logs are persisted
in Supabase by the current API. Apply all migrations listed below before using
these features. Approved-student roster operations also use Supabase after
applying the roster workflow migration below. The profile-based user directory
and role changes use Supabase after applying the user-directory migration.
Batch-directory details use Supabase after applying the batch-directory
migration; newly added student records are linked to profiles when students
complete their first authorized sign-in.

The browser session credential is stored in an `HttpOnly`, `SameSite=Strict`
cookie rather than browser storage. Production must use HTTPS so the server can
mark this cookie `Secure`.

### Supabase Auth profile provisioning

After applying the role-alignment migration, apply
[`supabase/migrations/20261029170000_provision_profiles_from_auth.sql`](./supabase/migrations/20261029170000_provision_profiles_from_auth.sql).
It creates profiles only for active faculty or authorized students, assigns
roles from trusted database records (not user metadata), links approved student
divisions, and backfills matching existing Auth users. Test with disposable
approved accounts before opening access.

Run
[`supabase/migrations/20261029180000_restrict_profile_self_updates.sql`](./supabase/migrations/20261029180000_restrict_profile_self_updates.sql)
to prevent signed-in users from changing their own database role, institution,
email, or verification fields. The profile update policy alone only limits
which row may be changed; this migration also restricts which columns can be
updated.

The app verifies authorization only after email OTP sign-in, using the
authenticated user's own Supabase identity. Apply
[`supabase/migrations/20261029200000_secure_signed_in_email_authorization.sql`](./supabase/migrations/20261029200000_secure_signed_in_email_authorization.sql)
to replace any earlier email-parameter authorization function. This prevents
unauthenticated callers from probing which email addresses are on the college
roster.

After applying the role-alignment migration and the signed-in authorization
migration, apply
[`supabase/migrations/20261031190000_secure_app_data_access.sql`](./supabase/migrations/20261031190000_secure_app_data_access.sql)
in the Supabase SQL Editor. It creates the per-profile `app_user_settings`
table used by the API, enables its self-only RLS policy, and adds policies for
the app's existing feature tables. Do not treat this migration as proof that
the Express routes are already database-backed; the remaining in-memory API
domains are listed above and must be migrated and tested separately.

The announcement API also requires
[`supabase/migrations/20261031195000_announcement_author_metadata.sql`](./supabase/migrations/20261031195000_announcement_author_metadata.sql).
Apply it after the app-data migration; it adds trusted author display metadata
and a visibility-checked aggregate metrics RPC used by announcement reads.

Event registrations and notification delivery require
[`supabase/migrations/20261031200000_persist_event_registrations.sql`](./supabase/migrations/20261031200000_persist_event_registrations.sql).
Apply it after the announcement metadata migration. It adds registration
metadata, indexes, audience notification functions, and review notifications.

The registration API's database-generated ticket codes and duplicate
registration protection also require
[`supabase/migrations/20261031201500_finalize_event_registration_guards.sql`](./supabase/migrations/20261031201500_finalize_event_registration_guards.sql).
Apply it after the registration migration.

Channel/message API persistence requires
[`supabase/migrations/20261031203000_persist_channels_and_audit.sql`](./supabase/migrations/20261031203000_persist_channels_and_audit.sql).
Apply it after the registration guard migration. It adds channel/message
metadata used by the API, persists creator membership, and adds query indexes.

Polls and channel announcements require
[`supabase/migrations/20261101000000_finalize_polls_and_channel_announcements.sql`](./supabase/migrations/20261101000000_finalize_polls_and_channel_announcements.sql).
Apply it after the channel/message migration. It creates the dedicated poll
option and vote tables and enforces manager-only channel announcements.

Admin approved-student roster operations require
[`supabase/migrations/20261102000000_persist_admin_roster_workflows.sql`](./supabase/migrations/20261102000000_persist_admin_roster_workflows.sql).
Apply it after the app-data migration. It provides an atomic, admin-scoped
database operation used by the roster API to add, update, and reassign students.
Before enabling sign-in for the supplied local roster, run
[`supabase/import_local_roster.sql`](./supabase/import_local_roster.sql) after
the institution and divisions have been created. Review its email and faculty
records first; it imports the repository's roster into the database.

Durable Express sessions require
[`supabase/migrations/20261102010000_persist_encrypted_server_sessions.sql`](./supabase/migrations/20261102010000_persist_encrypted_server_sessions.sql).
Apply it after the roster workflow migration. The session table has forced RLS,
no access for `anon` or `authenticated`, and grants only to `service_role`.
The server stores only a keyed hash of the cookie token and AES-256-GCM
encrypted session contents. Set `SUPABASE_SERVICE_ROLE_KEY` and a generated
32-byte base64 `SESSION_ENCRYPTION_KEY` in the server's private `.env`; never
use either in browser code or share either value in source control. Changing
the encryption key invalidates existing sessions, so keep it stable and back
it up securely.

The profile-based user directory and role management require
[`supabase/migrations/20261102020000_persist_user_directory.sql`](./supabase/migrations/20261102020000_persist_user_directory.sql).
Apply it after the encrypted-session migration. It adds institution-scoped RPCs
for listing profiles and changing roles; role changes are checked against the
authenticated administrator's database profile and invalidate the target
user's sessions. New accounts must come from an authorized student roster entry
or active faculty directory record, then sign in through Supabase Auth. The
admin console no longer creates synthetic in-memory accounts.

Batch-directory records require
[`supabase/migrations/20261102030000_persist_batch_directory.sql`](./supabase/migrations/20261102030000_persist_batch_directory.sql).
Apply it after the user-directory migration. It stores batch year, roll number,
division, department, and optional phone details, and adds institution-checked
RPCs for faculty/admin batch enrollment and summary counts. Student details are
linked to their Auth profile after first sign-in. Previously in-memory-only
batch details cannot be recovered automatically.

Apply
[`supabase/migrations/20261102040000_allow_batch_enrollment_for_existing_profiles.sql`](./supabase/migrations/20261102040000_allow_batch_enrollment_for_existing_profiles.sql)
after the batch-directory migration. It lets faculty/admins enter or update
batch details for students who already have profiles, so existing batch records
can be re-entered through the app.

## Supabase database access control (Step 4)

### Database connectivity check

The server checks Supabase using the `mycollege_health_check` RPC rather than
selecting from a protected table. Apply
[`supabase/migrations/20261029150000_add_database_health_check.sql`](./supabase/migrations/20261029150000_add_database_health_check.sql)
in the Supabase SQL Editor to enable this least-privilege connectivity check.
It returns only a boolean and does not grant access to application table data.

The current Supabase schema allows `student`, `teacher`, and `admin` profile
roles, while the app also uses `faculty` and `coordinator`. After applying the
RLS migration, run
[`supabase/migrations/20261029160000_align_profile_roles.sql`](./supabase/migrations/20261029160000_align_profile_roles.sql)
to allow the app's role values while retaining `teacher` as a staff-role
compatibility value. Coordinators are not granted staff database permissions.

### Existing project RLS status

The live schema report showed RLS enabled on all public tables, with forced RLS
on `profiles`, `groups`, `group_members`, `messages`, `notices`, and
`preferences`. It also showed established policies on those six tables. Do not
run the older `20261022220000_secure_college_rls.sql` against this already
configured database without a fresh review: its policy-name preflight does not
recognize the existing policy names and intentionally aborts on unknown ones.

Supabase Auth and profiles are now used for sign-in identity. Most feature routes
still read and write Express in-memory arrays rather than the Supabase feature
tables. RLS policies protect direct Supabase Auth/PostgREST access only; they
do **not** automatically secure or persist data held by the Express API.
Complete the remaining feature-data migration and role tests before treating
the app as production-ready.

### Roles, profile data, and secrets

- Each Auth user must have a `profiles` row whose `id` equals their Supabase Auth UUID and whose `institution_id` is set by trusted logic.
- Authenticated users cannot change `role`, `institution_id`, `email`, or their profile ID. Students can change only their own `full_name`, `username`, `phone`, and `avatar_url`, plus their own preference interests.
- Only `faculty` and `admin` profiles can create groups, manage group membership, or create/update notices. Coordinators are not granted these permissions by this migration.
- Assign elevated roles and institutions only in the SQL Editor or trusted server-side code after verifying the person's identity. Never put the `service_role` key or database password in browser code, `VITE_` variables, or client logs. Service-role calls bypass RLS.

### Test access with disposable users

Create disposable Supabase Auth accounts for Student A, Student B, and a faculty tester. Ensure each account has a `profiles` row. In SQL Editor, retrieve and verify their UUIDs, then provision the test institution/role:

```sql
select id, email
from auth.users
where email in (
  'student-a@example.test',
  'student-b@example.test',
  'faculty@example.test'
);

-- Replace these with the verified UUIDs and a real test institution UUID.
update public.profiles
set institution_id = '11111111-1111-1111-1111-111111111111'
where id in (
  '<student-a-uuid>',
  '<student-b-uuid>',
  '<faculty-uuid>'
);

update public.profiles
set role = 'faculty'
where id = '<faculty-uuid>';
```

Using the faculty user's Auth access token and the publishable key, create a group with `POST /rest/v1/groups` and body `{"name":"RLS check","description":"temporary test"}`. The database derives its institution and creator from the faculty profile and adds the creator as a member. Add Student A using `POST /rest/v1/group_members` and body `{"group_id":"<group-uuid>","user_id":"<student-a-uuid>"}`.

Use each account's own access token for these REST checks; do not use a service-role token:

| Test | Expected result |
| --- | --- |
| Anonymous request to `/rest/v1/messages` | Rejected; no anonymous table grant |
| Student A reads messages in the test group | Only messages from that group |
| Student B reads messages in the test group | Empty result |
| Student A inserts `{"group_id":"<group-uuid>","user_id":"<student-a-uuid>","content":"RLS check"}` | Succeeds |
| Student B inserts in that group | Rejected |
| Student A inserts a message claiming another user's `user_id` | Rejected |
| Student reads profiles/preferences | Only their own rows |
| Student changes their own `full_name` | Succeeds |
| Student changes `role`, `institution_id`, or `email` | Rejected |
| Student creates a group, adds another member, or creates a notice | Rejected |
| Faculty creates a group, adds a same-institution member, or creates a notice | Succeeds |
| Staff adds a user from a different institution | Rejected |

Old groups with mixed or missing member institution IDs are intentionally not assigned an institution. An administrator must verify and assign `groups.institution_id` before staff policies can manage those groups. Members can continue to access their existing groups through membership.

For a configuration check in SQL Editor:

```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'groups', 'group_members',
    'messages', 'notices', 'preferences'
  )
order by c.relname;

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'groups', 'group_members',
    'messages', 'notices', 'preferences'
  )
order by tablename, policyname;
```

All six RLS and FORCE RLS flags should be true. Catalog results do not replace the authenticated-user REST tests. This repository has no configured Supabase project or PostgreSQL test runtime, so live permissions still need to be tested in your project before claiming security is verified.
