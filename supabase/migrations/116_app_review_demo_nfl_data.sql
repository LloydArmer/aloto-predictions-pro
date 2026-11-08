-- 116_app_review_demo_nfl_data.sql
--
-- Test data for "App Review Demo NFL" (made by 115), so the reviewer sees a
-- league that has been played in:
--
--   Week 8   finished, 5 games, both accounts predicted, points scored
--   Week 9   finished, 5 games, both accounts predicted, points scored
--   Week 10  current week, 5 games kicking off 6 to 7 days after you run
--            this, so they are still open when the reviewer looks. The player
--            has picked 3 of them; the admin has picked none.
--   Season   Super Bowl Winner, AFC Champion and NFC Champion (the free NFL
--            questions), open for 10 days. Both accounts have answered.
--
-- Points are worked out with public.nfl_margin_points() (migration 117), the
-- SQL twin of the app's marginScore: right winner, plus each team's score
-- exact, plus one margin line. The values come from this competition's own
-- point_rules row.
--
-- Dates are relative to when you run it. If review is delayed past Week 10's
-- kick-offs, run this file again: it clears this competition's weeks and
-- season questions and rebuilds them with fresh dates. It touches nothing
-- outside "App Review Demo NFL".
--
-- Run 114, 115 and 117 first.
--
-- RUN ON PRODUCTION. (Dev too if you want to rehearse it.)

do $$
declare
  v_admin  uuid;
  v_player uuid;
  v_comp   uuid;
  v_r      point_rules%rowtype;
  v_gw     uuid;
  v_cfg    uuid;
  v_pick   uuid;
  v_day    timestamptz := date_trunc('day', now());
  w        record;
  g        record;
  t        text;
  i        int;

  all_teams text[] := array[
    'Arizona Cardinals','Atlanta Falcons','Baltimore Ravens','Buffalo Bills','Carolina Panthers',
    'Chicago Bears','Cincinnati Bengals','Cleveland Browns','Dallas Cowboys','Denver Broncos',
    'Detroit Lions','Green Bay Packers','Houston Texans','Indianapolis Colts','Jacksonville Jaguars',
    'Kansas City Chiefs','Las Vegas Raiders','Los Angeles Chargers','Los Angeles Rams','Miami Dolphins',
    'Minnesota Vikings','New England Patriots','New Orleans Saints','New York Giants','New York Jets',
    'Philadelphia Eagles','Pittsburgh Steelers','San Francisco 49ers','Seattle Seahawks',
    'Tampa Bay Buccaneers','Tennessee Titans','Washington Commanders'];
  afc_teams text[] := array[
    'Baltimore Ravens','Buffalo Bills','Cincinnati Bengals','Cleveland Browns','Denver Broncos',
    'Houston Texans','Indianapolis Colts','Jacksonville Jaguars','Kansas City Chiefs','Las Vegas Raiders',
    'Los Angeles Chargers','Miami Dolphins','New England Patriots','New York Jets','Pittsburgh Steelers',
    'Tennessee Titans'];
  nfc_teams text[] := array[
    'Arizona Cardinals','Atlanta Falcons','Carolina Panthers','Chicago Bears','Dallas Cowboys',
    'Detroit Lions','Green Bay Packers','Los Angeles Rams','Minnesota Vikings','New Orleans Saints',
    'New York Giants','Philadelphia Eagles','San Francisco 49ers','Seattle Seahawks',
    'Tampa Bay Buccaneers','Washington Commanders'];
begin
  select id into v_admin  from auth.users where email = 'appreview.admin@alotopredictionpro.co.uk';
  select id into v_player from auth.users where email = 'appreview.player@alotopredictionpro.co.uk';
  select id into v_comp   from competitions where name = 'App Review Demo NFL';

  if v_admin is null or v_player is null or v_comp is null then
    raise exception 'Run 107 and 115 first (admin found: %, player found: %, competition found: %)',
      v_admin is not null, v_player is not null, v_comp is not null;
  end if;

  select * into v_r from point_rules where competition_id = v_comp;
  if v_r.scoring_mode is distinct from 'margin' then
    raise exception 'App Review Demo NFL is not on NFL margin scoring. Check 115 ran.';
  end if;

  -- ── Clear this competition's previous demo data (fresh dates on re-run) ─
  -- Cascades remove fixtures, predictions, links and gameweek scores; and the
  -- season questions, options and answers.
  delete from gameweeks           where competition_id = v_comp;
  delete from season_pick_configs where competition_id = v_comp;

  -- ── Weeks ───────────────────────────────────────────────────────────────
  for w in
    select * from (values
      ('Week 8',  'completed', -15),
      ('Week 9',  'completed',  -8),
      ('Week 10', 'active',      6)
    ) as x(label, status, day_offset)
  loop
    insert into gameweeks (competition_id, number, status, month_key)
    values (v_comp, w.label, w.status,
            to_char(v_day + make_interval(days => w.day_offset), 'YYYY-MM'))
    returning id into v_gw;

    insert into competition_gameweeks (competition_id, gameweek_id) values (v_comp, v_gw);

    -- Games: away team @ home team, final score as away then home (null for
    -- the current week), kick-off hour UTC, extra day (Monday night), then
    -- each account's pick as HOME then AWAY, null where they have not picked.
    for g in
      select * from (values
        -- Week 8
        ('Week 8',  'Buffalo Bills',        'Kansas City Chiefs',   24,   27,   18,  0,   27,   24,   24,   20),
        ('Week 8',  'Philadelphia Eagles',  'Dallas Cowboys',       30,   20,   18,  0,   17,   24,   20,   23),
        ('Week 8',  'Detroit Lions',        'Green Bay Packers',    31,   24,   21,  0,   21,   24,   27,   24),
        ('Week 8',  'San Francisco 49ers',  'Seattle Seahawks',     17,   20,   21,  0,   17,   20,   24,   17),
        ('Week 8',  'Baltimore Ravens',     'Cincinnati Bengals',   28,   21,    1,  1,   20,   24,   24,   21),
        -- Week 9
        ('Week 9',  'Kansas City Chiefs',   'Denver Broncos',       23,   16,   18,  0,   17,   24,   20,   21),
        ('Week 9',  'New York Jets',        'Miami Dolphins',       13,   24,   18,  0,   24,   17,   20,   17),
        ('Week 9',  'Los Angeles Rams',     'Arizona Cardinals',    26,   23,   21,  0,   20,   24,   24,   20),
        ('Week 9',  'Minnesota Vikings',    'Chicago Bears',        20,   17,   21,  0,   17,   20,   16,   20),
        ('Week 9',  'Houston Texans',       'Indianapolis Colts',   24,   31,    1,  1,   27,   24,   23,   20),
        -- Week 10 (current, not played yet)
        ('Week 10', 'Buffalo Bills',        'Kansas City Chiefs',   null, null, 18,  0,   27,   20,   null, null),
        ('Week 10', 'Dallas Cowboys',       'Philadelphia Eagles',  null, null, 18,  0,   27,   17,   null, null),
        ('Week 10', 'Detroit Lions',        'San Francisco 49ers',  null, null, 21,  0,   21,   24,   null, null),
        ('Week 10', 'Green Bay Packers',    'Baltimore Ravens',     null, null, 21,  0,   null, null, null, null),
        ('Week 10', 'Pittsburgh Steelers',  'Cincinnati Bengals',   null, null,  1,  1,   null, null, null, null)
      ) as x(week, away_team, home_team, away_score, home_score, ko_hour, extra_day,
             player_home, player_away, admin_home, admin_away)
      where x.week = w.label
    loop
      declare
        v_fx   uuid;
        v_ko   timestamptz := v_day + make_interval(days => w.day_offset + g.extra_day, hours => g.ko_hour,
                                                    mins => case g.ko_hour when 21 then 25 when 1 then 15 else 0 end);
      begin
        insert into fixtures (gameweek_id, home_team, away_team, kickoff_time, home_score, away_score, status)
        values (v_gw, g.home_team, g.away_team, v_ko, g.home_score, g.away_score,
                case when g.home_score is null then 'upcoming' else 'completed' end)
        returning id into v_fx;

        if g.player_home is not null then
          insert into predictions (fixture_id, gameweek_id, user_id, predicted_home, predicted_away, submitted_at)
          values (v_fx, v_gw, v_player, g.player_home, g.player_away, least(v_ko, now()) - interval '1 day');
        end if;
        if g.admin_home is not null then
          insert into predictions (fixture_id, gameweek_id, user_id, predicted_home, predicted_away, submitted_at)
          values (v_fx, v_gw, v_admin, g.admin_home, g.admin_away, least(v_ko, now()) - interval '1 day');
        end if;
      end;
    end loop;
  end loop;

  -- ── Points for the finished weeks (same rules as the app's marginScore) ─
  update predictions p
     set points_earned = s.points
    from (
      select p2.id,
             public.nfl_margin_points(p2.predicted_home, p2.predicted_away,
                                      f.home_score, f.away_score, v_r) as points
        from predictions p2
        join fixtures  f  on f.id = p2.fixture_id and f.status = 'completed'
        join gameweeks gw on gw.id = f.gameweek_id and gw.competition_id = v_comp
    ) s
   where p.id = s.id;

  insert into gameweek_scores (competition_id, gameweek_id, user_id, points, exact_scores, correct_results)
  select v_comp, p.gameweek_id, p.user_id,
         sum(p.points_earned),
         count(*) filter (where p.predicted_home = f.home_score and p.predicted_away = f.away_score),
         count(*) filter (where sign(p.predicted_home - p.predicted_away) = sign(f.home_score - f.away_score))
    from predictions p
    join fixtures  f  on f.id = p.fixture_id and f.status = 'completed'
    join gameweeks gw on gw.id = p.gameweek_id and gw.competition_id = v_comp and gw.status = 'completed'
   group by p.gameweek_id, p.user_id
  on conflict (competition_id, gameweek_id, user_id) do update
     set points = excluded.points,
         exact_scores = excluded.exact_scores,
         correct_results = excluded.correct_results,
         updated_at = now();

  -- ── Season questions (the three free NFL ones) ──────────────────────────
  insert into season_pick_configs (competition_id, deadline, is_open)
  values (v_comp, now() + interval '10 days', true)
  returning id into v_cfg;

  for i in 1..3 loop
    insert into season_picks (config_id, label, points, sort_order)
    values (v_cfg,
            (array['Super Bowl Winner','AFC Champion','NFC Champion'])[i],
            10, i)
    returning id into v_pick;

    foreach t in array (case i when 1 then all_teams when 2 then afc_teams else nfc_teams end) loop
      insert into season_pick_options (pick_id, name, sort_order)
      values (v_pick, t, array_position(case i when 1 then all_teams when 2 then afc_teams else nfc_teams end, t));
    end loop;

    insert into season_pick_answers (pick_id, user_id, option_id)
    select v_pick, v_player, o.id from season_pick_options o
     where o.pick_id = v_pick
       and o.name = (array['Kansas City Chiefs','Kansas City Chiefs','Detroit Lions'])[i];

    insert into season_pick_answers (pick_id, user_id, option_id)
    select v_pick, v_admin, o.id from season_pick_options o
     where o.pick_id = v_pick
       and o.name = (array['Philadelphia Eagles','Buffalo Bills','Philadelphia Eagles'])[i];
  end loop;

  raise notice 'App Review Demo NFL test data ready for competition %', v_comp;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check. Expect three rows:
--   Week 8   completed  5 games  10 predictions  Review Player 52, Review Admin 27
--   Week 9   completed  5 games  10 predictions  Review Player 63, Review Admin 32
--   Week 10  active     5 games   3 predictions  no points yet
-- ---------------------------------------------------------------------------
select gw.number                                                        as week,
       gw.status,
       (select count(*) from fixtures f where f.gameweek_id = gw.id)     as games,
       (select count(*) from predictions p where p.gameweek_id = gw.id)  as predictions,
       (select string_agg(pr.display_name || ' ' || s.points, ', ' order by s.points desc)
          from gameweek_scores s join profiles pr on pr.id = s.user_id
         where s.gameweek_id = gw.id and s.competition_id = gw.competition_id) as points
  from gameweeks gw
  join competitions c on c.id = gw.competition_id
 where c.name = 'App Review Demo NFL'
 order by (select min(f.kickoff_time) from fixtures f where f.gameweek_id = gw.id);

-- Season questions: expect 3 rows, 32 / 16 / 16 options, 2 answers each.
select sp.label,
       (select count(*) from season_pick_options o where o.pick_id = sp.id) as options,
       (select count(*) from season_pick_answers a where a.pick_id = sp.id) as answers
  from season_picks sp
  join season_pick_configs cfg on cfg.id = sp.config_id
  join competitions c on c.id = cfg.competition_id
 where c.name = 'App Review Demo NFL'
 order by sp.sort_order;
