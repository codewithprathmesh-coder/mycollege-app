-- Import the local SY AI-DS 2026-27 student and faculty rosters into Supabase.
-- Safe to run repeatedly: student memberships are replaced with the local roster,
-- and existing faculty rows are updated rather than duplicated.

begin;

do $$
begin
  if not exists (
    select 1 from public.institutions
    where id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Somaiya institution ID was not found.';
  end if;

  if not exists (
    select 1 from public.divisions
    where id = '00000000-0000-4000-8000-000000000021'
      and institution_id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Division A ID was not found for the Somaiya institution.';
  end if;

  if not exists (
    select 1 from public.divisions
    where id = '00000000-0000-4000-8000-000000000022'
      and institution_id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Division B ID was not found for the Somaiya institution.';
  end if;
end
$$;

create temporary table mycollege_roster_students (
  email text not null,
  division_id uuid not null
) on commit drop;

insert into mycollege_roster_students (email, division_id)
select lower(btrim(entry.email)), '00000000-0000-4000-8000-000000000021'::uuid
from unnest(string_to_array($division_a$
aarya.daddikar@somaiya.edu
aditya.ladva@somaiya.edu
advait.d@somaiya.edu
ajitsingh.d@somaiya.edu
anushka.bhor@somaiya.edu
arghadeep.gupta@somaiya.edu
arya.bohra@somaiya.edu
asmi.jadhav@somaiya.edu
ayush.kathiriya@somaiya.edu
bbb@somaiya.edu
bhagyashree.i@somaiya.edu
bharati@somaiya.edu
bhawish.k@somaiya.edu
darshana.c@somaiya.edu
deepali.c@somaiya.edu
dev.ab@somaiya.edu
devanandkb@somaiya.edu
dheer.h@somaiya.edu
dhruv.k@somaiya.edu
dhurvi.joshi@somaiya.edu
dp2@somaiya.edu
gatik.godha@somaiya.edu
gwadmare@somaiya.edu
h.goswami@somaiya.edu
harsh.kumar@somaiya.edu
heer.dj@somaiya.edu
heet.gm@somaiya.edu
hemish.bhatt@somaiya.edu
henvi.damani@somaiya.edu
het.darji@somaiya.edu
het.gor@somaiya.edu
hiren.bafna@somaiya.edu
hrishikesh.jadav@somaiya.edu
isha.chudasma@somaiya.edu
jahnavireddy.m@somaiya.edu
jatan.mehta@somaiya.edu
kaivalya.j@somaiya.edu
keval.bharadwa@somaiya.edu
kpashte@somaiya.edu
krisha.db@somaiya.edu
krushnakant.d@somaiya.edu
kulkarni.sv@somaiya.edu
manya.jain@somaiya.edu
medha@somaiya.edu
meet.kj@somaiya.edu
mnemade@somaiya.edu
mrinank.b@somaiya.edu
neel.dungrani@somaiya.edu
nilay.kelkar@somaiya.edu
nilesh.gajre@somaiya.edu
nishit.bangari@somaiya.edu
omkar.rg@somaiya.edu
palak.nj@somaiya.edu
pankaj@somaiya.edu
pjayshree062@gmail.com
prachi.dhamecha@somaiya.edu
pradnya28@somaiya.edu
prashant.sb@somaiya.edu
prathamesh.cc@somaiya.edu
prathmesh.dhore@somaiya.edu
pravin.patil@somaiya.edu
rhutul.k@somaiya.edu
rujal.bapat@somaiya.edu
sachin.khant@somaiya.edu
sarika@somaiya.edu
sarth.jain@somaiya.edu
satyam.sb@somaiya.edu
sdhale@somaiya.edu
shabbir.c@somaiya.edu
sharwri.c@somaiya.edu
shaurya.hd@somaiya.edu
sheetaljagtap@somaiya.edu
shreyas.chougale@somaiya.edu
skasar@somaiya.edu
sshah@somaiya.edu
swarangi.borhade@somaiya.edu
tanishq.g@somaiya.edu
tanvir.bhere@somaiya.edu
vanshika.khant@somaiya.edu
vedant.masurkar@somaiya.edu
vrushti.j@somaiya.edu
vsagvekar@somaiya.edu
yukti.bafna@somaiya.edu
zain.ansari@somaiya.edu
$division_a$, E'\n')) as entry(email)
where btrim(entry.email) <> '';

insert into mycollege_roster_students (email, division_id)
select lower(btrim(entry.email)), '00000000-0000-4000-8000-000000000022'::uuid
from unnest(string_to_array($division_b$
aayush.rudani@somaiya.edu
adhish.t@somaiya.edu
adhyan.sikroria@somaiya.edu
aditya.thanki@somaiya.edu
aksh.nagda@somaiya.edu
akshat.sahu@somaiya.edu
aryan.satasia@somaiya.edu
ayush.salve@somaiya.edu
b.sawant@somaiya.edu
bhagyashree.i@somaiya.edu
bharati@somaiya.edu
bhargav.sah@somaiya.edu
chaitrali.patil@somaiya.edu
chirag.vadher@somaiya.edu
darsh.t@somaiya.edu
darsh.ved@somaiya.edu
deepali.c@somaiya.edu
dev10@somaiya.edu
devanandkb@somaiya.edu
devansh.u@somaiya.edu
divy.s@somaiya.edu
gwadmare@somaiya.edu
hamood.s@somaiya.edu
harshwardhan.vp@somaiya.edu
heet.tanna@somaiya.edu
henshi.m@somaiya.edu
hetnileshbhai.s@somaiya.edu
hs4@somaiya.edu
kalpesh.bp@somaiya.edu
kanish.trivedi@somaiya.edu
keval.poriya@somaiya.edu
kpashte@somaiya.edu
krish.patel3@somaiya.edu
krisha.at@somaiya.edu
kshaunish.m@somaiya.edu
lokesh.n@somaiya.edu
mahir.sanghavi@somaiya.edu
medha@somaiya.edu
mitra.sapra@somaiya.edu
mnemade@somaiya.edu
mohit.dv@somaiya.edu
neev.saraiya@somaiya.edu
nidhi.ss@somaiya.edu
nmp@somaiya.edu
om.sanghavi@somaiya.edu
osp@somaiya.edu
paarth.sukhija@somaiya.edu
pankaj@somaiya.edu
panth.shah@somaiya.edu
patel.dr@somaiya.edu
pradnya28@somaiya.edu
pranav.vn@somaiya.edu
prashant.sb@somaiya.edu
pravin.patil@somaiya.edu
priya.thombare@somaiya.edu
purva.mehta@somaiya.edu
rishab.p@somaiya.edu
rishi.singh1@somaiya.edu
sahil.nikam@somaiya.edu
samiksha.ns@somaiya.edu
sanmesh.p@somaiya.edu
santino.p@somaiya.edu
sarika@somaiya.edu
sdhale@somaiya.edu
sheetaljagtap@somaiya.edu
shikha.sp@somaiya.edu
shyam.sondagar@somaiya.edu
skasar@somaiya.edu
sshah@somaiya.edu
tanish.sanghavi@somaiya.edu
tanisha.yr@somaiya.edu
tanishka.thakur@somaiya.edu
udit.pandey@somaiya.edu
vaishnavi.ys@somaiya.edu
vas3@somaiya.edu
vedant.rathod@somaiya.edu
vedant18@somaiya.edu
vina.upadhye@somaiya.edu
vinit.waghela@somaiya.edu
vsagvekar@somaiya.edu
yash.prabhu@somaiya.edu
yatharth.shah@somaiya.edu
yht@somaiya.edu
yuvi.thacker@somaiya.edu
$division_b$, E'\n')) as entry(email)
where btrim(entry.email) <> '';

update public.approved_students as a
set institution_id = '00000000-0000-4000-8000-000000000001',
    status = 'authorized',
    updated_at = now()
from (
  select distinct email
  from mycollege_roster_students
) as roster
where lower(a.email) = roster.email;

insert into public.approved_students (email, institution_id, status)
select roster.email,
       '00000000-0000-4000-8000-000000000001',
       'authorized'
from (
  select distinct email
  from mycollege_roster_students
) as roster
where not exists (
  select 1
  from public.approved_students as a
  where lower(a.email) = roster.email
);

delete from public.approved_student_divisions as ad
using (
  select distinct email
  from mycollege_roster_students
) as roster
where lower(ad.student_email) = roster.email;

insert into public.approved_student_divisions (student_email, division_id)
select distinct email, division_id
from mycollege_roster_students;

create temporary table mycollege_roster_faculty (
  email text not null,
  full_name text not null,
  designation text not null
) on commit drop;

insert into mycollege_roster_faculty (email, full_name, designation)
values
  ('mnemade@somaiya.edu', 'Dr. Milind U. Nemade', 'HOD & Professor'),
  ('vwadhe@somaiya.edu', 'Dr. Vaishali R. Wadhwe', 'I/C HOD & Professor'),
  ('gwadmare@somaiya.edu', 'Mr. Ganesh B. Wadmare', 'Asst.Professor'),
  ('devanandkb@somaiya.edu', 'Mr. Devanand K. Bathe', 'Asst.Professor'),
  ('sheetaljagtap@somaiya.edu', 'Dr. Sheetal G. Jagtap', 'Asst.Professor'),
  ('pankaj@somaiya.edu', 'Mr. Pankaj V. Deshmukh', 'Asst.Professor'),
  ('medha@somaiya.edu', 'Ms. Medha S. Asurlekar', 'Asst.Professor'),
  ('sshah@somaiya.edu', 'Ms. Sejal B. Shah', 'Asst.Professor'),
  ('vsagvekar@somaiya.edu', 'Dr. Vidya R. Sagvekar', 'Asst.Professor'),
  ('sarika@somaiya.edu', 'Dr. Sarika Y. Mane', 'Asst.Professor'),
  ('deepali.c@somaiya.edu', 'Ms. Deepali Chavan', 'Asst.Professor'),
  ('pravin.patil@somaiya.edu', 'Mr. Pravin Patil', 'Asst.Professor'),
  ('pradnya28@somaiya.edu', 'Ms. Pradnya Jadhav', 'Asst.Professor'),
  ('prashant.sb@somaiya.edu', 'Mr. Prashant Bhandare', 'Asst.Professor'),
  ('bhagyashree.i@somaiya.edu', 'Ms. Bhagyashree Ingale', 'Asst.Professor'),
  ('skasar@somaiya.edu', 'Mr. Sudhir Kasar', 'Skilled Asst.'),
  ('kpashte@somaiya.edu', 'Ms. Kavita Pashte', 'Tech.Asst.'),
  ('sdhale@somaiya.edu', 'Mr. Sachin Dhale', 'Lab.Asst.'),
  ('bharati@somaiya.edu', 'Ms. Bharati Sansare', 'Lab.Asst.'),
  ('lokmat874@gmail.com', 'lokmat', 'trial'),
  ('harshwardhanpatil241@gmail.com', 'Harshwardhan Patil', 'trials');

update public.faculty_directory as f
set institution_id = '00000000-0000-4000-8000-000000000001',
    department_id = '00000000-0000-4000-8000-000000000015',
    full_name = roster.full_name,
    designation = roster.designation,
    is_active = true
from mycollege_roster_faculty as roster
where lower(f.email) = roster.email;

insert into public.faculty_directory (
  institution_id,
  department_id,
  email,
  full_name,
  designation,
  is_active
)
select
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000015',
  roster.email,
  roster.full_name,
  roster.designation,
  true
from mycollege_roster_faculty as roster
where not exists (
  select 1
  from public.faculty_directory as f
  where lower(f.email) = roster.email
);

-- Backfill Auth accounts that already existed before the roster was imported.
insert into public.profiles as current_profile (
  id,
  email,
  full_name,
  role,
  institution_id,
  department_id,
  designation,
  is_verified,
  is_profile_completed
)
select
  u.id,
  lower(u.email),
  coalesce(
    f.full_name,
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    split_part(lower(u.email), '@', 1)
  ),
  case when f.id is not null then 'faculty' else 'student' end,
  coalesce(f.institution_id, a.institution_id),
  coalesce(f.department_id, d.department_id),
  f.designation,
  u.email_confirmed_at is not null,
  false
from auth.users as u
left join public.approved_students as a
  on a.email = lower(u.email)
  and a.status = 'authorized'
left join public.faculty_directory as f
  on f.email = lower(u.email)
  and f.is_active
left join lateral (
  select v.department_id
  from public.approved_student_divisions as ad
  join public.divisions as v on v.id = ad.division_id
  where ad.student_email = lower(u.email)
    and v.institution_id = a.institution_id
  order by v.created_at, v.id
  limit 1
) as d on true
where u.email is not null
  and (a.email is not null or f.id is not null)
on conflict (id) do update
set email = excluded.email,
    full_name = case
  when current_profile.is_profile_completed then current_profile.full_name
      else excluded.full_name
    end,
    role = excluded.role,
    institution_id = excluded.institution_id,
    department_id = excluded.department_id,
    designation = excluded.designation,
    is_verified = excluded.is_verified;

insert into public.profile_divisions (profile_id, division_id)
select p.id, ad.division_id
from public.profiles as p
join public.approved_student_divisions as ad
  on ad.student_email = p.email
join public.divisions as d
  on d.id = ad.division_id
  and d.institution_id = p.institution_id
where p.role = 'student'
on conflict (profile_id, division_id) do nothing;

update public.approved_students as a
set registered_user_id = p.id,
    registered_at = coalesce(a.registered_at, now()),
    updated_at = now()
from public.profiles as p
where p.email = a.email
  and a.status = 'authorized'
  and a.registered_user_id is distinct from p.id;

commit;

select 'authorized students' as result, count(distinct email) as total
from public.approved_students
where status = 'authorized'
  and institution_id = '00000000-0000-4000-8000-000000000001'
union all
select 'active faculty', count(*)
from public.faculty_directory
where is_active
  and institution_id = '00000000-0000-4000-8000-000000000001';

select
  p.email,
  p.role,
  p.institution_id,
  p.is_verified,
  a.status as roster_status
from public.profiles as p
join public.approved_students as a on a.email = p.email
where p.email = 'prathmesh.dhore@somaiya.edu';
