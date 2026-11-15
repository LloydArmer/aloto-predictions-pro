-- 123_last_man_standing.sql
--
-- Last Man Standing, a new football competition format (Brittany, 15 Nov 2026).
--
-- HOW IT PLAYS
--
--   Every Premier League gameweek, each player still in picks ONE team to win.
--   Win and you go through. Draw or lose and you are out. A team can only be
--   picked once (after 20 picks the list starts again). It carries on until one
--   player is left, who wins the pot.
--
--   Picks lock at the first kick-off of the gameweek and stay hidden from the
--   other players until then. No pick by the deadline = out. A postponed or
--   abandoned game counts as a win (you go through), and the team still counts
--   as used.
--
--   If everyone still in is knocked out in the same gameweek there is no
--   winner, and the pot rolls into the next game the admin starts.
--
--   The pot is bragging points only: the admin sets how many points each
--   player brings (10 by default) and the winner takes them all. Nobody pays
--   for points and they are never worth money. That keeps this clear of the
--   Gambling Act (paid entry for a prize would be pool betting).
--
-- HOW IT FITS THE APP
--
--   A Last Man Standing is a competition with format 'last_man_standing', so
--   join codes, players, chat and the admin's role all work as they do for a
--   league. One competition runs one game at a time (lms_games); when a game
--   ends the admin starts the next one in the same competition, and everyone in
--   the competition is entered.
--
--   The fixtures are the real Premier League fixture list, shared by every Last
--   Man Standing (lms_fixtures). The sync-lms edge function fills it from
--   API-Football and then calls lms_settle(), which moves players through or
--   knocks them out when a gameweek has finished. Nobody has to enter a result.
--
-- FREE PLAN: one Last Man Standing, like one league and one cup. Pro: unlimited.
--
-- Nothing existing changes. Safe to run more than once.
-- RUN ON DEV FIRST, then Prod. Needs 053, 060 and 118.

-- ---------------------------------------------------------------------------
-- STEP 1 — Allow the new format on competitions.
--
-- The check constraint from 001 lists the formats. It is found by what it
-- checks rather than by name, in case it was ever re-created under another one.
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
-- STEP 2 — The Premier League fixture list, shared by every game.
--
-- Written only by sync-lms (service role). status is API-Football's short code:
-- NS not started, 1H/HT/2H in play, FT full time, PST postponed, CANC
-- cancelled, ABD abandoned.
-- ---------------------------------------------------------------------------
create table if not exists public.lms_fixtures (
  api_fixture_id bigint primary key,
  league_id      int  not null default 39,
  season         int  not null,
  round          int  not null,
  kickoff        timestamptz not null,
  status         text not null default 'NS',
  home_team_id   int  not null,
  home_team      text not null,
  away_team_id   int  not null,
  away_team      text not null,
  home_goals     int,
  away_goals     int,
  updated_at     timestamptz not null default now()
);

create index if not exists idx_lms_fixtures_round on public.lms_fixtures (season, round);

-- ---------------------------------------------------------------------------
-- STEP 3 — Games, entries and picks.
-- ---------------------------------------------------------------------------
create table if not exists public.lms_games (
  id                uuid primary key default uuid_generate_v4(),
  competition_id    uuid not null references public.competitions(id) on delete cascade,
  game_number       int  not null,
  season            int  not null,
  start_round       int  not null,
  current_round     int  not null,
  points_per_player int  not null default 10 check (points_per_player between 1 and 1000),
  carried_points    int  not null default 0,
  carried_from      uuid references public.lms_games(id) on delete set null,
  -- open: taking entries, before the first gameweek locks
  -- running: under way
  -- won / no_winner: finished. cancelled: stopped by the admin.
  status            text not null default 'open'
                    check (status in ('open', 'running', 'won', 'no_winner', 'cancelled')),
  winner_user_id    uuid references public.profiles(id) on delete set null,
  pot               int,          -- written when the game finishes
  ended_round       int,
  rolled_into       uuid references public.lms_games(id) on delete set null,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  unique (competition_id, game_number)
);

-- One game at a time per competition.
create unique index if not exists idx_lms_games_one_live
  on public.lms_games (competition_id) where status in ('open', 'running');

create table if not exists public.lms_entries (
  game_id    uuid not null references public.lms_games(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'alive' check (status in ('alive', 'out', 'winner')),
  out_round  int,
  out_reason text check (out_reason in ('lost', 'drew', 'no_pick')),
  joined_at  timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table if not exists public.lms_picks (
  id             uuid primary key default uuid_generate_v4(),
  game_id        uuid not null references public.lms_games(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  round          int  not null,
  team_id        int  not null,
  team_name      text not null,
  api_fixture_id bigint not null,
  -- null until the gameweek is settled. void = postponed/abandoned (through).
  outcome        text check (outcome in ('won', 'drew', 'lost', 'void')),
  picked_at      timestamptz not null default now(),
  unique (game_id, user_id, round)
);

create index if not exists idx_lms_picks_game_round on public.lms_picks (game_id, round);

-- Stops a reminder or result notification going out twice.
create table if not exists public.lms_notify_log (
  game_id uuid not null references public.lms_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  round   int  not null,
  kind    text not null,
  sent_at timestamptz not null default now(),
  primary key (game_id, user_id, round, kind)
);

-- ---------------------------------------------------------------------------
-- STEP 4 — Gameweek helpers.
--
-- A gameweek's deadline is its first kick-off (postponed games left out).
-- Its games are the ones within 7 days of that deadline: a game moved weeks
-- later keeps its round number in the feed, but it is not part of this
-- gameweek any more, so its teams cannot be picked and it does not hold the
-- gameweek open.
-- ---------------------------------------------------------------------------
create or replace function public.lms_is_finished(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('FT', 'AET', 'PEN', 'AWD', 'WO');
$$;

create or replace function public.lms_is_void(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('PST', 'CANC', 'ABD');
$$;

create or replace function public.lms_round_lock(p_season int, p_round int)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(kickoff) from lms_fixtures
  where season = p_season and round = p_round and not lms_is_void(status);
$$;

-- The next gameweek nobody has kicked off in yet.
create or replace function public.lms_next_round(p_season int, p_after int default 0)
returns int
language sql stable security definer set search_path = public as $$
  select min(round) from (
    select round, min(kickoff) as lock
    from lms_fixtures
    where season = p_season and round > p_after and not lms_is_void(status)
    group by round
  ) r
  where r.lock > now();
$$;

-- Has every game in this gameweek finished (or been called off)?
-- A game still "not started" three days after its kick-off is treated as
-- called off, so a feed that never reports it cannot hold everyone up.
create or replace function public.lms_round_settled(p_season int, p_round int)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_lock timestamptz := lms_round_lock(p_season, p_round);
begin
  if v_lock is null or v_lock > now() then return false; end if;
  return not exists (
    select 1 from lms_fixtures
    where season = p_season and round = p_round
      and kickoff < v_lock + interval '7 days'
      and not lms_is_finished(status)
      and not lms_is_void(status)
      and kickoff > now() - interval '3 days'
  );
end;
$$;

-- The season API-Football is on for the Premier League (league 39).
create or replace function public.lms_current_season()
returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select max(season) from lms_fixtures where league_id = 39),
    (select current_season from api_leagues where id = 39),
    case when extract(month from now()) >= 7
         then extract(year from now())::int
         else extract(year from now())::int - 1 end);
$$;

-- What happened to a pick: won, drew, lost or void. Null while still to play.
create or replace function public.lms_pick_outcome(p_pick_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  p  lms_picks;
  g  lms_games;
  f  lms_fixtures;
  v_lock timestamptz;
  mine int; theirs int;
begin
  select * into p from lms_picks where id = p_pick_id;
  if not found then return null; end if;
  select * into g from lms_games where id = p.game_id;
  select * into f from lms_fixtures where api_fixture_id = p.api_fixture_id;
  if not found then return 'void'; end if;

  v_lock := lms_round_lock(g.season, p.round);

  if lms_is_void(f.status)
     or f.kickoff >= coalesce(v_lock, f.kickoff) + interval '7 days'
     or (not lms_is_finished(f.status) and f.kickoff < now() - interval '3 days') then
    return 'void';
  end if;

  if not lms_is_finished(f.status) or f.home_goals is null or f.away_goals is null then
    return null;
  end if;

  if f.home_team_id = p.team_id then
    mine := f.home_goals; theirs := f.away_goals;
  else
    mine := f.away_goals; theirs := f.home_goals;
  end if;

  return case when mine > theirs then 'won' when mine = theirs then 'drew' else 'lost' end;
end;
$$;

-- Teams this player cannot pick in p_round: the ones picked since their list
-- last started again (every 20 picks).
create or replace function public.lms_used_teams(p_game_id uuid, p_user_id uuid, p_round int)
returns int[]
language sql stable security definer set search_path = public as $$
  with mine as (
    select team_id, row_number() over (order by round) as n, count(*) over () as total
    from lms_picks
    where game_id = p_game_id and user_id = p_user_id and round < p_round
  )
  select coalesce(array_agg(team_id), '{}')
  from mine
  where n > (total / 20) * 20;
$$;

create or replace function public.lms_game_pot(p_game_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select g.points_per_player * (select count(*) from lms_entries e where e.game_id = g.id)::int
         + g.carried_points
  from lms_games g where g.id = p_game_id;
$$;

-- ---------------------------------------------------------------------------
-- STEP 5 — Making a pick.
--
-- The only way a pick is written. Returns json so the app can say exactly
-- why a pick was refused.
-- ---------------------------------------------------------------------------
create or replace function public.lms_make_pick(p_game_id uuid, p_team_id int)
returns json
language plpgsql security definer set search_path = public as $$
declare
  g      lms_games;
  e      lms_entries;
  f      lms_fixtures;
  v_lock timestamptz;
  v_name text;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'not_signed_in'); end if;

  select * into g from lms_games where id = p_game_id;
  if not found or not is_participant(g.competition_id) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  if g.status not in ('open', 'running') then
    return json_build_object('ok', false, 'error', 'finished');
  end if;

  select * into e from lms_entries where game_id = g.id and user_id = auth.uid();
  if not found then return json_build_object('ok', false, 'error', 'not_entered'); end if;
  if e.status <> 'alive' then return json_build_object('ok', false, 'error', 'out'); end if;

  v_lock := lms_round_lock(g.season, g.current_round);
  if v_lock is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;
  if now() >= v_lock then return json_build_object('ok', false, 'error', 'locked'); end if;

  select * into f from lms_fixtures
  where season = g.season and round = g.current_round
    and not lms_is_void(status)
    and kickoff < v_lock + interval '7 days'
    and (home_team_id = p_team_id or away_team_id = p_team_id)
  order by kickoff
  limit 1;
  if not found then return json_build_object('ok', false, 'error', 'not_playing'); end if;

  if p_team_id = any (lms_used_teams(g.id, auth.uid(), g.current_round)) then
    return json_build_object('ok', false, 'error', 'used');
  end if;

  v_name := case when f.home_team_id = p_team_id then f.home_team else f.away_team end;

  insert into lms_picks (game_id, user_id, round, team_id, team_name, api_fixture_id)
  values (g.id, auth.uid(), g.current_round, p_team_id, v_name, f.api_fixture_id)
  on conflict (game_id, user_id, round) do update
    set team_id = excluded.team_id,
        team_name = excluded.team_name,
        api_fixture_id = excluded.api_fixture_id,
        picked_at = now();

  return json_build_object('ok', true, 'team', v_name, 'round', g.current_round, 'locks_at', v_lock);
end;
$$;

grant execute on function public.lms_make_pick(uuid, int) to authenticated;

-- Who has picked this gameweek, without saying what (that stays hidden until
-- the deadline).
create or replace function public.lms_pick_status(p_game_id uuid)
returns table (user_id uuid, has_pick boolean)
language sql stable security definer set search_path = public as $$
  select e.user_id,
         exists (select 1 from lms_picks p
                 where p.game_id = g.id and p.user_id = e.user_id and p.round = g.current_round)
  from lms_games g
  join lms_entries e on e.game_id = g.id
  where g.id = p_game_id and is_participant(g.competition_id);
$$;

grant execute on function public.lms_pick_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 6 — Starting, changing and stopping a game (competition admins).
-- ---------------------------------------------------------------------------
create or replace function public.lms_start_game(
  p_competition_id uuid,
  p_points int default 10,
  p_start_round int default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_comp    competitions;
  v_season  int := lms_current_season();
  v_start   int;
  v_lock    timestamptz;
  v_carry   lms_games;
  v_number  int;
  v_id      uuid;
begin
  if not is_competition_admin(p_competition_id) then
    return json_build_object('ok', false, 'error', 'not_admin');
  end if;

  select * into v_comp from competitions where id = p_competition_id;
  if not found or v_comp.format <> 'last_man_standing' then
    return json_build_object('ok', false, 'error', 'not_lms');
  end if;

  if exists (select 1 from lms_games where competition_id = p_competition_id and status in ('open', 'running')) then
    return json_build_object('ok', false, 'error', 'already_running');
  end if;

  if coalesce(p_points, 0) < 1 or p_points > 1000 then
    return json_build_object('ok', false, 'error', 'bad_points');
  end if;

  v_start := coalesce(p_start_round, lms_next_round(v_season));
  if v_start is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;

  v_lock := lms_round_lock(v_season, v_start);
  if v_lock is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;
  if v_lock <= now() then return json_build_object('ok', false, 'error', 'round_started'); end if;

  -- The pot from the last game, if nobody won it and it has not rolled on yet.
  select * into v_carry from lms_games
  where competition_id = p_competition_id and status = 'no_winner' and rolled_into is null
  order by game_number desc limit 1;

  select coalesce(max(game_number), 0) + 1 into v_number
  from lms_games where competition_id = p_competition_id;

  insert into lms_games (competition_id, game_number, season, start_round, current_round,
                         points_per_player, carried_points, carried_from, created_by)
  values (p_competition_id, v_number, v_season, v_start, v_start,
          p_points, coalesce(v_carry.pot, 0), v_carry.id, auth.uid())
  returning id into v_id;

  if v_carry.id is not null then
    update lms_games set rolled_into = v_id where id = v_carry.id;
  end if;

  -- Everyone in the competition is in the game.
  insert into lms_entries (game_id, user_id)
  select v_id, user_id from participants where competition_id = p_competition_id
  on conflict do nothing;

  return json_build_object('ok', true, 'game_id', v_id, 'start_round', v_start,
                           'locks_at', v_lock, 'carried', coalesce(v_carry.pot, 0));
end;
$$;

grant execute on function public.lms_start_game(uuid, int, int) to authenticated;

-- Change the points or the first gameweek, while the game is still taking entries.
create or replace function public.lms_update_game(p_game_id uuid, p_points int, p_start_round int)
returns json
language plpgsql security definer set search_path = public as $$
declare
  g lms_games;
  v_lock timestamptz;
begin
  select * into g from lms_games where id = p_game_id;
  if not found or not is_competition_admin(g.competition_id) then
    return json_build_object('ok', false, 'error', 'not_admin');
  end if;
  if g.status <> 'open' then return json_build_object('ok', false, 'error', 'started'); end if;
  if coalesce(p_points, 0) < 1 or p_points > 1000 then
    return json_build_object('ok', false, 'error', 'bad_points');
  end if;

  v_lock := lms_round_lock(g.season, p_start_round);
  if v_lock is null then return json_build_object('ok', false, 'error', 'no_fixtures'); end if;
  if v_lock <= now() then return json_build_object('ok', false, 'error', 'round_started'); end if;

  -- Picks made for the old first gameweek no longer apply.
  if p_start_round <> g.start_round then
    delete from lms_picks where game_id = g.id;
  end if;

  update lms_games
  set points_per_player = p_points, start_round = p_start_round, current_round = p_start_round
  where id = g.id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.lms_update_game(uuid, int, int) to authenticated;

-- Stop a game. Any pot it carried in goes back, ready for the next game.
create or replace function public.lms_cancel_game(p_game_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  g lms_games;
begin
  select * into g from lms_games where id = p_game_id;
  if not found or not is_competition_admin(g.competition_id) then
    return json_build_object('ok', false, 'error', 'not_admin');
  end if;
  if g.status not in ('open', 'running') then
    return json_build_object('ok', false, 'error', 'finished');
  end if;

  update lms_games set status = 'cancelled', finished_at = now() where id = g.id;
  if g.carried_from is not null then
    update lms_games set rolled_into = null where id = g.carried_from;
  end if;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.lms_cancel_game(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 7 — New players join the game that is taking entries; removed players
-- leave it.
-- ---------------------------------------------------------------------------
create or replace function public.lms_on_participant_added()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into lms_entries (game_id, user_id)
  select g.id, new.user_id
  from lms_games g
  where g.competition_id = new.competition_id
    and g.status = 'open'
    and coalesce(lms_round_lock(g.season, g.start_round), 'infinity') > now()
  on conflict do nothing;
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
  where e.game_id = g.id
    and g.competition_id = old.competition_id
    and g.status = 'open'
    and e.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists trg_lms_participant_removed on public.participants;
create trigger trg_lms_participant_removed
after delete on public.participants
for each row execute function public.lms_on_participant_removed();

-- ---------------------------------------------------------------------------
-- STEP 8 — Settling gameweeks. Called by sync-lms (service role only).
--
-- For every game under way whose current gameweek has finished: winners and
-- postponed games go through, everyone else is out. Then one left = winner,
-- none left = no winner (the pot rolls over), otherwise on to the next
-- gameweek.
--
-- A game still taking entries starts when its first gameweek locks. With fewer
-- than two players it waits for the next gameweek instead.
--
-- Returns what happened, one row per notification to send.
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
  v_n      int;
  v_out    text;
  v_through uuid[];
  v_outs   jsonb;
  v_pot    int;
  events   jsonb := '[]'::jsonb;
begin
  for g in
    select * from lms_games where status in ('open', 'running') order by created_at for update
  loop
    select name into v_comp from competitions where id = g.competition_id;

    -- Taking entries: start when the first gameweek locks.
    if g.status = 'open' then
      v_lock := lms_round_lock(g.season, g.start_round);
      if v_lock is null or v_lock > now() then continue; end if;

      select count(*) into v_n from lms_entries where game_id = g.id;
      if v_n < 2 then
        v_next := lms_next_round(g.season, g.start_round);
        if v_next is null then
          update lms_games set status = 'cancelled', finished_at = now() where id = g.id;
        else
          update lms_games set start_round = v_next, current_round = v_next where id = g.id;
          delete from lms_picks where game_id = g.id;
        end if;
        continue;
      end if;

      update lms_games set status = 'running', current_round = start_round, started_at = now()
      where id = g.id;
      g.status := 'running';
      g.current_round := g.start_round;
    end if;

    if not lms_round_settled(g.season, g.current_round) then continue; end if;

    v_through := '{}';
    v_outs := '[]'::jsonb;

    for e in select * from lms_entries where game_id = g.id and status = 'alive' loop
      select * into p from lms_picks where game_id = g.id and user_id = e.user_id and round = g.current_round;

      if not found then
        update lms_entries set status = 'out', out_round = g.current_round, out_reason = 'no_pick'
        where game_id = g.id and user_id = e.user_id;
        v_outs := v_outs || jsonb_build_object('user_id', e.user_id, 'reason', 'no_pick', 'team', null);
        continue;
      end if;

      v_out := coalesce(lms_pick_outcome(p.id), 'void');
      update lms_picks set outcome = v_out where id = p.id;

      if v_out in ('won', 'void') then
        v_through := v_through || e.user_id;
        events := events || jsonb_build_object(
          'kind', 'through', 'user_id', e.user_id, 'game_id', g.id,
          'competition_id', g.competition_id, 'competition', v_comp,
          'round', g.current_round, 'team', p.team_name, 'void', v_out = 'void');
      else
        update lms_entries set status = 'out', out_round = g.current_round, out_reason = v_out
        where game_id = g.id and user_id = e.user_id;
        v_outs := v_outs || jsonb_build_object('user_id', e.user_id, 'reason', v_out, 'team', p.team_name);
      end if;
    end loop;

    v_n := coalesce(array_length(v_through, 1), 0);
    v_pot := lms_game_pot(g.id);

    -- One left: the winner. Their "through" becomes "you've won".
    if v_n = 1 then
      update lms_entries set status = 'winner' where game_id = g.id and user_id = v_through[1];
      update lms_games
      set status = 'won', winner_user_id = v_through[1], pot = v_pot,
          ended_round = g.current_round, finished_at = now()
      where id = g.id;
      events := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(events) x
                 where not (x->>'kind' = 'through' and x->>'game_id' = g.id::text));
      events := events || jsonb_build_object(
        'kind', 'winner', 'user_id', v_through[1], 'game_id', g.id,
        'competition_id', g.competition_id, 'competition', v_comp,
        'round', g.current_round, 'pot', v_pot);

    -- Nobody left: no winner, the pot rolls over.
    elsif v_n = 0 then
      update lms_games
      set status = 'no_winner', pot = v_pot, ended_round = g.current_round, finished_at = now()
      where id = g.id;

    -- Several left: on to the next gameweek that has not started.
    else
      v_next := lms_next_round(g.season, g.current_round);
      if v_next is null then
        -- The season ran out with several still in. Nobody won outright, so
        -- the pot rolls over like any other no-winner game.
        update lms_games
        set status = 'no_winner', pot = v_pot, ended_round = g.current_round, finished_at = now()
        where id = g.id;
      else
        update lms_games set current_round = v_next where id = g.id;
        events := (select coalesce(jsonb_agg(
                     case when x->>'kind' = 'through' and x->>'game_id' = g.id::text
                          then x || jsonb_build_object('next_round', v_next, 'left', v_n)
                          else x end), '[]'::jsonb)
                   from jsonb_array_elements(events) x);
      end if;
    end if;

    -- Everyone knocked out this gameweek.
    select events || coalesce(jsonb_agg(o || jsonb_build_object(
             'kind', 'out', 'game_id', g.id, 'competition_id', g.competition_id,
             'competition', v_comp, 'round', g.current_round, 'pot', v_pot,
             'no_winner', v_n = 0)), '[]'::jsonb)
    into events
    from jsonb_array_elements(v_outs) o;
  end loop;

  return events;
end;
$$;

revoke execute on function public.lms_settle() from public, anon, authenticated;
grant execute on function public.lms_settle() to service_role;

-- Pick reminders: players still in with no pick, 24 hours and 2 hours before
-- the deadline. Each is returned once (logged as it is returned).
create or replace function public.lms_due_reminders()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
begin
  with due as (
    select g.id as game_id, g.competition_id, c.name as competition, g.current_round as round,
           e.user_id, lms_round_lock(g.season, g.current_round) as lock_at
    from lms_games g
    join competitions c on c.id = g.competition_id
    join lms_entries e on e.game_id = g.id and e.status = 'alive'
    where g.status in ('open', 'running')
      and not exists (select 1 from lms_picks p
                      where p.game_id = g.id and p.user_id = e.user_id and p.round = g.current_round)
  ),
  tagged as (
    select d.*,
           case when d.lock_at - now() <= interval '2 hours' then 'remind_2h' else 'remind_24h' end as kind
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
           'round', l.round, 'lock_at', t.lock_at)), '[]'::jsonb)
  into result
  from logged l
  join tagged t on t.game_id = l.game_id and t.user_id = l.user_id and t.round = l.round and t.kind = l.kind;

  return result;
end;
$$;

revoke execute on function public.lms_due_reminders() from public, anon, authenticated;
grant execute on function public.lms_due_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- STEP 9 — Row level security. Everything is read here; every write goes
-- through the functions above or the service role.
-- ---------------------------------------------------------------------------
alter table public.lms_fixtures   enable row level security;
alter table public.lms_games      enable row level security;
alter table public.lms_entries    enable row level security;
alter table public.lms_picks      enable row level security;
alter table public.lms_notify_log enable row level security;

drop policy if exists lms_fixtures_read on public.lms_fixtures;
create policy lms_fixtures_read on public.lms_fixtures
  for select using (auth.role() = 'authenticated');

drop policy if exists lms_games_read on public.lms_games;
create policy lms_games_read on public.lms_games
  for select using (is_participant(competition_id) or is_competition_admin(competition_id));

drop policy if exists lms_entries_read on public.lms_entries;
create policy lms_entries_read on public.lms_entries
  for select using (exists (
    select 1 from lms_games g where g.id = game_id and is_participant(g.competition_id)));

-- Your own picks always; everyone else's once that gameweek has locked.
drop policy if exists lms_picks_read on public.lms_picks;
create policy lms_picks_read on public.lms_picks
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from lms_games g
      where g.id = game_id
        and is_participant(g.competition_id)
        and lms_round_lock(g.season, round) <= now()));

-- ---------------------------------------------------------------------------
-- STEP 10 — Free plan: one Last Man Standing. Same function as 118 with one
-- branch added; leagues and cups are exactly as before.
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
-- STEP 11 — Check. Five tables, and the new format accepted.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
   where table_schema = 'public' and table_name like 'lms\_%') as lms_tables,
  (select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'competitions_format_check') as formats_allowed;
