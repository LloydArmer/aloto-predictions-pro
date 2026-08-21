-- 049_diagnose_auto_enrol_single.sql
--
-- RUN ON DEV. Read-only. ONE query — run the whole file and send me the table.
--
-- A brand new user is landing in a competition without entering a code. This
-- reports every relevant fact in a single result set, because the Supabase SQL
-- Editor only ever displays the last statement's output.

select 'accounts and their competitions' as check,
       coalesce(string_agg(
         line, '  ;;  ' order by line
       ), '(no accounts)') as value
from (
  select p.display_name || ' -> ' || coalesce(c.name || ' (' || pa.role || ')', 'NO COMPETITION') as line
  from profiles p
  left join participants pa on pa.user_id = p.id
  left join competitions c  on c.id = pa.competition_id
) accounts

union all

select 'triggers on profiles / participants / competitions',
       coalesce(string_agg(c.relname || '.' || t.tgname || ' -> ' || p.proname, '  ;;  '), '(none)')
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc  p on p.oid = t.tgfoid
where not t.tgisinternal
  and c.relname in ('profiles', 'participants', 'competitions')

union all

select 'functions that insert into participants',
       coalesce(string_agg(proname, ', '), '(none)')
from pg_proc
where prosrc ilike '%insert into participants%'
   or prosrc ilike '%insert into public.participants%'

union all

select 'triggers on auth.users',
       coalesce(string_agg(t.tgname || ' -> ' || p.proname, '  ;;  '), '(none)')
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal

union all

select 'competitions_select policy',
       coalesce((select qual::text from pg_policies
                 where tablename = 'competitions' and policyname = 'competitions_select'), '(none)')

union all

select 'participants_insert policy',
       coalesce((select with_check::text from pg_policies
                 where tablename = 'participants' and policyname = 'participants_insert'), '(none)')

union all

select 'total competitions / participants rows',
       (select count(*) from competitions)::text || ' competitions, ' ||
       (select count(*) from participants)::text || ' participant rows';
