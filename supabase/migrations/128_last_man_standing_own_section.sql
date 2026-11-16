-- 128_last_man_standing_own_section.sql
--
-- Last Man Standing gets its own place in the sport menu at the top of the
-- app, beside Football, NFL and F1 (Brittany, 16 Nov 2026), instead of being
-- a format inside Football and NFL.
--
--   * Adds 'Last Man Standing' to the sports list (crown, after F1).
--   * Moves every existing Last Man Standing competition into it. Its games,
--     entries and picks are not touched.
--   * A competition in that section can only be a Last Man Standing.
--   * When starting a game, the admin now chooses Football (any league) or
--     NFL for that game. lms_start_game takes the sport as its second value.
--
-- Safe to run more than once. Needs 126. RUN ON DEV FIRST, then Prod.

-- ---------------------------------------------------------------------------
-- STEP 0 — 126 must have been run on this project first.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.lms_games') is null then
    raise exception 'Run 126_last_man_standing.sql on this project first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 1 — The new entry in the sport menu.
-- ---------------------------------------------------------------------------
insert into public.sports (id, name, emoji, sort_order, enabled)
values ('lms', 'Last Man Standing', '👑', 4, true)
on conflict (id) do update
  set name = excluded.name, emoji = excluded.emoji, sort_order = excluded.sort_order, enabled = true;

-- ---------------------------------------------------------------------------
-- STEP 2 — Move existing Last Man Standing competitions into it.
-- ---------------------------------------------------------------------------
update public.competitions
set sport = 'lms'
where format = 'last_man_standing' and sport <> 'lms';

-- ---------------------------------------------------------------------------
-- STEP 3 — Only a Last Man Standing can live in that section.
-- ---------------------------------------------------------------------------
alter table public.competitions drop constraint if exists competitions_lms_section_check;
alter table public.competitions
  add constraint competitions_lms_section_check
  check (sport <> 'lms' or format = 'last_man_standing');

-- ---------------------------------------------------------------------------
-- STEP 4 — Starting a game: the admin chooses the sport for it.
-- ---------------------------------------------------------------------------
drop function if exists public.lms_start_game(uuid, int, text, int, int);

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
-- STEP 5 — Check. 'lms' should be listed and enabled, and every Last Man
-- Standing competition should be in it (lms_elsewhere = 0).
-- ---------------------------------------------------------------------------
select id, name, emoji, sort_order, enabled,
       (select count(*) from public.competitions where format = 'last_man_standing' and sport = 'lms') as lms_competitions,
       (select count(*) from public.competitions where format = 'last_man_standing' and sport <> 'lms') as lms_elsewhere
from public.sports
order by sort_order;
