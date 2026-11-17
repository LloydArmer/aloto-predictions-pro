-- =============================================================================
-- 133 — Last Man Standing: players choose to join, the admin approves.
--
--   * Joining the competition no longer enters you in its game. Players tap
--     "Join this game" (and can join more than once, up to 10 entries).
--   * Each new entry waits for the admin's approval. Admins' own entries,
--     and entries carried over from a roll-over, are approved straight away.
--   * Only approved entries count in the pot and towards the two players a
--     game needs to start. A waiting entry can make picks, but if it is still
--     not approved at the first kick-off it is removed.
--   * New: lms_approve_entry (admin approves or turns down an entry).
--
-- Run on Dev, then Prod, after 126–132. Safe to run more than once.
-- =============================================================================

-- STEP 0 — 126 and 130 must already be in place.
do $$
begin
  if to_regclass('public.lms_entries') is null then
    raise exception 'Run 126_last_man_standing.sql on this project first, then this file.';
  end if;
  if to_regclass('public.user_devices') is null then
    raise exception 'Run 130_lms_free_game_per_phone.sql on this project first, then this file.';
  end if;
end $$;

-- STEP 1 — Approval flag. Every entry that already exists counts as approved.
alter table public.lms_entries add column if not exists approved boolean not null default true;

-- STEP 2 — Approved entries only in the pot.
create or replace function public.lms_game_pot(p_game_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select g.carried_points + coalesce((select sum(stake) from lms_entries e where e.game_id = g.id and e.approved), 0)::int
  from lms_games g where g.id = p_game_id;
$$;

-- STEP 3 — Joining a game (first entry or another one). Waits for approval
-- unless you are an admin of the competition.
create or replace function public.lms_add_entry(p_game_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  g lms_games;
  v_no int;
  v_id uuid;
  v_ok boolean;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into g from lms_games where id = p_game_id;
  if not found or not is_participant(g.competition_id) then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if g.status <> 'open' or coalesce(lms_round_lock(g.sport, g.league_id, g.season, g.start_round), 'infinity') <= now() then
    return json_build_object('ok', false, 'error', 'entries_closed');
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_no from lms_entries where game_id = g.id and user_id = auth.uid();
  if (select count(*) from lms_entries where game_id = g.id and user_id = auth.uid()) >= 10 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;

  v_ok := is_competition_admin(g.competition_id);
  insert into lms_entries (game_id, user_id, entry_no, stake, approved)
  values (g.id, auth.uid(), v_no, g.entry_points, v_ok)
  returning id into v_id;

  return json_build_object('ok', true, 'entry_id', v_id, 'entry_no', v_no, 'stake', g.entry_points, 'approved', v_ok);
end;
$$;

grant execute on function public.lms_add_entry(uuid) to authenticated;

-- STEP 4 — The admin approves (p_approve = true) or turns down (false) an
-- entry, until the first kick-off. Turning one down removes it.
create or replace function public.lms_approve_entry(p_entry_id uuid, p_approve boolean)
returns json
language plpgsql security definer set search_path = public as $$
declare
  e lms_entries;
  g lms_games;
begin
  select * into e from lms_entries where id = p_entry_id;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  select * into g from lms_games where id = e.game_id;
  if not is_competition_admin(g.competition_id) then return json_build_object('ok', false, 'error', 'not_admin'); end if;
  if g.status <> 'open' or coalesce(lms_round_lock(g.sport, g.league_id, g.season, g.start_round), 'infinity') <= now() then
    return json_build_object('ok', false, 'error', 'entries_closed');
  end if;

  if p_approve then
    update lms_entries set approved = true where id = e.id;
  else
    delete from lms_entries where id = e.id;
  end if;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.lms_approve_entry(uuid, boolean) to authenticated;

-- STEP 5 — Joining the competition no longer enters you automatically.
drop trigger if exists trg_lms_participant_added on public.participants;

-- STEP 6 — Starting a game enters only the admin (and roll-over entries).
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

  -- Free plan: one Last Man Standing game PER PHONE. Any game after that,
  -- including the next game after a roll-over, needs Pro, whichever account
  -- that has been used on the same phone starts it. Accounts with no phone
  -- recorded (older app versions, the website) are limited per account. A
  -- game stopped before it started does not count.
  if not has_pro(auth.uid()) and exists (
    select 1 from public.lms_games g
    where not (g.status = 'cancelled' and g.started_at is null)
      and (g.created_by = auth.uid()
           or g.created_by in (
             select d2.user_id from public.user_devices d1
             join public.user_devices d2 on d2.device_id = d1.device_id
             where d1.user_id = auth.uid()))
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

  -- The admin who starts it is entered (approved). Everyone else chooses to
  -- join from the app, and the admin approves each entry (migration 133).
  insert into lms_entries (game_id, user_id, entry_no, stake, approved)
  select v_id, auth.uid(), 1, v_entry, true
  where not exists (select 1 from lms_entries e where e.game_id = v_id and e.user_id = auth.uid());

  return json_build_object('ok', true, 'game_id', v_id, 'start_round', v_start, 'locks_at', v_lock,
                           'carried', coalesce(v_carry.pot, 0), 'entry_points', v_entry);
end;
$$;

grant execute on function public.lms_start_game(uuid, text, int, text, int, int) to authenticated;

-- STEP 7 — At the first kick-off, entries still waiting are dropped and only
-- approved players count.
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

      -- Only entries the admin has approved count. Fewer than two players:
      -- the start moves on a gameweek and requests stay waiting.
      select count(distinct user_id) into v_players from lms_entries where game_id = g.id and approved;
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

      -- Entries still waiting for approval at the first kick-off are dropped.
      delete from lms_entries where game_id = g.id and not approved;
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

-- STEP 8 — Check: expect approval_column = true, approve_function = true, auto_join_off = true.
select
  exists (select 1 from information_schema.columns where table_name = 'lms_entries' and column_name = 'approved') as approval_column,
  to_regprocedure('public.lms_approve_entry(uuid, boolean)') is not null as approve_function,
  not exists (select 1 from pg_trigger where tgname = 'trg_lms_participant_added') as auto_join_off;
