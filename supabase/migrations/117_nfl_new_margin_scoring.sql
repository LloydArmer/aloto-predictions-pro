-- 117_nfl_new_margin_scoring.sql
--
-- NFL scoring, new version (Lloyd, 8 Nov 2026). Three parts that ADD together,
-- and only when the winner is right (a wrong winner scores 0):
--
--   Right winner                       winner_only_points        2
--   Each team's score exactly right    team_score_points         +5 per team
--   The margin, one line only:
--     exact                            margin_exact_points       +12
--     out by 1 to 2                    margin_within_2_points    +10
--     out by 3 to 4                    margin_within_4_points    +8
--     out by 5 to 7                    margin_within_7_points    +6
--     out by 8 to 10                   margin_within_10_points   +4
--     out by 11 to 14                  margin_within_14_points   +2
--     out by 15 or more                                          0
--
--   So an exact score is 2 + 5 + 5 + 12 = 24.
--
-- THIS FILE:
--   1. adds the four new point columns,
--   2. puts every NFL competition's rules on the new numbers,
--   3. seeds new NFL competitions with them,
--   4. adds public.nfl_margin_points(), the same sum as the app's marginScore,
--   5. rescores every FINISHED NFL week (prediction points and weekly scores),
--      so the tables match the new rules straight away,
--   6. updates one App Review demo chat message that quoted the old 22 points,
--   7. checks the result.
--
-- FOOTBALL IS UNTOUCHED: only rows with scoring_mode = 'margin', competitions
-- with sport = 'nfl', and their weeks are changed.
--
-- Note: step 2 overwrites any NFL points an admin changed in the Scoring tab.
--
-- Safe to run more than once. RUN ON DEV FIRST, then production.

-- STEP 1 — new columns, and the new default for the 11 to 14 line
alter table public.point_rules
  add column if not exists team_score_points       integer not null default 5,
  add column if not exists margin_within_2_points  integer not null default 10,
  add column if not exists margin_within_4_points  integer not null default 8,
  add column if not exists margin_within_10_points integer not null default 4;

alter table public.point_rules alter column margin_within_14_points set default 2;

comment on column public.point_rules.team_score_points is
  'Margin mode: points for each team whose score was predicted exactly (right winner only). Default 5.';
comment on column public.point_rules.margin_within_2_points is
  'Margin mode: margin out by 1 to 2. Default 10.';
comment on column public.point_rules.margin_within_4_points is
  'Margin mode: margin out by 3 to 4. Default 8.';
comment on column public.point_rules.margin_within_7_points is
  'Margin mode: margin out by 5 to 7. Default 6.';
comment on column public.point_rules.margin_within_10_points is
  'Margin mode: margin out by 8 to 10. Default 4.';
comment on column public.point_rules.margin_within_14_points is
  'Margin mode: margin out by 11 to 14. Default 2.';
comment on column public.point_rules.margin_within_3_points is
  'No longer used (replaced by within 2 and within 4 in migration 117).';

-- STEP 2 — every NFL rule set onto the new numbers
update public.point_rules
   set winner_only_points      = 2,
       team_score_points       = 5,
       margin_exact_points     = 12,
       margin_within_2_points  = 10,
       margin_within_4_points  = 8,
       margin_within_7_points  = 6,
       margin_within_10_points = 4,
       margin_within_14_points = 2,
       exact_score_points      = 0,
       correct_result_points   = 0
 where scoring_mode = 'margin';

-- STEP 3 — new NFL competitions start on the new numbers
create or replace function public.create_default_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.sport = 'nfl' then
    insert into point_rules (competition_id, scoring_mode, exact_score_points, correct_result_points,
                             winner_only_points, team_score_points, margin_exact_points,
                             margin_within_2_points, margin_within_4_points, margin_within_7_points,
                             margin_within_10_points, margin_within_14_points)
    values (new.id, 'margin', 0, 0, 2, 5, 12, 10, 8, 6, 4, 2);
  else
    insert into point_rules (competition_id) values (new.id);
  end if;
  return new;
end;
$$;

-- STEP 4 — the NFL points for one prediction. Must match marginScore in
-- src/lib/sports/nfl/scoring.js.
create or replace function public.nfl_margin_points(ph int, pa int, ah int, aa int, r public.point_rules)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  select case
    when sign(ph - pa) <> sign(ah - aa) then 0
    else r.winner_only_points
       + (case when ph = ah then r.team_score_points else 0 end)
       + (case when pa = aa then r.team_score_points else 0 end)
       + (case abs((ph - pa) - (ah - aa))
            when 0 then r.margin_exact_points
            else case
              when abs((ph - pa) - (ah - aa)) <= 2  then r.margin_within_2_points
              when abs((ph - pa) - (ah - aa)) <= 4  then r.margin_within_4_points
              when abs((ph - pa) - (ah - aa)) <= 7  then r.margin_within_7_points
              when abs((ph - pa) - (ah - aa)) <= 10 then r.margin_within_10_points
              when abs((ph - pa) - (ah - aa)) <= 14 then r.margin_within_14_points
              else 0 end
          end)
  end
$$;

-- STEP 5 — rescore every finished NFL week under the new rules
update public.predictions p
   set points_earned = public.nfl_margin_points(p.predicted_home, p.predicted_away, f.home_score, f.away_score, r)
  from public.fixtures f,
       public.competition_gameweeks cg,
       public.competitions c,
       public.point_rules r,
       public.gameweeks g
 where f.id = p.fixture_id
   and f.status = 'completed'
   and f.home_score is not null and f.away_score is not null
   and cg.gameweek_id = p.gameweek_id
   and g.id = p.gameweek_id and g.status = 'completed'
   and c.id = cg.competition_id and c.sport = 'nfl'
   and r.competition_id = coalesce(c.rules_source_competition_id, c.id)
   and r.scoring_mode = 'margin';

insert into public.gameweek_scores (competition_id, gameweek_id, user_id, points, exact_scores, correct_results)
select c.id, p.gameweek_id, p.user_id,
       sum(public.nfl_margin_points(p.predicted_home, p.predicted_away, f.home_score, f.away_score, r)),
       count(*) filter (where p.predicted_home = f.home_score and p.predicted_away = f.away_score),
       count(*) filter (where sign(p.predicted_home - p.predicted_away) = sign(f.home_score - f.away_score))
  from public.predictions p
  join public.fixtures f              on f.id = p.fixture_id and f.status = 'completed'
                                     and f.home_score is not null and f.away_score is not null
  join public.gameweeks g             on g.id = p.gameweek_id and g.status = 'completed'
  join public.competition_gameweeks cg on cg.gameweek_id = p.gameweek_id
  join public.competitions c          on c.id = cg.competition_id and c.sport = 'nfl'
  join public.point_rules r           on r.competition_id = coalesce(c.rules_source_competition_id, c.id)
                                     and r.scoring_mode = 'margin'
 group by c.id, p.gameweek_id, p.user_id
on conflict (competition_id, gameweek_id, user_id) do update
   set points          = excluded.points,
       exact_scores    = excluded.exact_scores,
       correct_results = excluded.correct_results,
       updated_at      = now();

-- STEP 6 — the App Review demo chat quoted the old exact-score total
update public.chat_messages
   set body = replace(body, '22 points', '24 points')
 where body like 'Nailed the exact score%22 points%'
   and competition_id in (select id from public.competitions where name = 'App Review Demo NFL');

-- STEP 7 — check. Every value should match "expected".
select 'new point columns' as check,
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'point_rules'
           and column_name in ('team_score_points', 'margin_within_2_points',
                               'margin_within_4_points', 'margin_within_10_points')) as value,
       '4' as expected
union all
select 'NFL rule sets not on the new numbers',
       (select count(*)::text from public.point_rules
         where scoring_mode = 'margin'
           and (winner_only_points, team_score_points, margin_exact_points, margin_within_2_points,
                margin_within_4_points, margin_within_7_points, margin_within_10_points,
                margin_within_14_points) is distinct from (2, 5, 12, 10, 8, 6, 4, 2)),
       '0'
union all
select 'exact score 27-20 when it ends 27-20',
       (select public.nfl_margin_points(27, 20, 27, 20, r)::text from public.point_rules r
         where r.scoring_mode = 'margin' limit 1),
       '24'
union all
select 'KC 27-24 when it ends 27-20 (winner, one score, out by 4)',
       (select public.nfl_margin_points(27, 24, 27, 20, r)::text from public.point_rules r
         where r.scoring_mode = 'margin' limit 1),
       '15'
union all
select 'wrong winner scores nothing',
       (select public.nfl_margin_points(20, 27, 27, 20, r)::text from public.point_rules r
         where r.scoring_mode = 'margin' limit 1),
       '0';
