-- 051_remove_auto_enrol_PRODUCTION.sql
--
-- PRODUCTION-SAFE version of 050. Run the whole file — there is nothing in it
-- that deletes data.
--
-- 050 (the dev version) ended with `delete from participants where role <> 'admin'`
-- to give a clean slate for testing. That statement is NOT in this file, and
-- must never be run on production: it would remove every player from every
-- competition.
--
-- What this does: drops the two triggers that put every account into every
-- competition. Existing memberships, predictions, scores and standings are
-- completely untouched — a trigger only affects what happens NEXT.
--
-- After this, a new sign-up sees an empty dashboard and needs a join code.

-- ---------------------------------------------------------------------------
-- STEP 1 — Drop the auto-enrol triggers and their functions.
--
--   trg_auto_join_new_profile                  a new account joins every
--                                              existing competition
--   trg_auto_join_profiles_to_new_competition  a new competition gets every
--                                              existing account
--
-- These came from one of the migrations 002-032 missing from the repo. They
-- made sense when this was a single private league. With join codes they are
-- actively wrong: nobody can be kept out, so the code gates nothing.
--
-- The functions go too — leaving them behind invites someone to reattach them
-- later without remembering why they were removed.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_auto_join_new_profile on profiles;
drop trigger if exists trg_auto_join_profiles_to_new_competition on competitions;

drop function if exists auto_join_new_profile_to_competitions();
drop function if exists auto_join_profiles_to_new_competition();

-- ---------------------------------------------------------------------------
-- STEP 2 — Confirm. Two things to check in the output.
-- ---------------------------------------------------------------------------
select
  'triggers remaining' as check,
  coalesce(string_agg(c.relname || '.' || t.tgname, '  ;;  ' order by c.relname, t.tgname), '(none)') as value
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and c.relname in ('profiles', 'participants', 'competitions')

union all

-- Unchanged from before you ran this. If this number dropped, something is
-- very wrong — stop and restore from a backup.
select 'participant rows (should be unchanged)',
       (select count(*) from participants)::text

union all

select 'players still in competitions',
       coalesce((select string_agg(p.display_name || ' -> ' || c.name, '  ;;  ')
                 from participants pa
                 join profiles p     on p.id = pa.user_id
                 join competitions c on c.id = pa.competition_id), '(none)');

-- Expected triggers: exactly three, all on competitions —
--   on_competition_created            -> create_default_rules
--   on_competition_created_add_admin  -> create_admin_participant
--   trg_set_join_code                 -> set_join_code_on_insert
-- and NOTHING on profiles.
