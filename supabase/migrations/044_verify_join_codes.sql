-- 044_verify_join_codes.sql
--
-- Read-only. Confirms 043 applied correctly. Safe to run on either environment.
--
-- Run this after 043 when the final query in that file returned no rows —
-- which is normal on dev, where no competitions exist yet to list.

select 'competitions'                   as check,
       (select count(*) from competitions)::text as value,
       '0 on a fresh dev database is fine' as note
union all
select 'join_code column',
       (select count(*)::text from information_schema.columns
        where table_name = 'competitions' and column_name = 'join_code'),
       'expect 1'
union all
select 'generate_join_code function',
       (select count(*)::text from pg_proc where proname = 'generate_join_code'),
       'expect 1'
union all
select 'join_competition_with_code function',
       (select count(*)::text from pg_proc where proname = 'join_competition_with_code'),
       'expect 1'
union all
select 'regenerate_join_code function',
       (select count(*)::text from pg_proc where proname = 'regenerate_join_code'),
       'expect 1'
union all
select 'auto-code trigger',
       (select count(*)::text from pg_trigger where tgname = 'trg_set_join_code'),
       'expect 1'
union all
select 'competitions missing a code',
       (select count(*)::text from competitions where join_code is null),
       'expect 0'
union all
select 'participants_insert policy',
       (select count(*)::text from pg_policies
        where tablename = 'participants' and policyname = 'participants_insert'),
       'expect 1 — the tightened version from 043';

-- Every "expect" column should match. If a function or the trigger shows 0,
-- that part of 043 did not run — say so rather than re-running the whole file.
