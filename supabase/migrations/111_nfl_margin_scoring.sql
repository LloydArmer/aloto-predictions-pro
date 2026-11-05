-- 111_nfl_margin_scoring.sql
--
-- NFL as a competition type, scored on the margin rather than the exact score.
-- See docs/ALOTO-NFL.md, sections 2 and 3.
--
-- SPORTS ARE SEPARATE. The app picks a sport at the top (Football or NFL,
-- more to come), and each sport has its own competitions, screens and scoring
-- code. So the sport list is a TABLE, not a fixed check: adding a sport later
-- is one insert into public.sports, with no change to anything that exists.
--
-- WHAT IT ADDS:
--
--   public.sports               The list of sports: football, nfl.
--   competitions.sport          Which sport a competition belongs to. Default
--                               'football', so every existing competition is
--                               football and nothing about it changes.
--   point_rules.scoring_mode    'exact_score' | 'margin', default 'exact_score'.
--   point_rules.margin_*        The NFL margin bands: exact margin 12, within 3
--   point_rules.winner_only_points   (a field goal) 9, within 7 (a touchdown) 6,
--                               within 14 (two scores) 3, right winner only 1.
--                               Football rows carry them but never read them.
--
-- The exact score in margin mode is paid from the existing exact_score_points
-- column — 20 for NFL — so there is no separate margin column for it.
--
-- NEW NFL COMPETITIONS. create_default_rules() now seeds a competition created
-- with sport = 'nfl' as margin scoring, exact score 20 and correct result 0.
-- Correct result is ZERO because calling the winner is already paid by
-- winner_only_points; paying both would quietly double it.
--
-- EXISTING DATA IS UNTOUCHED. Every existing competition becomes 'football' and
-- every existing rule set becomes 'exact_score', which is exactly how they score
-- today. Nothing is deleted or rescored. Safe to run more than once.
--
-- fixtures and predictions need no changes: predicted_home and predicted_away
-- already hold everything margin scoring reads.
--
-- RUN ON DEV FIRST, then production. The same file for both.

-- ---------------------------------------------------------------------------
-- STEP 1 — The sports, and which one a competition belongs to.
--
-- Anyone can read the list (the sport chooser shows before sign-in finishes).
-- Nobody can change it from the app; a new sport is added here, in SQL.
-- ---------------------------------------------------------------------------
create table if not exists public.sports (
  id          text primary key,
  name        text not null,
  emoji       text,
  sort_order  integer not null default 0,
  enabled     boolean not null default true
);

comment on table public.sports is
  'The sports the app offers. Adding a sport is one insert here. See 111.';

alter table public.sports enable row level security;

drop policy if exists sports_select on public.sports;
create policy sports_select on public.sports for select to anon, authenticated using (true);

grant select on public.sports to anon, authenticated;

insert into public.sports (id, name, emoji, sort_order) values
  ('football', 'Football', '⚽', 1),
  ('nfl',      'NFL',      '🏈', 2)
on conflict (id) do nothing;

alter table public.competitions
  add column if not exists sport text not null default 'football'
    constraint competitions_sport_fkey references public.sports(id);

comment on column public.competitions.sport is
  'Which sport this competition belongs to (public.sports). Decides which screens, feed, badges and scorer it uses. See 111.';

create index if not exists competitions_sport_idx on public.competitions (sport);

-- ---------------------------------------------------------------------------
-- STEP 2 — How a competition scores, and the margin bands.
-- ---------------------------------------------------------------------------
alter table public.point_rules
  add column if not exists scoring_mode text not null default 'exact_score'
    constraint point_rules_scoring_mode_check check (scoring_mode in ('exact_score', 'margin')),
  add column if not exists margin_exact_points     integer not null default 12,
  add column if not exists margin_within_3_points  integer not null default 9,
  add column if not exists margin_within_7_points  integer not null default 6,
  add column if not exists margin_within_14_points integer not null default 3,
  add column if not exists winner_only_points      integer not null default 1;

comment on column public.point_rules.scoring_mode is
  'exact_score: correct result + exact score bonus (football). margin: one band only, never stacked — exact score (exact_score_points), exact margin, within 3, within 7, within 14, winner only. Margin is signed. See 111.';
comment on column public.point_rules.margin_exact_points is
  'Margin mode: predicted margin exactly right, score not. Default 12.';
comment on column public.point_rules.margin_within_3_points is
  'Margin mode: margin out by 1 to 3 — within a field goal. Default 9.';
comment on column public.point_rules.margin_within_7_points is
  'Margin mode: margin out by 4 to 7 — within a touchdown. Default 6.';
comment on column public.point_rules.margin_within_14_points is
  'Margin mode: margin out by 8 to 14 — within two scores. Default 3.';
comment on column public.point_rules.winner_only_points is
  'Margin mode: margin out by more than 14 but the right winner. Default 1.';

-- ---------------------------------------------------------------------------
-- STEP 3 — Seed NFL competitions with margin scoring.
--
-- Same trigger, same security definer and search_path as before. A football
-- competition (and any sport without its own rules here) gets exactly the row
-- it always did.
-- ---------------------------------------------------------------------------
create or replace function public.create_default_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.sport = 'nfl' then
    insert into point_rules (competition_id, scoring_mode, exact_score_points, correct_result_points)
    values (new.id, 'margin', 20, 0);
  else
    insert into point_rules (competition_id) values (new.id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- STEP 4 — Check. One row per line; every value should match "expected".
-- ---------------------------------------------------------------------------
select 'sports' as check,
       (select string_agg(id, ', ' order by sort_order) from public.sports) as value,
       'football, nfl' as expected

union all
select 'competitions.sport column',
       (select data_type || ', default ' || column_default
          from information_schema.columns
         where table_schema = 'public' and table_name = 'competitions' and column_name = 'sport') as value,
       'text, default ''football''::text'

union all
select 'point_rules margin columns',
       (select count(*)::text
          from information_schema.columns
         where table_schema = 'public' and table_name = 'point_rules'
           and column_name in ('scoring_mode', 'margin_exact_points', 'margin_within_3_points',
                               'margin_within_7_points', 'margin_within_14_points', 'winner_only_points')),
       '6'

union all
select 'create_default_rules knows about nfl',
       (select (pg_get_functiondef(p.oid) like '%''nfl''%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'create_default_rules'),
       'true'

union all
select 'trigger still attached',
       (select count(*)::text from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
         where c.relname = 'competitions' and t.tgname = 'on_competition_created'),
       '1'

union all
select 'competitions not football (should be none yet)',
       (select count(*)::text from competitions where sport <> 'football'),
       '0'

union all
select 'rule sets not exact_score (should be none yet)',
       (select count(*)::text from point_rules where scoring_mode <> 'exact_score'),
       '0';
