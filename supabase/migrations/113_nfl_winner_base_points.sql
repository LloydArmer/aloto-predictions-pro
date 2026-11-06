-- 113_nfl_winner_base_points.sql
--
-- NFL: 2 BASE POINTS for the right winner, with the margin and exact score
-- points added on top (Lloyd, 6 Nov 2026).
--
--   Before: one band per game. Right winner with nothing else = 1.
--   After:  right winner = 2, PLUS the best band reached:
--           exact score 20, exact margin 12, within 3 = 9, within 7 = 6,
--           within 14 = 3. So an exact score is 22, within 3 is 11.
--
-- The base is paid from the existing column point_rules.winner_only_points,
-- so no new column is needed. This file:
--   1. changes that column's default from 1 to 2,
--   2. sets it to 2 on every NFL (margin) rule set that still has the old 1,
--   3. seeds new NFL competitions with 2,
--   4. checks the result.
--
-- FOOTBALL IS UNTOUCHED. Football rule sets never read this column, and step 2
-- only changes rows with scoring_mode = 'margin'.
--
-- Points already stored on finished NFL weeks are NOT changed by this file.
-- Press Recalculate on a finished week in Admin to rescore it under the new
-- rule. Safe to run more than once.
--
-- RUN ON DEV FIRST, then production. The same file for both.

-- STEP 1 — new default
alter table public.point_rules alter column winner_only_points set default 2;

comment on column public.point_rules.winner_only_points is
  'Margin mode: base points for the right winner, added on top of the margin or exact score band. Default 2.';

-- STEP 2 — existing NFL rule sets still on the old 1
update public.point_rules
   set winner_only_points = 2
 where scoring_mode = 'margin'
   and winner_only_points = 1;

-- STEP 3 — new NFL competitions get 2
create or replace function public.create_default_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.sport = 'nfl' then
    insert into point_rules (competition_id, scoring_mode, exact_score_points, correct_result_points, winner_only_points)
    values (new.id, 'margin', 20, 0, 2);
  else
    insert into point_rules (competition_id) values (new.id);
  end if;
  return new;
end;
$$;

-- STEP 4 — check. Every value should match "expected".
select 'winner_only_points default' as check,
       (select column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'point_rules'
           and column_name = 'winner_only_points') as value,
       '2' as expected
union all
select 'NFL rule sets still on 1',
       (select count(*)::text from public.point_rules
         where scoring_mode = 'margin' and winner_only_points = 1),
       '0'
union all
select 'create_default_rules seeds 2 for nfl',
       (select (pg_get_functiondef(p.oid) like '%''margin'', 20, 0, 2%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'create_default_rules'),
       'true';
