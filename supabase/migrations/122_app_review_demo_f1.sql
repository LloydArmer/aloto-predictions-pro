-- 122_app_review_demo_f1.sql
--
-- Creates the "App Review Demo F1" league and puts both App Review accounts
-- in it, so Apple's reviewer can see the F1 side of 2.2.
--
-- Same pattern as 115/116 (the NFL demo). It does not create logins; the two
-- accounts already exist from 107:
--     appreview.admin@alotopredictionpro.co.uk   (admin of this league)
--     appreview.player@alotopredictionpro.co.uk  (player)
--
-- What it does:
--   1. Creates the league (sport f1) with chat on, and a few chat messages.
--   2. Adds every race of the latest F1 season already in the database.
--   3. Gives both accounts grid, sprint and race picks for every weekend that
--      has confirmed results, and scores them, so the table and results
--      screens have something in them.
--   4. Opens season predictions (Drivers' Champion) with a deadline 21 days
--      from now, and gives both accounts a champion pick.
--
-- BEFORE YOU RUN IT: the races must already be in the database. On
-- Production, after 119, 120 and the sync-f1 deploy, go to Admin > Races in
-- any F1 league and tap "Add races from the calendar", then "Fetch results".
-- This file stops with an error if it finds no races.
--
-- Run 119 first. Safe to run more than once (rerun it if review slips, to
-- pick up newer results and push the season deadline out again).
--
-- RUN ON PRODUCTION. (Dev too if you want to rehearse it.)

do $$
declare
  v_admin  uuid;
  v_player uuid;
  v_comp   uuid;
  v_season integer;
  v_cfg    uuid;
  v_race   record;
  v_n      integer := 0;
begin
  -- Run as the service role, so the scoring function lets this script score.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select id into v_admin  from auth.users where email = 'appreview.admin@alotopredictionpro.co.uk';
  select id into v_player from auth.users where email = 'appreview.player@alotopredictionpro.co.uk';

  if v_admin is null or v_player is null then
    raise exception
      'Review accounts not found (admin found: %, player found: %). Run 107 first.',
      v_admin is not null, v_player is not null;
  end if;

  select max(season) into v_season from f1_races;
  if v_season is null then
    raise exception 'No F1 races in the database yet. In any F1 league, go to Admin > Races and tap "Add races from the calendar", then run this again.';
  end if;

  -- ── 1. The league ───────────────────────────────────────────────────────
  select id into v_comp from competitions where name = 'App Review Demo F1';

  if v_comp is null then
    insert into competitions (name, emoji, format, status, created_by, sport)
    values ('App Review Demo F1', '🏎️', 'league', 'active', v_admin, 'f1')
    returning id into v_comp;
  end if;

  update competitions set chat_enabled = true, sport = 'f1' where id = v_comp;

  insert into participants (competition_id, user_id, role) values
    (v_comp, v_admin,  'admin'),
    (v_comp, v_player, 'player')
  on conflict (competition_id, user_id) do update set role = excluded.role;

  if not exists (select 1 from chat_messages where competition_id = v_comp) then
    insert into chat_messages (competition_id, user_id, body, created_at) values
      (v_comp, v_admin,  'Welcome to the F1 league. Grid picks lock when qualifying starts', now() - interval '9 days'),
      (v_comp, v_player, 'Pole position nailed. Five points, thank you very much', now() - interval '9 days' + interval '25 minutes'),
      (v_comp, v_admin,  'Lucky. My race pick is going to win it back on Sunday', now() - interval '9 days' + interval '48 minutes'),
      (v_comp, v_player, 'Sprint weekend next, remember there are four picks to make', now() - interval '2 days'),
      (v_comp, v_admin,  'Got them in. Champion pick is open as well, do not forget it', now() - interval '2 days' + interval '15 minutes');
  end if;

  -- ── 2. The races ────────────────────────────────────────────────────────
  insert into competition_gameweeks (competition_id, gameweek_id)
  select v_comp, r.gameweek_id
  from f1_races r
  where r.season = v_season
    and not exists (select 1 from competition_gameweeks cg
                    where cg.competition_id = v_comp and cg.gameweek_id = r.gameweek_id);

  -- ── 3. Picks for every confirmed session, then score ───────────────────
  -- Each account's pick is the real result with some places swapped, so both
  -- get some exactly right and some wrong. Admin: every third place exact.
  -- Player: two right, two swapped, all the way down.
  for v_race in
    select r.* from f1_races r
    where r.season = v_season
      and (r.grid_confirmed or r.race_confirmed or r.sprint_grid_confirmed or r.sprint_confirmed)
  loop
    delete from f1_picks where race_id = v_race.id and user_id in (v_admin, v_player);

    with res as (
      select f.session, f.driver_id, f.position,
             row_number() over (partition by f.session order by f.position) as rn,
             count(*)     over (partition by f.session)                    as n
      from f1_results f
      where f.race_id = v_race.id and f.position is not null
        and ((f.session = 'grid'        and v_race.grid_confirmed)
          or (f.session = 'race'        and v_race.race_confirmed)
          or (f.session = 'sprint_grid' and v_race.sprint_grid_confirmed)
          or (f.session = 'sprint'      and v_race.sprint_confirmed))
    ),
    moves as (
      select v_admin as user_id, session, driver_id, n,
             case when rn % 3 = 2 and rn + 1 <= n then rn + 1
                  when rn % 3 = 0 then rn - 1
                  else rn end as target
      from res
      union all
      select v_player, session, driver_id, n,
             case when rn % 4 = 1 and rn + 1 <= n then rn + 1
                  when rn % 4 = 2 then rn - 1
                  else rn end
      from res
    )
    insert into f1_picks (race_id, session, user_id, position, driver_id)
    select v_race.id, m.session, m.user_id, t.position, m.driver_id
    from moves m
    join res t on t.session = m.session and t.rn = m.target
    where t.position <= 22;

    perform f1_score_race(v_race.id);
    v_n := v_n + 1;
  end loop;

  -- ── 4. Season predictions ───────────────────────────────────────────────
  insert into f1_season_configs (competition_id, season, is_open, deadline)
  values (v_comp, v_season, true, now() + interval '21 days')
  on conflict (competition_id) do update
    set season = excluded.season, is_open = true, deadline = excluded.deadline, settled = false;

  select id into v_cfg from f1_season_configs where competition_id = v_comp;

  delete from f1_season_entries where config_id = v_cfg and user_id in (v_admin, v_player);

  insert into f1_season_entries (config_id, user_id, kind, position, driver_id)
  select v_cfg, u.user_id, 'champion', 1, c.driver_id
  from (values (v_admin, 1), (v_player, 2)) as u(user_id, pos)
  join f1_championship c on c.season = v_season and c.kind = 'drivers' and c.position = u.pos
  where c.driver_id is not null;

  raise notice 'App Review Demo F1 ready. Competition %, season %, % race weekends scored', v_comp, v_season, v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check. Every true/false column should read true. races should be the number
-- of rounds in the season, scored_races the number already run.
-- ---------------------------------------------------------------------------
select
  c.name,
  c.sport = 'f1'                                                                  as is_f1,
  c.chat_enabled,
  (select count(*) from participants p where p.competition_id = c.id) = 2          as both_accounts_in,
  (select count(*) from competition_gameweeks cg where cg.competition_id = c.id)   as races,
  (select count(distinct race_id) from f1_race_scores s where s.competition_id = c.id) as scored_races,
  (select is_open from f1_season_configs f where f.competition_id = c.id)          as season_open,
  (select count(*) from chat_messages m where m.competition_id = c.id)             as messages,
  c.join_code
from competitions c
where c.name = 'App Review Demo F1';
