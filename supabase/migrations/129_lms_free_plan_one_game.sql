-- 129_lms_free_plan_one_game.sql
--
-- Free plan: one Last Man Standing game (Brittany, 16 Nov 2026). Starting any
-- further game needs Pro, including the next game after a roll-over. A game
-- the admin stopped before its first kick-off does not count.
--
-- Changes lms_start_game only. Safe to run more than once. Needs 128.
-- RUN ON DEV FIRST, then Prod.

-- ---------------------------------------------------------------------------
-- STEP 1 — lms_start_game with the free-plan check.
-- ---------------------------------------------------------------------------
create or replace function public.lms_start_game(
  p_competition_id uuid,
  p_sport          text,
  p_league_id      int,
  p_league_name    text,
  p_points         int  default 10,
  p_start_round    int  default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_comp   public.competitions;
  v_sport  text;
  v_season int;
  v_start  int;
  v_lock   timestamptz;
  v_carry  public.lms_games;
  v_level  int := 0;
  v_entry  int;
  v_number int;
  v_id     uuid;
begin
  if not is_competition_admin(p_competition_id) then return json_build_object('ok', false, 'error', 'not_admin'); end if;

  -- Free plan: one Last Man Standing game. Any game after that, including the
  -- next game after a roll-over, needs Pro. A game stopped before it started
  -- does not count.
  if not has_pro(auth.uid()) and exists (
    select 1 from public.lms_games g
    where g.created_by = auth.uid()
      and not (g.status = 'cancelled' and g.started_at is null)
  ) then
    return json_build_object('ok', false, 'error', 'pro_needed');
  end if;

  select * into v_comp from competitions where id = p_competition_id;
  if not found or v_comp.format <> 'last_man_standing' then return json_build_object('ok', false, 'error', 'not_lms'); end if;
  -- In the Last Man Standing section the admin chooses the sport for each
  -- game. One made earlier inside Football or NFL keeps that sport.
  v_sport := case when v_comp.sport in ('football', 'nfl') then v_comp.sport
                  else coalesce(p_sport, 'football') end;
  if v_sport not in ('football', 'nfl') then return json_build_object('ok', false, 'error', 'bad_sport'); end if;

  if exists (select 1 from lms_games where competition_id = p_competition_id and status in ('open', 'running')) then
    return json_build_object('ok', false, 'error', 'already_running');
  end if;
  if coalesce(p_points, 0) < 1 or p_points > 1000 then return json_build_object('ok', false, 'error', 'bad_points'); end if;

  v_season := lms_season(v_sport, p_league_id);
  if v_season is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;

  v_start := coalesce(p_start_round, lms_next_round(v_sport, p_league_id, v_season));
  if v_start is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;
  v_lock := lms_round_lock(v_sport, p_league_id, v_season, v_start);
  if v_lock is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;
  if v_lock <= now() then return json_build_object('ok', false, 'error', 'round_started'); end if;

  -- The last game, if nobody won it and its pot has not moved on yet.
  select * into v_carry from lms_games
  where competition_id = p_competition_id and status = 'no_winner' and rolled_into is null
  order by game_number desc limit 1;
  if v_carry.id is not null then v_level := v_carry.rollover_level + 1; end if;
  v_entry := p_points * (v_level + 1);

  select coalesce(max(game_number), 0) + 1 into v_number from lms_games where competition_id = p_competition_id;

  insert into lms_games (competition_id, game_number, sport, league_id, league_name, season,
                         start_round, current_round, base_points, rollover_level, entry_points,
                         carried_points, carried_from, created_by)
  values (p_competition_id, v_number, v_sport, p_league_id, coalesce(nullif(trim(p_league_name), ''), 'League'), v_season,
          v_start, v_start, p_points, v_level, v_entry,
          coalesce(v_carry.pot, 0), v_carry.id, auth.uid())
  returning id into v_id;

  if v_carry.id is not null then
    update lms_games set rolled_into = v_id where id = v_carry.id;

    -- Every entry from the rolled game comes back, adding only the extra points.
    insert into lms_entries (game_id, user_id, entry_no, stake, carried)
    select v_id, e.user_id, row_number() over (partition by e.user_id order by e.entry_no), p_points, true
    from lms_entries e
    where e.game_id = v_carry.id
      and exists (select 1 from participants pa where pa.competition_id = p_competition_id and pa.user_id = e.user_id);
  end if;

  -- Everyone else in the competition gets one entry at the full amount.
  insert into lms_entries (game_id, user_id, entry_no, stake)
  select v_id, pa.user_id, 1, v_entry
  from participants pa
  where pa.competition_id = p_competition_id
    and not exists (select 1 from lms_entries e where e.game_id = v_id and e.user_id = pa.user_id);

  return json_build_object('ok', true, 'game_id', v_id, 'start_round', v_start, 'locks_at', v_lock,
                           'carried', coalesce(v_carry.pot, 0), 'entry_points', v_entry);
end;
$$;

grant execute on function public.lms_start_game(uuid, text, int, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 2 — Check. Should show uses_free_plan_check = true.
-- ---------------------------------------------------------------------------
select position('pro_needed' in pg_get_functiondef('public.lms_start_game(uuid, text, int, text, int, int)'::regprocedure)) > 0
       as uses_free_plan_check;

-- ---------------------------------------------------------------------------
-- STEP 3 — Who sees Last Man Standing on the WEBSITE: site admins only (the
-- phone app shows it to everyone). Your account should be listed here.
-- ---------------------------------------------------------------------------
select display_name, role from public.profiles where role = 'admin' order by display_name;
