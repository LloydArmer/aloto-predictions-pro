-- 050_remove_auto_enrol.sql
--
-- Removes the two triggers that put every account into every competition.
--
--   trg_auto_join_new_profile                    a new account joins every
--                                                existing competition
--   trg_auto_join_profiles_to_new_competition    a new competition gets every
--                                                existing account
--
-- These came from one of the migrations 002-032 that aren't in the repo. They
-- were sensible when the app was a single private league where everyone
-- belonged. With join codes they are actively wrong: nobody can be kept out,
-- so the code gates nothing.
--
-- Kept, because they are still correct:
--   on_competition_created_add_admin -> create_admin_participant
--     makes the creator an admin of their own competition
--   on_competition_created -> create_default_rules
--     seeds the points rules
--
-- RUN ON DEV FIRST, then production.

-- ---------------------------------------------------------------------------
-- STEP 1 — Drop the triggers.
--
-- The functions are dropped too. Leaving them behind invites someone (me
-- included) to reattach them later without remembering why they went.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_auto_join_new_profile on profiles;
drop trigger if exists trg_auto_join_profiles_to_new_competition on competitions;

drop function if exists auto_join_new_profile_to_competitions();
drop function if exists auto_join_profiles_to_new_competition();

-- ---------------------------------------------------------------------------
-- STEP 2 — Confirm they are gone, and the two we keep are still there.
-- ---------------------------------------------------------------------------
select
  c.relname || '.' || t.tgname as trigger_name,
  p.proname                    as runs_function
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc  p on p.oid = t.tgfoid
where not t.tgisinternal
  and c.relname in ('profiles', 'participants', 'competitions')
order by c.relname, t.tgname;

-- Expect exactly three:
--   competitions.on_competition_created            -> create_default_rules
--   competitions.on_competition_created_add_admin  -> create_admin_participant
--   competitions.trg_set_join_code                 -> set_join_code_on_insert
--
-- No trigger on profiles at all.

-- ---------------------------------------------------------------------------
-- STEP 3 — Clear the rows the old triggers already created. DEV ONLY.
--
-- On dev this is how you get a clean test: everyone except the competition's
-- own admin is removed, so you can try joining with a code properly.
--
-- DO NOT run this on production — it would remove your real players. On
-- production, existing memberships are correct and should stay; the triggers
-- being gone only affects who is added from now on.
-- ---------------------------------------------------------------------------
delete from participants
where role <> 'admin';

-- ---------------------------------------------------------------------------
-- STEP 4 — Who is left. Should be admins only.
-- ---------------------------------------------------------------------------
select p.display_name, c.name as competition, pa.role
from participants pa
join profiles p     on p.id = pa.user_id
join competitions c on c.id = pa.competition_id
order by c.name, pa.role;
