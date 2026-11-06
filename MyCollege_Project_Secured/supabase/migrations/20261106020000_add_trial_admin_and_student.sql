-- ============================================================
-- Migration: add_trial_admin_and_student
-- Purpose  : Add Harshwardhan Patil as admin with designation 'trials'
--            and Jayshree Patil as student with designation 'trials'
-- ============================================================
begin;

-- 1. Ensure approved student pjayshree062@gmail.com
insert into public.approved_students (email, institution_id, status)
values ('pjayshree062@gmail.com', '00000000-0000-4000-8000-000000000001', 'authorized')
on conflict (email) do update set status = 'authorized';

insert into public.approved_student_divisions (student_email, division_id)
values ('pjayshree062@gmail.com', '00000000-0000-4000-8000-000000000021')
on conflict (student_email, division_id) do nothing;

-- 2. Ensure faculty_directory has harshwardhanpatil241@gmail.com for staff authorization
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
  'harshwardhanpatil241@gmail.com',
  'Harshwardhan Patil',
  'trials',
  true
where not exists (
  select 1 from public.faculty_directory
  where lower(email) = 'harshwardhanpatil241@gmail.com'
);

-- 3. Update profiles for existing rows
update public.profiles
set role = 'admin',
    designation = 'trials',
    updated_at = now()
where lower(email) = 'harshwardhanpatil241@gmail.com';

update public.profiles
set role = 'student',
    designation = 'trials',
    updated_at = now()
where lower(email) = 'pjayshree062@gmail.com';

commit;
