-- 046_diagnose_user_creation.sql
--
-- RUN ON DEV.
--
-- "Database error creating new user" is Supabase's generic wrapper. The real
-- error is in Logs -> Postgres. This file narrows it down from the database
-- side so we stop guessing.
--
-- Run STEP 1 first and send me the output. STEP 2 is a test to run only if I
-- ask, and STEP 3 puts things back.

-- ---------------------------------------------------------------------------
-- STEP 1 — What does profiles actually require?
--
-- A column that is NOT NULL with no default, and that the trigger does not
-- supply, would fail every insert. The trigger provides id, display_name and
-- email; everything else must have a default or allow null.
-- ---------------------------------------------------------------------------
select
  column_name,
  data_type,
  is_nullable,
  coalesce(column_default, '(none)') as default_value,
  is_generated
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- Anything showing is_nullable = NO, default_value = (none), is_generated = NEVER,
-- other than id / display_name / email, is the likely culprit.

-- ---------------------------------------------------------------------------
-- Also worth seeing: what is actually attached to auth.users, in case
-- something other than our trigger is firing.
-- ---------------------------------------------------------------------------
select tgname as trigger_name, tgenabled as enabled
from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- And the current function body, to confirm 045 really applied:
select prosrc as function_body
from pg_proc
where proname = 'handle_new_user';

-- ---------------------------------------------------------------------------
-- STEP 2 — Bisect. ONLY RUN IF I ASK.
--
-- Disables the trigger, so creating a user touches auth.users alone. If user
-- creation then WORKS, the trigger is definitely the cause. If it STILL fails,
-- the problem is in Supabase Auth's own tables and nothing to do with our
-- schema — which would point at something the baseline dump missed.
-- ---------------------------------------------------------------------------
-- alter table auth.users disable trigger on_auth_user_created;

-- Now try Authentication -> Users -> Add user, and tell me what happens.

-- ---------------------------------------------------------------------------
-- STEP 3 — Put it back afterwards, either way.
-- ---------------------------------------------------------------------------
-- alter table auth.users enable trigger on_auth_user_created;

-- If step 2 succeeded, any user created while the trigger was off has no
-- profile row. This gives them one:
--
-- insert into public.profiles (id, display_name, email)
-- select u.id,
--        coalesce(nullif(split_part(coalesce(u.email,''),'@',1),''), 'Player'),
--        u.email
-- from auth.users u
-- left join public.profiles p on p.id = u.id
-- where p.id is null;
