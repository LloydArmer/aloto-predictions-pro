-- 126_last_man_standing.sql
--
-- Last Man Standing (Brittany, 15 and 16 Nov 2026). REPLACES the first
-- version (the old 123_last_man_standing.sql, removed). If that was run, its
-- tables are dropped here and rebuilt: any test games in them are deleted.
--
-- HOW IT PLAYS
--
--   The admin chooses the sport and league: any football league API-Sports
--   covers (Premier League, Championship, La Liga...) or the NFL. Every
--   gameweek (NFL: every week), each entry still in picks ONE team to win.
--   Win and the entry goes through; draw or lose and it is out. An entry can
--   only pick each team once (the list starts again once every team in the
--   league has been used). Last player standing takes the pot.
--
--   Picks lock at the first kick-off of the gameweek. Nobody can make, change
--   or add an entry after that, and nobody sees anyone else's pick until then.
--
--   NO PICK BY THE DEADLINE: the entry is given the lowest-placed team in the
--   league table that plays that gameweek and that entry has not used yet.
--
--   A postponed or abandoned game counts as a win, and the team counts as used.
--
--   MULTIPLE ENTRIES: a player can enter more than once, until the first
--   kick-off. Each entry is its own life with its own picks.
--
--   POINTS AND ROLL-OVERS: each entry brings the admin's points (10 by
--   default). If everyone left goes out in the same gameweek there is no
--   winner and the pot rolls into the next game, where every entry is worth
--   10 more: 20 after the first roll-over, 30 after the second, and so on.
--   Entries carried over from the rolled game only add the extra 10 (they
--   already put their earlier points in). New players, and extra entries,
--   bring the full amount. A game with a winner resets it to 10.
--
--   Bragging points only. Nobody pays for points and they are never worth
--   money (paid entry for a prize would be pool betting under the Gambling Act).
--
-- HOW IT FITS THE APP
--
--   A Last Man Standing is a competition with format 'last_man_standing', in
--   the football or NFL sport, so join codes, players, chat and the admin's
--   role work as they do for a league. One game runs at a time (lms_games).
--   The fixtures and league tables are filled by the sync-lms edge function
--   from API-Sports; lms_settle() (called by sync-lms every 10 minutes) gives
--   out the automatic picks at the deadline and settles each gameweek once
--   every game in it has finished. Nobody enters a result.
--
-- FREE PLAN: one Last Man Standing. Pro: unlimited.
--
-- Safe to run more than once. RUN ON DEV FIRST, then Prod. Needs 053, 060, 118.

-- ---------------------------------------------------------------------------
-- STEP 1 — Remove the first version, if it was run.
-- ---------------------------------------------------------------------------
drop table if exists public.lms_notify_log cascade;
drop table if exists public.lms_picks      cascade;
drop table if exists public.lms_entries    cascade;
drop table if exists public.lms_games      cascade;
drop table if exists public.lms_fixtures   cascade;
drop table if exists public.lms_standings  cascade;
drop table if exists public.lms_sync_state cascade;

drop function if exists public.lms_make_pick(uuid, int);
drop function if exists public.lms_start_game(uuid, int, int);
drop function if exists public.lms_update_game(uuid, int, int);
drop function if exists public.lms_cancel_game(uuid);
drop function if exists public.lms_pick_status(uuid);
drop function if exists public.lms_used_teams(uuid, uuid, int);
drop function if exists public.lms_round_lock(int, int);
drop function if exists public.lms_next_round(int, int);
drop function if exists public.lms_round_settled(int, int);
drop function if exists public.lms_current_season();
drop function if exists public.lms_pick_outcome(uuid);
drop function if exists public.lms_game_pot(uuid);
drop function if exists public.lms_settle();
drop function if exists public.lms_due_reminders();

-- ---------------------------------------------------------------------------
-- STEP 2 — Allow the format on competitions.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.competitions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%format%'
  loop
    execute format('alter table public.competitions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.competitions
  add constraint competitions_format_check
  check (format in ('league', 'knockout', 'group_knockout', 'last_man_standing'));

-- ---------------------------------------------------------------------------
-- STEP 3 — Fixtures and league tables from API-Sports, shared by every game.
-- Written only by sync-lms. status is the feed's short code: NS not started,
-- FT full time (NFL also AOT after overtime), PST postponed, CANC cancelled,
-- ABD abandoned.
-- ---------------------------------------------------------------------------
create table public.lms_fixtures (
  sport          text   not null check (sport in ('football', 'nfl')),
  api_fixture_id bigint not null,
  league_id      int    not null,
  season         int    not null,
  round          int    not null,
  kickoff        timestamptz not null,
  status         text not null default 'NS',
  home_team_id   int  not null,
  home_team      text not null,
  away_team_id   int  not null,
  away_team      text not null,
  home_goals     int,
  away_goals     int,
  updated_at     timestamptz not null default now(),
  primary key (sport, api_fixture_id)
);

create index idx_lms_fixtures_round on public.lms_fixtures (sport, league_id, season, round);

-- position 1 = top of the table. The highest number is the lowest-placed team.
create table public.lms_standings (
  sport      text not null,
  league_id  int  not null,
  season     int  not null,
  team_id    int  not null,
  team_name  text not null,
  position   int  not null,
  updated_at timestamptz not null default now(),
  primary key (sport, league_id, season, team_id)
);

-- When sync-lms last refreshed each league, so it only asks when it needs to.
create table public.lms_sync_state (
  sport        text not null,
  league_id    int  not null,
  season       int  not null,
  fixtures_at  timestamptz,
  standings_at timestamptz,
  primary key (sport, league_id, season)
);

-- ---------------------------------------------------------------------------
-- STEP 4 — Games, entries and picks.
-- ---------------------------------------------------------------------------
create table public.lms_games (
  id             uuid primary key default uuid_generate_v4(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  game_number    int  not null,
  sport          text not null check (sport in ('football', 'nfl')),
  league_id      int  not null,
  league_name    text not null,
  season         int  not null,
  start_round    int  not null,
  current_round  int  not null,
  base_points    int  not null default 10 check (base_points between 1 and 1000),
  -- 0 for a fresh game, 1 after one roll-over, 2 after two...
  rollover_level int  not null default 0,
  -- What a new entry brings: base_points x (rollover_level + 1).
  entry_points   int  not null,
  carried_points int  not null default 0,
  carried_from   uuid references public.lms_games(id) on delete set null,
  -- open: taking entries before the first gameweek locks. running: under way.
  -- won / no_winner: finished. cancelled: stopped by the admin.
  status         text not null default 'open'
                 check (status in ('open', 'running', 'won', 'no_winner', 'cancelled')),
  winner_user_id uuid references public.profiles(id) on delete set null,
  pot            int,
  ended_round    int,
  rolled_into    uuid references public.lms_games(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  unique (competition_id, game_number)
);

create unique index idx_lms_games_one_live
  on public.lms_games (competition_id) where status in ('open', 'running');

create table public.lms_entries (
  id         uuid primary key default uuid_generate_v4(),
  game_id    uuid not null references public.lms_games(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  entry_no   int  not null,
  stake      int  not null,                -- points this entry put in the pot
  carried    boolean not null default false, -- re-entered from a rolled game
  status     text not null default 'alive' check (status in ('alive', 'out', 'winner')),
  out_round  int,
  out_reason text check (out_reason in ('lost', 'drew', 'no_pick')),
  joined_at  timestamptz not null default now(),
  unique (game_id, user_id, entry_no)
);

create index idx_lms_entries_game on public.lms_entries (game_id);

create table public.lms_picks (
  id             uuid primary key default uuid_generate_v4(),
  game_id        uuid not null references public.lms_games(id) on delete cascade,
  entry_id       uuid not null references public.lms_entries(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  round          int  not null,
  team_id        int  not null,
  team_name      text not null,
  api_fixture_id bigint not null,
  auto           boolean not null default false,  -- given at the deadline
  outcome        text check (outcome in ('won', 'drew', 'lost', 'void')),
  picked_at      timestamptz not null default now(),
  unique (entry_id, round)
);

create index idx_lms_picks_game_round on public.lms_picks (game_id, round);

create table public.lms_notify_log (
  game_id uuid not null references public.lms_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  round   int  not null,
  kind    text not null,
  sent_at timestamptz not null default now(),
  primary key (game_id, user_id, round, kind)
);

-- ---------------------------------------------------------------------------
-- STEP 5 — Gameweek helpers.
--
-- A gameweek's deadline is its first kick-off (postponed games left out). Its
-- games are those within 7 days of that deadline: a game moved weeks later
-- keeps its round number in the feed but is no longer part of this gameweek.
-- ---------------------------------------------------------------------------
create or replace function public.lms_is_finished(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('FT', 'AET', 'PEN', 'AWD', 'WO', 'AOT');
$$;

create or replace function public.lms_is_void(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('PST', 'CANC', 'ABD');
$$;

create or replace function public.lms_round_lock(p_sport text, p_league int, p_season int, p_round int)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(kickoff) from lms_fixtures
  where sport = p_sport and league_id = p_league and season = p_season and round = p_round
    and not lms_is_void(status);
$$;

create or replace function public.lms_game_lock(p_game_id uuid, p_round int default null)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select lms_round_lock(g.sport, g.league_id, g.season, coalesce(p_round, g.current_round))
  from lms_games g where g.id = p_game_id;
$$;

-- The first gameweek after p_after that has not kicked off yet.
create or replace function public.lms_next_round(p_sport text, p_league int, p_season int, p_after int default 0)
returns int
language sql stable security definer set search_path = public as $$
  select min(round) from (
    select round, min(kickoff) as lock
    from lms_fixtures
    where sport = p_sport and league_id = p_league and season = p_season
      and round > p_after and not lms_is_void(status)
    group by round
  ) r
  where r.lock > now();
$$;

-- Has every game in the gameweek finished (or been called off)? A game still
-- "not started" three days after kick-off is treated as called off.
create or replace function public.lms_round_settled(p_sport text, p_league int, p_season int, p_round int)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_lock timestamptz := lms_round_lock(p_sport, p_league, p_season, p_round);
begin
  if v_lock is null or v_lock > now() then return false; end if;
  return not exists (
    select 1 from lms_fixtures
    where sport = p_sport and league_id = p_league and season = p_season and round = p_round
      and kickoff < v_lock + interval '7 days'
      and not lms_is_finished(status)
      and not lms_is_void(status)
      and kickoff > now() - interval '3 days'
  );
end;
$$;

-- The season to play: the latest one loaded for this league.
create or replace function public.lms_season(p_sport text, p_league int)
returns int
language sql stable security definer set search_path = public as $$
  select max(season) from lms_fixtures where sport = p_sport and league_id = p_league;
$$;

-- How many teams the league has (the used list restarts after this many).
create or replace function public.lms_team_count(p_sport text, p_league int, p_season int)
returns int
language sql stable security definer set search_path = public as $$
  select greatest(count(distinct t), 2)::int from (
    select home_team_id as t from lms_fixtures where sport = p_sport and league_id = p_league and season = p_season
    union
    select away_team_id from lms_fixtures where sport = p_sport and league_id = p_league and season = p_season
  ) x;
$$;

-- Teams this entry cannot pick in p_round.
create or replace function public.lms_used_teams(p_entry_id uuid, p_round int)
returns int[]
language sql stable security definer set search_path = public as $$
  with g as (
    select lms_team_count(g.sport, g.league_id, g.season) as n
    from lms_entries e join lms_games g on g.id = e.game_id where e.id = p_entry_id
  ),
  mine as (
    select team_id, row_number() over (order by round) as k, count(*) over () as total
    from lms_picks where entry_id = p_entry_id and round < p_round
  )
  select coalesce(array_agg(team_id), '{}')
  from mine, g
  where k > (total / g.n) * g.n;
$$;

-- won, drew, lost or void. Null while still to play.
create or replace function public.lms_pick_outcome(p_pick_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  p lms_picks;
  g lms_games;
  f lms_fixtures;
  v_lock timestamptz;
  mine int; theirs int;
begin
  select * into p from lms_picks where id = p_pick_id;
  if not found then return null; end if;
  select * into g from lms_games where id = p.game_id;
  select * into f from lms_fixtures where sport = g.sport and api_fixture_id = p.api_fixture_id;
  if not found then return 'void'; end if;

  v_lock := lms_round_lock(g.sport, g.league_id, g.season, p.round);

  if lms_is_void(f.status)
     or f.kickoff >= coalesce(v_lock, f.kickoff) + interval '7 days'
     or (not lms_is_finished(f.status) and f.kickoff < now() - interval '3 days') then
    return 'void';
  end if;

  if not lms_is_finished(f.status) or f.home_goals is null or f.away_goals is null then
    return null;
  end if;

  if f.home_team_id = p.team_id then mine := f.home_goals; theirs := f.away_goals;
  else mine := f.away_goals; theirs := f.home_goals; end if;

  return case when mine > theirs then 'won' when mine = theirs then 'drew' else 'lost' end;
end;
$$;

create or replace function public.lms_game_pot(p_game_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select g.carried_points + coalesce((select sum(stake) from lms_entries e where e.game_id = g.id), 0)::int
  from lms_games g where g.id = p_game_id;
$$;

-- The game's fixture for a team in a gameweek (pickable games only).
create or replace function public.lms_team_fixture(p_game_id uuid, p_round int, p_team_id int)
returns lms_fixtures
language sql stable security definer set search_path = public as $$
  select f.* from lms_games g
  join lms_fixtures f on f.sport = g.sport and f.league_id = g.league_id and f.season = g.season
  where g.id = p_game_id and f.round = p_round
    and not lms_is_void(f.status)
    and f.kickoff < lms_round_lock(g.sport, g.league_id, g.season, p_round) + interval '7 days'
    and (f.home_team_id = p_team_id or f.away_team_id = p_team_id)
  order by f.kickoff
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- STEP 6 — Players: picking, adding and removing entries.
-- ---------------------------------------------------------------------------
create or replace function public.lms_make_pick(p_entry_id uuid, p_team_id int)
returns json
language plpgsql security definer set search_path = public as $$
declare
  e lms_entries;
  g lms_games;
  f lms_fixtures;
  v_lock timestamptz;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'not_signed_in'); end if;

  select * into e from lms_entries where id = p_entry_id;
  if not found or e.user_id <> auth.uid() then return json_build_object('ok', false, 'error', 'not_entered'); end if;
  if e.status <> 'alive' then return json_build_object('ok', false, 'error', 'out'); end if;

  select * into g from lms_games where id = e.game_id;
  if g.status not in ('open', 'running') then return json_build_object('ok', false, 'error', 'finished'); end if;

  v_lock := lms_round_lock(g.sport, g.league_id, g.season, g.current_round);
  if v_lock is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;
  if now() >= v_lock then return json_build_object('ok', false, 'error', 'locked'); end if;

  f := lms_team_fixture(g.id, g.current_round, p_team_id);
  if f.api_fixture_id is null then return json_build_object('ok', false, 'error', 'not_playing'); end if;

  if p_team_id = any (lms_used_teams(e.id, g.current_round)) then
    return json_build_object('ok', false, 'error', 'used');
  end if;

  insert into lms_picks (game_id, entry_id, user_id, round, team_id, team_name, api_fixture_id)
  values (g.id, e.id, e.user_id, g.current_round, p_team_id,
          case when f.home_team_id = p_team_id then f.home_team else f.away_team end,
          f.api_fixture_id)
  on conflict (entry_id, round) do update
    set team_id = excluded.team_id, team_name = excluded.team_name,
        api_fixture_id = excluded.api_fixture_id, auto = false, picked_at = now();

  return json_build_object('ok', true, 'round', g.current_round, 'locks_at', v_lock);
end;
$$;

grant execute on function public.lms_make_pick(uuid, int) to authenticated;

-- Another entry for yourself, until the first kick-off of the game.
create or replace function public.lms_add_entry(p_game_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  g lms_games;
  v_no int;
  v_id uuid;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into g from lms_games where id = p_game_id;
  if not found or not is_participant(g.competition_id) then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if g.status <> 'open' or coalesce(lms_round_lock(g.sport, g.league_id, g.season, g.start_round), 'infinity') <= now() then
    return json_build_object('ok', false, 'error', 'entries_closed');
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_no from lms_entries where game_id = g.id and user_id = auth.uid();
  if v_no > 10 then return json_build_object('ok', false, 'error', 'too_many'); end if;

  insert into lms_entries (game_id, user_id, entry_no, stake)
  values (g.id, auth.uid(), v_no, g.entry_points)
  returning id into v_id;

  return json_build_object('ok', true, 'entry_id', v_id, 'entry_no', v_no, 'stake', g.entry_points);
end;
$$;

grant execute on function public.lms_add_entry(uuid) to authenticated;

-- Take back one of your entries, until the first kick-off of the game.
create or replace function public.lms_remove_entry(p_entry_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  e lms_entries;
  g lms_games;
begin
  select * into e from lms_entries where id = p_entry_id;
  if not found or e.user_id <> auth.uid() then return json_build_object('ok', false, 'error', 'not_entered'); end if;
  select * into g from lms_games where id = e.game_id;
  if g.status <> 'open' or coalesce(lms_round_lock(g.sport, g.league_id, g.season, g.start_round), 'infinity') <= now() then
    return json_build_object('ok', false, 'error', 'entries_closed');
  end if;
  delete from lms_entries where id = e.id;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.lms_remove_entry(uuid) to authenticated;

-- Which entries have picked this gameweek, without saying what.
create or replace function public.lms_pick_status(p_game_id uuid)
returns table (entry_id uuid, has_pick boolean)
language sql stable security definer set search_path = public as $$
  select e.id,
         exists (select 1 from lms_picks p where p.entry_id = e.id and p.round = g.current_round)
  from lms_games g
  join lms_entries e on e.game_id = g.id
  where g.id = p_game_id and is_participant(g.competition_id);
$$;

grant execute on function public.lms_pick_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 7 — Admins: start, change and stop a game.
-- ---------------------------------------------------------------------------
create or replace function public.lms_start_game(
  p_competition_id uuid,
  p_league_id      int,
  p_league_name    text,
  p_points         int  default 10,
  p_start_round    int  default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_comp   competitions;
  v_sport  text;
  v_season int;
  v_start  int;
  v_lock   timestamptz;
  v_carry  lms_games;
  v_level  int := 0;
  v_entry  int;
  v_number int;
  v_id     uuid;
begin
  if not is_competition_admin(p_competition_id) then return json_build_object('ok', false, 'error', 'not_admin'); end if;

  select * into v_comp from competitions where id = p_competition_id;
  if not found or v_comp.format <> 'last_man_standing' then return json_build_object('ok', false, 'error', 'not_lms'); end if;
  v_sport := coalesce(v_comp.sport, 'football');
  if v_sport not in ('football', 'nfl') then return json_build_object('ok', false, 'error', 'not_lms'); end if;

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

grant execute on function public.lms_start_game(uuid, int, text, int, int) to authenticated;

-- Change the points or the first gameweek while the game is taking entries.
create or replace function public.lms_update_game(p_game_id uuid, p_points int, p_start_round int)
returns json
language plpgsql security definer set search_path = public as $$
declare
  g lms_games;
  v_lock timestamptz;
begin
  select * into g from lms_games where id = p_game_id;
  if not found or not is_competition_admin(g.competition_id) then return json_build_object('ok', false, 'error', 'not_admin'); end if;
  if g.status <> 'open' then return json_build_object('ok', false, 'error', 'started'); end if;
  if coalesce(p_points, 0) < 1 or p_points > 1000 then return json_build_object('ok', false, 'error', 'bad_points'); end if;

  v_lock := lms_round_lock(g.sport, g.league_id, g.season, p_start_round);
  if v_lock is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;
  if v_lock <= now() then return json_build_object('ok', false, 'error', 'round_started'); end if;

  if p_start_round <> g.start_round then delete from lms_picks where game_id = g.id; end if;

  update lms_games
  set base_points = p_points, entry_points = p_points * (rollover_level + 1),
      start_round = p_start_round, current_round = p_start_round
  where id = g.id;

  update lms_entries
  set stake = case when carried then p_points else p_points * (g.rollover_level + 1) end
  where game_id = g.id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.lms_update_game(uuid, int, int) to authenticated;

create or replace function public.lms_cancel_game(p_game_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  g lms_games;
begin
  select * into g from lms_games where id = p_game_id;
  if not found or not is_competition_admin(g.competition_id) then return json_build_object('ok', false, 'error', 'not_admin'); end if;
  if g.status not in ('open', 'running') then return json_build_object('ok', false, 'error', 'finished'); end if;

  update lms_games set status = 'cancelled', finished_at = now() where id = g.id;
  -- The rolled-over pot goes back, ready for the next game.
  if g.carried_from is not null then update lms_games set rolled_into = null where id = g.carried_from; end if;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.lms_cancel_game(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 8 — Joining the competition enters the open game; leaving removes it.
-- ---------------------------------------------------------------------------
create or replace function public.lms_on_participant_added()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into lms_entries (game_id, user_id, entry_no, stake)
  select g.id, new.user_id, 1, g.entry_points
  from lms_games g
  where g.competition_id = new.competition_id
    and g.status = 'open'
    and coalesce(lms_round_lock(g.sport, g.league_id, g.season, g.start_round), 'infinity') > now()
    and not exists (select 1 from lms_entries e where e.game_id = g.id and e.user_id = new.user_id);
  return new;
end;
$$;

drop trigger if exists trg_lms_participant_added on public.participants;
create trigger trg_lms_participant_added
after insert on public.participants
for each row execute function public.lms_on_participant_added();

create or replace function public.lms_on_participant_removed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from lms_entries e
  using lms_games g
  where e.game_id = g.id and g.competition_id = old.competition_id
    and g.status = 'open' and e.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists trg_lms_participant_removed on public.participants;
create trigger trg_lms_participant_removed
after delete on public.participants
for each row execute function public.lms_on_participant_removed();

-- ---------------------------------------------------------------------------
-- STEP 9 — Automatic picks at the deadline.
--
-- Every entry still in with no pick gets the lowest-placed team in the league
-- table that plays this gameweek and that this entry has not used. With no
-- table yet (the first week of a season) the team is chosen alphabetically
-- from the end, so it is still never random. An entry with no team left to
-- give stays without a pick and goes out.
-- ---------------------------------------------------------------------------
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
    where t.team_id <> all (lms_used_teams(e.id, g.current_round))
    order by s.position desc nulls last, t.team_name desc
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

-- ---------------------------------------------------------------------------
-- STEP 10 — Settling. Called by sync-lms every 10 minutes (service role only).
--
--   Taking entries: when the first gameweek locks, the game starts (with at
--   least two players; otherwise it waits for the next gameweek).
--   At the deadline: automatic picks for entries with none.
--   When every game in the gameweek has finished: winners and called-off
--   games go through, everyone else is out. One player left (even with
--   several entries) = winner. Nobody left = no winner, the pot rolls over.
--   Otherwise on to the next gameweek.
--
-- Returns one row per notification to send.
-- ---------------------------------------------------------------------------
create or replace function public.lms_settle()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g        lms_games;
  e        lms_entries;
  p        lms_picks;
  v_comp   text;
  v_lock   timestamptz;
  v_next   int;
  v_players int;
  v_out    text;
  v_auto   int;
  v_ev     jsonb;
  v_outs   jsonb;
  v_pot    int;
  v_left_users uuid[];
  v_left_n int;
  events   jsonb := '[]'::jsonb;
begin
  for g in select * from lms_games where status in ('open', 'running') order by created_at for update loop
    select name into v_comp from competitions where id = g.competition_id;

    if g.status = 'open' then
      v_lock := lms_round_lock(g.sport, g.league_id, g.season, g.start_round);
      if v_lock is null or v_lock > now() then continue; end if;

      select count(distinct user_id) into v_players from lms_entries where game_id = g.id;
      if v_players < 2 then
        v_next := lms_next_round(g.sport, g.league_id, g.season, g.start_round);
        if v_next is null then
          update lms_games set status = 'cancelled', finished_at = now() where id = g.id;
        else
          update lms_games set start_round = v_next, current_round = v_next where id = g.id;
          delete from lms_picks where game_id = g.id;
        end if;
        continue;
      end if;

      update lms_games set status = 'running', current_round = start_round, started_at = now() where id = g.id;
      g.status := 'running';
      g.current_round := g.start_round;
    end if;

    -- Deadline passed: give out the automatic picks (once; it skips entries
    -- that already have one).
    v_auto := lms_autopick(g.id);
    if v_auto > 0 then
      events := events || (
        select coalesce(jsonb_agg(jsonb_build_object(
          'kind', 'autopick', 'user_id', p2.user_id, 'game_id', g.id, 'competition_id', g.competition_id,
          'competition', v_comp, 'round', g.current_round, 'team', p2.team_name)), '[]'::jsonb)
        from lms_picks p2
        where p2.game_id = g.id and p2.round = g.current_round and p2.auto
          and not exists (select 1 from lms_notify_log l where l.game_id = g.id and l.user_id = p2.user_id
                          and l.round = g.current_round and l.kind = 'autopick'));
      insert into lms_notify_log (game_id, user_id, round, kind)
      select distinct g.id, p2.user_id, g.current_round, 'autopick'
      from lms_picks p2 where p2.game_id = g.id and p2.round = g.current_round and p2.auto
      on conflict do nothing;
    end if;

    if not lms_round_settled(g.sport, g.league_id, g.season, g.current_round) then continue; end if;

    v_ev := '[]'::jsonb;
    v_outs := '[]'::jsonb;

    for e in select * from lms_entries where game_id = g.id and status = 'alive' loop
      select * into p from lms_picks where entry_id = e.id and round = g.current_round;

      if not found then
        update lms_entries set status = 'out', out_round = g.current_round, out_reason = 'no_pick' where id = e.id;
        v_outs := v_outs || jsonb_build_object('user_id', e.user_id, 'entry_no', e.entry_no, 'reason', 'no_pick', 'team', null);
        continue;
      end if;

      v_out := coalesce(lms_pick_outcome(p.id), 'void');
      update lms_picks set outcome = v_out where id = p.id;

      if v_out in ('won', 'void') then
        v_ev := v_ev || jsonb_build_object('user_id', e.user_id, 'entry_no', e.entry_no, 'team', p.team_name, 'void', v_out = 'void');
      else
        update lms_entries set status = 'out', out_round = g.current_round, out_reason = v_out where id = e.id;
        v_outs := v_outs || jsonb_build_object('user_id', e.user_id, 'entry_no', e.entry_no, 'reason', v_out, 'team', p.team_name);
      end if;
    end loop;

    select array_agg(distinct user_id) into v_left_users from lms_entries where game_id = g.id and status = 'alive';
    v_left_n := coalesce(array_length(v_left_users, 1), 0);
    v_pot := lms_game_pot(g.id);

    if v_left_n = 1 then
      update lms_entries set status = 'winner' where game_id = g.id and status = 'alive';
      update lms_games
      set status = 'won', winner_user_id = v_left_users[1], pot = v_pot, ended_round = g.current_round, finished_at = now()
      where id = g.id;
      events := events || jsonb_build_object(
        'kind', 'winner', 'user_id', v_left_users[1], 'game_id', g.id, 'competition_id', g.competition_id,
        'competition', v_comp, 'round', g.current_round, 'pot', v_pot);

    elsif v_left_n = 0 then
      update lms_games set status = 'no_winner', pot = v_pot, ended_round = g.current_round, finished_at = now()
      where id = g.id;

    else
      v_next := lms_next_round(g.sport, g.league_id, g.season, g.current_round);
      if v_next is null then
        -- The season ran out with several still in: no outright winner, so
        -- the pot rolls over.
        update lms_games set status = 'no_winner', pot = v_pot, ended_round = g.current_round, finished_at = now()
        where id = g.id;
      else
        update lms_games set current_round = v_next where id = g.id;
        events := events || (
          select coalesce(jsonb_agg(x || jsonb_build_object(
            'kind', 'through', 'game_id', g.id, 'competition_id', g.competition_id, 'competition', v_comp,
            'round', g.current_round, 'next_round', v_next, 'left', v_left_n)), '[]'::jsonb)
          from jsonb_array_elements(v_ev) x);
      end if;
    end if;

    events := events || (
      select coalesce(jsonb_agg(o || jsonb_build_object(
        'kind', 'out', 'game_id', g.id, 'competition_id', g.competition_id, 'competition', v_comp,
        'round', g.current_round, 'pot', v_pot, 'no_winner', v_left_n = 0)), '[]'::jsonb)
      from jsonb_array_elements(v_outs) o);
  end loop;

  return events;
end;
$$;

revoke execute on function public.lms_settle() from public, anon, authenticated;
grant execute on function public.lms_settle() to service_role;

-- Pick reminders, 24 hours and 2 hours before the deadline, one per player
-- (however many entries still need a pick). Each is returned once.
create or replace function public.lms_due_reminders()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
begin
  with due as (
    select g.id as game_id, g.competition_id, c.name as competition, g.current_round as round,
           e.user_id, count(*) as missing,
           lms_round_lock(g.sport, g.league_id, g.season, g.current_round) as lock_at
    from lms_games g
    join competitions c on c.id = g.competition_id
    join lms_entries e on e.game_id = g.id and e.status = 'alive'
    where g.status in ('open', 'running')
      and not exists (select 1 from lms_picks p where p.entry_id = e.id and p.round = g.current_round)
    group by g.id, g.competition_id, c.name, g.current_round, e.user_id
  ),
  tagged as (
    select d.*, case when d.lock_at - now() <= interval '2 hours' then 'remind_2h' else 'remind_24h' end as kind
    from due d
    where d.lock_at > now() and d.lock_at - now() <= interval '24 hours'
  ),
  logged as (
    insert into lms_notify_log (game_id, user_id, round, kind)
    select game_id, user_id, round, kind from tagged
    on conflict do nothing
    returning game_id, user_id, round, kind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', l.kind, 'user_id', l.user_id, 'game_id', l.game_id,
           'competition_id', t.competition_id, 'competition', t.competition,
           'round', l.round, 'lock_at', t.lock_at, 'missing', t.missing)), '[]'::jsonb)
  into result
  from logged l
  join tagged t on t.game_id = l.game_id and t.user_id = l.user_id and t.round = l.round and t.kind = l.kind;

  return result;
end;
$$;

revoke execute on function public.lms_due_reminders() from public, anon, authenticated;
grant execute on function public.lms_due_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- STEP 11 — Row level security. Reads only; every write goes through the
-- functions above or the service role.
-- ---------------------------------------------------------------------------
alter table public.lms_fixtures   enable row level security;
alter table public.lms_standings  enable row level security;
alter table public.lms_sync_state enable row level security;
alter table public.lms_games      enable row level security;
alter table public.lms_entries    enable row level security;
alter table public.lms_picks      enable row level security;
alter table public.lms_notify_log enable row level security;

create policy lms_fixtures_read on public.lms_fixtures
  for select using (auth.role() = 'authenticated');

create policy lms_standings_read on public.lms_standings
  for select using (auth.role() = 'authenticated');

create policy lms_games_read on public.lms_games
  for select using (is_participant(competition_id) or is_competition_admin(competition_id));

create policy lms_entries_read on public.lms_entries
  for select using (exists (
    select 1 from lms_games g where g.id = game_id and is_participant(g.competition_id)));

-- Your own picks always; everyone else's only once that gameweek has locked.
create policy lms_picks_read on public.lms_picks
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from lms_games g
      where g.id = game_id
        and is_participant(g.competition_id)
        and lms_round_lock(g.sport, g.league_id, g.season, round) <= now()));

-- ---------------------------------------------------------------------------
-- STEP 12 — Free plan: one Last Man Standing (any sport). Leagues and cups
-- exactly as 118.
-- ---------------------------------------------------------------------------
create or replace function enforce_competition_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  league_count int;
  cup_count    int;
  lms_count    int;
begin
  if has_pro(new.created_by) then
    return new;
  end if;

  if new.format = 'league' then
    select count(*) into league_count
    from competitions
    where created_by = new.created_by
      and format = 'league'
      and sport = coalesce(new.sport, 'football');

    if league_count >= 1 then
      raise exception 'FREE_TIER_LEAGUE_LIMIT';
    end if;

    return new;
  end if;

  if new.format = 'last_man_standing' then
    select count(*) into lms_count
    from competitions
    where created_by = new.created_by
      and format = 'last_man_standing';

    if lms_count >= 1 then
      raise exception 'FREE_TIER_LMS_LIMIT';
    end if;

    return new;
  end if;

  select count(*) into cup_count
  from competitions
  where created_by = new.created_by
    and format in ('knockout','group_knockout');

  if cup_count >= 1 then
    raise exception 'FREE_TIER_CUP_LIMIT';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_competition_limit on competitions;
create trigger trg_competition_limit
before insert on competitions
for each row
execute function enforce_competition_limit();

-- ---------------------------------------------------------------------------
-- STEP 13 — Check. Should show lms_tables = 7 and last_man_standing allowed.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
   where table_schema = 'public' and table_name like 'lms\_%') as lms_tables,
  (select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'competitions_format_check') as formats_allowed;
