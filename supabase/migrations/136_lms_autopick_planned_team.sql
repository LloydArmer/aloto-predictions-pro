-- =============================================================================
-- 136 — Last Man Standing: a missed pick uses the planned team first.
--
-- At the deadline, an entry with no pick is given the team its owner planned
-- for that gameweek in the Planner, if that team plays in it and the entry
-- has not used it. Otherwise, as before, the lowest-placed team it has not
-- used. Either way the pick shows with the AUTO tag.
--
-- Run on Dev, then Prod, after 132. Safe to run more than once.
-- =============================================================================

-- STEP 0 — The planner (132) must already be in place.
do $$
begin
  if to_regclass('public.lms_plans') is null then
    raise exception 'Run 132_lms_pick_planner.sql on this project first, then this file.';
  end if;
end $$;

-- STEP 1 — Automatic picks: planned team first, then the lowest-placed team.
create or replace function public.lms_autopick(p_game_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  g lms_games;
  e lms_entries;
  v_lock timestamptz;
  v_team record;
  n int := 0;
begin
  select * into g from lms_games where id = p_game_id;
  v_lock := lms_round_lock(g.sport, g.league_id, g.season, g.current_round);
  if v_lock is null or v_lock > now() then return 0; end if;

  for e in
    select * from lms_entries x
    where x.game_id = g.id and x.status = 'alive'
      and not exists (select 1 from lms_picks p where p.entry_id = x.id and p.round = g.current_round)
  loop
    select t.team_id, t.team_name, t.api_fixture_id into v_team
    from (
      select f.home_team_id as team_id, f.home_team as team_name, f.api_fixture_id, f.kickoff
      from lms_fixtures f
      where f.sport = g.sport and f.league_id = g.league_id and f.season = g.season and f.round = g.current_round
        and not lms_is_void(f.status) and f.kickoff < v_lock + interval '7 days'
      union all
      select f.away_team_id, f.away_team, f.api_fixture_id, f.kickoff
      from lms_fixtures f
      where f.sport = g.sport and f.league_id = g.league_id and f.season = g.season and f.round = g.current_round
        and not lms_is_void(f.status) and f.kickoff < v_lock + interval '7 days'
    ) t
    left join lms_standings s
      on s.sport = g.sport and s.league_id = g.league_id and s.season = g.season and s.team_id = t.team_id
    -- The team this entry planned for this gameweek, if it can still be picked.
    left join lms_plans pl
      on pl.entry_id = e.id and pl.round = g.current_round and pl.team_id = t.team_id
    where t.team_id <> all (lms_used_teams(e.id, g.current_round))
    order by (pl.team_id is not null) desc, s.position desc nulls last, t.team_name desc
    limit 1;

    if v_team.team_id is not null then
      insert into lms_picks (game_id, entry_id, user_id, round, team_id, team_name, api_fixture_id, auto)
      values (g.id, e.id, e.user_id, g.current_round, v_team.team_id, v_team.team_name, v_team.api_fixture_id, true)
      on conflict (entry_id, round) do nothing;
      n := n + 1;
    end if;
    v_team := null;
  end loop;

  return n;
end;
$$;

revoke execute on function public.lms_autopick(uuid) from public, anon, authenticated;

-- STEP 2 — Check: expect planned_first = true.
select position('lms_plans' in pg_get_functiondef('public.lms_autopick(uuid)'::regprocedure)) > 0 as planned_first;
