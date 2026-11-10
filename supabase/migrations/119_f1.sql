-- 119_f1.sql
--
-- Formula 1 as the third sport (Lloyd, 10 Nov 2026). See docs/ALOTO-F1.md.
--
-- HOW F1 PLAYS
--
--   Grid    Before qualifying, put the whole grid in order (22 cars). Every
--           driver in exactly the right place pays f1_grid_points, 5 by default.
--           Scored against the qualifying result, before grid penalties.
--           Locks when qualifying starts.
--   Race    Before the race, put the whole finishing order, 1 to 22. A driver
--           in exactly the right place pays what that place pays in F1:
--           25, 18, 15, 12, 10, 8, 6, 4, 2, 1, then 1 point for 11th to 22nd
--           (Lloyd, 10 Nov 2026). Every place is editable by the admin
--           (f1_race_points). Locks when the race starts.
--   Sprint  On sprint weekends, the same two picks for the sprint first:
--           the sprint grid (sprint qualifying, 5 a place, locks when sprint
--           qualifying starts) and the sprint finish, paying the sprint
--           points 8, 7, 6, 5, 4, 3, 2, 1 for 1st to 8th (f1_sprint_points,
--           editable). Locks when the sprint starts.
--   Season  Drivers' Champion (free), the full drivers' table and the full
--           constructors' table (Pro). 20 points for each correct answer or
--           correct place by default; the admin can change all three.
--
-- HOW IT FITS THE APP
--
--   Each race weekend is a gameweek ("R21"), linked to the competition the
--   usual way, so gameweek_scores, the dashboard and standings machinery work
--   unchanged. Everything F1 specific lives in its own f1_* tables, so nothing
--   here can touch a football fixture or an NFL game.
--
--   Picks belong to the person and the race, like football predictions, so one
--   set of picks counts in every F1 league they play in.
--
--   Results come from the sync-f1 edge function (API-SPORTS Formula 1). They
--   arrive provisional while a session is running. When the admin confirms a
--   session (or the feed does, for leagues with "Confirm results
--   automatically" on), they are scored.
--
-- F1 STARTS SWITCHED OFF. The sport is added with enabled = false, so the
-- current app in the App Store does not offer it before the new build is out.
-- 121_f1_switch_on.sql turns it on.
--
-- Nothing existing changes. Safe to run more than once.
--
-- RUN ON DEV FIRST, then Prod. Needs 111 and 118.

-- ---------------------------------------------------------------------------
-- STEP 1 — The sport, and its points on the competition's rules row.
-- ---------------------------------------------------------------------------
insert into public.sports (id, name, emoji, sort_order, enabled)
values ('f1', 'F1', '🏎️', 3, false)
on conflict (id) do nothing;

alter table public.point_rules
  add column if not exists f1_grid_points     integer   not null default 5,
  add column if not exists f1_grid_positions  integer   not null default 22,
  add column if not exists f1_race_points     integer[] not null
    default '{25,18,15,12,10,8,6,4,2,1,1,1,1,1,1,1,1,1,1,1,1,1}',
  add column if not exists f1_race_positions  integer   not null default 22,
  add column if not exists f1_sprint_points   integer[] not null
    default '{8,7,6,5,4,3,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0}';

comment on column public.point_rules.f1_grid_points is
  'F1: points for each driver placed exactly right in the grid pick (qualifying result). Default 5. See 119.';
comment on column public.point_rules.f1_grid_positions is
  'F1: how many grid places are picked and scored. Default 22, the whole grid.';
comment on column public.point_rules.f1_race_points is
  'F1: points for a driver placed exactly right in the race pick, by finishing place. Default the F1 points 25..1, then 1 for 11th to 22nd. See 119.';
comment on column public.point_rules.f1_sprint_points is
  'F1: points for a driver placed exactly right in the sprint pick, by place. Default the sprint points 8..1, then 0. See 119.';
comment on column public.point_rules.f1_race_positions is
  'F1: how many finishing places are picked, race and sprint. Default 22, the whole field.';

-- New F1 competitions take the defaults above, which is all they need. The
-- football and NFL branches are exactly as 117 left them.
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
  elsif new.sport = 'f1' then
    insert into point_rules (competition_id, exact_score_points, correct_result_points)
    values (new.id, 0, 0);
  else
    insert into point_rules (competition_id) values (new.id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- STEP 2 — Drivers, teams, races and results. Filled by sync-f1.
-- ---------------------------------------------------------------------------
create table if not exists public.f1_teams (
  id           uuid primary key default uuid_generate_v4(),
  season       integer not null,
  api_team_id  integer not null,
  name         text not null,
  logo         text,
  sort_order   integer not null default 0,
  unique (season, api_team_id)
);

create table if not exists public.f1_drivers (
  id             uuid primary key default uuid_generate_v4(),
  season         integer not null,
  api_driver_id  integer not null,
  name           text not null,
  abbr           text,
  number         integer,
  image          text,
  team_id        uuid references public.f1_teams(id) on delete set null,
  sort_order     integer not null default 0,
  active         boolean not null default true,
  unique (season, api_driver_id)
);

create table if not exists public.f1_races (
  id                 uuid primary key default uuid_generate_v4(),
  gameweek_id        uuid not null unique references public.gameweeks(id) on delete cascade,
  season             integer not null,
  round              integer,
  api_competition_id integer,
  api_race_id        integer unique,
  name               text not null,
  circuit            text,
  city               text,
  country            text,
  qualifying_at      timestamptz,
  sprint_qualifying_at timestamptz,          -- sprint weekends only
  sprint_at          timestamptz,            -- sprint weekends only
  api_sprint_id      integer,
  race_at            timestamptz not null,
  total_laps         integer,
  status             text not null default 'upcoming'
    check (status in ('upcoming', 'completed', 'cancelled')),
  live_session       text check (live_session in ('sprint_grid', 'sprint', 'grid', 'race')),
  live_lap           integer,
  live_updated_at    timestamptz,
  sprint_grid_confirmed boolean not null default false,
  sprint_confirmed   boolean not null default false,
  grid_confirmed     boolean not null default false,
  race_confirmed     boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists f1_races_race_at_idx on public.f1_races (race_at);

create table if not exists public.f1_results (
  id           uuid primary key default uuid_generate_v4(),
  race_id      uuid not null references public.f1_races(id) on delete cascade,
  session      text not null check (session in ('sprint_grid', 'sprint', 'grid', 'race')),
  driver_id    uuid not null references public.f1_drivers(id) on delete cascade,
  position     integer check (position > 0),
  gap          text,
  note         text,                       -- DNF, DSQ, pit, time
  provisional  boolean not null default true,
  updated_at   timestamptz not null default now(),
  unique (race_id, session, driver_id)
);

create index if not exists f1_results_race_idx on public.f1_results (race_id, session);

-- The latest championship standings, kept by sync-f1 after each race. The
-- season predictions are settled from these.
create table if not exists public.f1_championship (
  id          uuid primary key default uuid_generate_v4(),
  season      integer not null,
  kind        text not null check (kind in ('drivers', 'constructors')),
  position    integer not null,
  driver_id   uuid references public.f1_drivers(id) on delete cascade,
  team_id     uuid references public.f1_teams(id) on delete cascade,
  points      numeric,
  updated_at  timestamptz not null default now(),
  unique (season, kind, position)
);

-- ---------------------------------------------------------------------------
-- STEP 3 — Picks and race scores.
-- ---------------------------------------------------------------------------
create table if not exists public.f1_picks (
  id          uuid primary key default uuid_generate_v4(),
  race_id     uuid not null references public.f1_races(id) on delete cascade,
  session     text not null check (session in ('sprint_grid', 'sprint', 'grid', 'race')),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  position    integer not null check (position > 0),
  driver_id   uuid not null references public.f1_drivers(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  unique (race_id, session, user_id, position),
  unique (race_id, session, user_id, driver_id)
);

create index if not exists f1_picks_user_idx on public.f1_picks (user_id, race_id);

create table if not exists public.f1_race_scores (
  id              uuid primary key default uuid_generate_v4(),
  competition_id  uuid not null references public.competitions(id) on delete cascade,
  race_id         uuid not null references public.f1_races(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  sprint_grid_points   integer not null default 0,
  sprint_grid_correct  integer not null default 0,
  sprint_points   integer not null default 0,
  sprint_correct  integer not null default 0,
  grid_points     integer not null default 0,
  grid_correct    integer not null default 0,
  race_points     integer not null default 0,
  race_correct    integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (competition_id, race_id, user_id)
);

-- When a session locks.
create or replace function public.f1_lock_time(p_race_id uuid, p_session text)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select case p_session
           when 'sprint_grid' then coalesce(r.sprint_qualifying_at, r.sprint_at)
           when 'sprint'      then r.sprint_at
           when 'grid'        then coalesce(r.qualifying_at, r.race_at)
           else r.race_at end
  from f1_races r where r.id = p_race_id;
$$;

-- Admin of any competition this race is in.
create or replace function public.f1_is_race_admin(p_race_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from f1_races r
    join competition_gameweeks cg on cg.gameweek_id = r.gameweek_id
    join participants p on p.competition_id = cg.competition_id
    where r.id = p_race_id and p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

-- In any competition this race is in.
create or replace function public.f1_is_race_player(p_race_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from f1_races r
    join competition_gameweeks cg on cg.gameweek_id = r.gameweek_id
    join participants p on p.competition_id = cg.competition_id
    where r.id = p_race_id and p.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- STEP 4 — Saving picks. The whole order in one go, so a reorder never trips
-- over the one-place-per-driver rule halfway through.
-- ---------------------------------------------------------------------------
create or replace function public.f1_save_picks(p_race_id uuid, p_session text, p_driver_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock timestamptz;
  v_n    integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_session not in ('sprint_grid', 'sprint', 'grid', 'race') then raise exception 'Unknown session'; end if;
  if not f1_is_race_player(p_race_id) then raise exception 'You are not in a league for this race'; end if;

  v_lock := f1_lock_time(p_race_id, p_session);
  if v_lock is null or now() >= v_lock then
    raise exception 'F1_PICKS_LOCKED: Picks for this session have locked';
  end if;

  if (select count(*) from unnest(p_driver_ids) d) <> (select count(distinct d) from unnest(p_driver_ids) d) then
    raise exception 'Each driver can only be placed once';
  end if;

  delete from f1_picks where race_id = p_race_id and session = p_session and user_id = auth.uid();

  insert into f1_picks (race_id, session, user_id, position, driver_id)
  select p_race_id, p_session, auth.uid(), t.ord::int, t.d
  from unnest(p_driver_ids) with ordinality as t(d, ord)
  where t.d is not null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.f1_save_picks(uuid, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 5 — Scoring a race, for every F1 competition it is in.
--
-- Only confirmed sessions score. The race's gameweek total goes to
-- gameweek_scores (exact_scores = drivers placed exactly right, grid and race
-- together), and the split to f1_race_scores for the F1 screens.
-- ---------------------------------------------------------------------------
create or replace function public.f1_score_race(p_race_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_race  f1_races%rowtype;
  v_comp  record;
  v_rows  integer := 0;
begin
  if auth.role() <> 'service_role' and not f1_is_race_admin(p_race_id) then
    raise exception 'Only a league admin can score a race';
  end if;

  select * into v_race from f1_races where id = p_race_id;
  if not found then return 0; end if;

  for v_comp in
    select c.id,
           coalesce(r.f1_grid_points, 5)      as grid_pts,
           coalesce(r.f1_grid_positions, 22)  as grid_n,
           coalesce(r.f1_race_points, '{25,18,15,12,10,8,6,4,2,1,1,1,1,1,1,1,1,1,1,1,1,1}'::int[]) as race_pts,
           coalesce(r.f1_sprint_points, '{8,7,6,5,4,3,2,1}'::int[]) as sprint_pts,
           coalesce(r.f1_race_positions, 22)  as race_n
    from competition_gameweeks cg
    join competitions c on c.id = cg.competition_id and c.sport = 'f1'
    left join point_rules r on r.competition_id = coalesce(c.rules_source_competition_id, c.id)
    where cg.gameweek_id = v_race.gameweek_id
  loop
    with hits as (
      -- Every pick placed exactly right, in a confirmed session, with what it pays.
      select pk.user_id, pk.session,
             case pk.session
               when 'grid'        then v_comp.grid_pts
               when 'sprint_grid' then v_comp.grid_pts
               when 'race'        then coalesce(v_comp.race_pts[pk.position], 0)
               when 'sprint'      then coalesce(v_comp.sprint_pts[pk.position], 0)
             end as pts
      from f1_picks pk
      join f1_results rs on rs.race_id = pk.race_id and rs.session = pk.session
                        and rs.driver_id = pk.driver_id and rs.position = pk.position
                        and rs.provisional = false
      where pk.race_id = p_race_id
        and pk.position <= case when pk.session in ('grid', 'sprint_grid') then v_comp.grid_n else v_comp.race_n end
        and case pk.session
              when 'grid'        then v_race.grid_confirmed
              when 'race'        then v_race.race_confirmed
              when 'sprint_grid' then v_race.sprint_grid_confirmed
              when 'sprint'      then v_race.sprint_confirmed
            end
    ),
    totals as (
      select pl.user_id,
             coalesce(sum(h.pts) filter (where h.session = 'grid'), 0)::int        as grid_points,
             count(h.session) filter (where h.session = 'grid')::int               as grid_correct,
             coalesce(sum(h.pts) filter (where h.session = 'race'), 0)::int        as race_points,
             count(h.session) filter (where h.session = 'race')::int               as race_correct,
             coalesce(sum(h.pts) filter (where h.session = 'sprint_grid'), 0)::int as sprint_grid_points,
             count(h.session) filter (where h.session = 'sprint_grid')::int        as sprint_grid_correct,
             coalesce(sum(h.pts) filter (where h.session = 'sprint'), 0)::int      as sprint_points,
             count(h.session) filter (where h.session = 'sprint')::int             as sprint_correct
      from participants pl
      left join hits h on h.user_id = pl.user_id
      where pl.competition_id = v_comp.id
        and exists (select 1 from f1_picks x where x.race_id = p_race_id and x.user_id = pl.user_id)
      group by pl.user_id
    ),
    saved as (
      insert into f1_race_scores (competition_id, race_id, user_id,
                                  grid_points, grid_correct, race_points, race_correct,
                                  sprint_grid_points, sprint_grid_correct, sprint_points, sprint_correct, updated_at)
      select v_comp.id, p_race_id, t.user_id,
             t.grid_points, t.grid_correct, t.race_points, t.race_correct,
             t.sprint_grid_points, t.sprint_grid_correct, t.sprint_points, t.sprint_correct, now()
      from totals t
      on conflict (competition_id, race_id, user_id) do update
        set grid_points = excluded.grid_points, grid_correct = excluded.grid_correct,
            race_points = excluded.race_points, race_correct = excluded.race_correct,
            sprint_grid_points = excluded.sprint_grid_points, sprint_grid_correct = excluded.sprint_grid_correct,
            sprint_points = excluded.sprint_points, sprint_correct = excluded.sprint_correct,
            updated_at = now()
      returning user_id,
                grid_points + race_points + sprint_grid_points + sprint_points as points,
                grid_correct + race_correct + sprint_grid_correct + sprint_correct as correct
    )
    insert into gameweek_scores (competition_id, gameweek_id, user_id, points, exact_scores, correct_results)
    select v_comp.id, v_race.gameweek_id, s.user_id, s.points, s.correct, 0 from saved s
    on conflict (competition_id, gameweek_id, user_id) do update
      set points = excluded.points, exact_scores = excluded.exact_scores,
          correct_results = 0, updated_at = now();

    v_rows := v_rows + 1;
  end loop;

  return v_rows;
end;
$$;

grant execute on function public.f1_score_race(uuid) to authenticated, service_role;

-- Confirm a session: the provisional order becomes the result, and the race
-- is scored. Confirming the race also completes the race weekend.
create or replace function public.f1_confirm_session(p_race_id uuid, p_session text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not f1_is_race_admin(p_race_id) then
    raise exception 'Only a league admin can confirm results';
  end if;
  if not exists (select 1 from f1_results where race_id = p_race_id and session = p_session and position is not null) then
    raise exception 'There is no % result to confirm yet',
      case p_session when 'grid' then 'qualifying' when 'sprint_grid' then 'sprint qualifying' else p_session end;
  end if;

  update f1_results set provisional = false, updated_at = now()
  where race_id = p_race_id and session = p_session;

  update f1_races set
    grid_confirmed        = grid_confirmed        or p_session = 'grid',
    sprint_grid_confirmed = sprint_grid_confirmed or p_session = 'sprint_grid',
    sprint_confirmed      = sprint_confirmed      or p_session = 'sprint',
    race_confirmed        = race_confirmed        or p_session = 'race',
    live_session          = case when live_session = p_session then null else live_session end
  where id = p_race_id;

  if p_session = 'race' then
    update f1_races set status = 'completed', live_session = null where id = p_race_id;
    update gameweeks set status = 'completed'
    where id = (select gameweek_id from f1_races where id = p_race_id);
  end if;

  return f1_score_race(p_race_id);
end;
$$;

grant execute on function public.f1_confirm_session(uuid, text) to authenticated, service_role;

-- The admin sets a result by hand (feed down, or a late penalty). The order
-- given is the result, confirmed, and the race is scored again.
create or replace function public.f1_set_result(p_race_id uuid, p_session text, p_driver_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not f1_is_race_admin(p_race_id) then
    raise exception 'Only a league admin can set results';
  end if;
  if p_session not in ('sprint_grid', 'sprint', 'grid', 'race') then raise exception 'Unknown session'; end if;

  delete from f1_results where race_id = p_race_id and session = p_session;
  insert into f1_results (race_id, session, driver_id, position, provisional, note)
  select p_race_id, p_session, t.d, t.ord::int, true, 'Set by admin'
  from unnest(p_driver_ids) with ordinality as t(d, ord)
  where t.d is not null;

  return f1_confirm_session(p_race_id, p_session);
end;
$$;

grant execute on function public.f1_set_result(uuid, text, uuid[]) to authenticated;

-- Reopen a session (undo a confirm). Scores come off until it is confirmed again.
create or replace function public.f1_unconfirm_session(p_race_id uuid, p_session text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not f1_is_race_admin(p_race_id) then
    raise exception 'Only a league admin can reopen results';
  end if;
  update f1_results set provisional = true where race_id = p_race_id and session = p_session;
  update f1_races set
    grid_confirmed        = grid_confirmed        and p_session <> 'grid',
    sprint_grid_confirmed = sprint_grid_confirmed and p_session <> 'sprint_grid',
    sprint_confirmed      = sprint_confirmed      and p_session <> 'sprint',
    race_confirmed        = race_confirmed        and p_session <> 'race'
  where id = p_race_id;

  if p_session = 'race' then
    update f1_races set status = 'upcoming' where id = p_race_id;
    update gameweeks set status = 'active'
    where id = (select gameweek_id from f1_races where id = p_race_id);
  end if;
  return f1_score_race(p_race_id);
end;
$$;

grant execute on function public.f1_unconfirm_session(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 6 — Season predictions: Drivers' Champion (free), drivers' table and
-- constructors' table (Pro). 20 points each by default.
-- ---------------------------------------------------------------------------
create table if not exists public.f1_season_configs (
  id                         uuid primary key default uuid_generate_v4(),
  competition_id             uuid not null unique references public.competitions(id) on delete cascade,
  season                     integer not null,
  deadline                   timestamptz,
  is_open                    boolean not null default false,
  champion_points            integer not null default 20,
  driver_table_enabled       boolean not null default false,
  driver_table_points        integer not null default 20,
  constructor_table_enabled  boolean not null default false,
  constructor_table_points   integer not null default 20,
  settled                    boolean not null default false,
  created_at                 timestamptz not null default now()
);

comment on column public.f1_season_configs.driver_table_points is
  'Points for each place in the drivers'' table predicted exactly right. Pro. Default 20.';
comment on column public.f1_season_configs.constructor_table_points is
  'Points for each place in the constructors'' table predicted exactly right. Pro. Default 20.';

create table if not exists public.f1_season_entries (
  id          uuid primary key default uuid_generate_v4(),
  config_id   uuid not null references public.f1_season_configs(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('champion', 'drivers', 'constructors')),
  position    integer not null check (position > 0),
  driver_id   uuid references public.f1_drivers(id) on delete cascade,
  team_id     uuid references public.f1_teams(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  unique (config_id, user_id, kind, position),
  constraint f1_season_entries_one_thing check (
    (kind = 'constructors' and team_id is not null and driver_id is null)
    or (kind <> 'constructors' and driver_id is not null and team_id is null))
);

-- The tables are Pro: one of the league's admins must have Pro to switch
-- either on. The champion question is free.
create or replace function public.f1_season_tables_require_pro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.driver_table_enabled and not coalesce(old.driver_table_enabled, false))
     or (new.constructor_table_enabled and not coalesce(old.constructor_table_enabled, false)) then
    if not exists (
      select 1 from participants p
      where p.competition_id = new.competition_id and p.role = 'admin' and public.has_pro(p.user_id)
    ) then
      raise exception 'FREE_TIER_F1_TABLES: The full drivers'' and constructors'' tables are part of ALOTO Pro';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists f1_season_tables_require_pro on public.f1_season_configs;
create trigger f1_season_tables_require_pro
  before insert or update on public.f1_season_configs
  for each row execute function public.f1_season_tables_require_pro();

-- Save one of your season answers in one go (champion, or a whole table).
create or replace function public.f1_save_season(p_config_id uuid, p_kind text, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg f1_season_configs%rowtype;
  v_n   integer;
begin
  select * into v_cfg from f1_season_configs where id = p_config_id;
  if not found then raise exception 'No season predictions here'; end if;
  if not is_participant(v_cfg.competition_id) then raise exception 'You are not in this league'; end if;
  if not v_cfg.is_open or (v_cfg.deadline is not null and now() >= v_cfg.deadline) then
    raise exception 'F1_SEASON_LOCKED: Season predictions are closed';
  end if;
  if p_kind = 'drivers' and not v_cfg.driver_table_enabled then raise exception 'The drivers'' table is not on in this league'; end if;
  if p_kind = 'constructors' and not v_cfg.constructor_table_enabled then raise exception 'The constructors'' table is not on in this league'; end if;
  if p_kind not in ('champion', 'drivers', 'constructors') then raise exception 'Unknown prediction'; end if;

  delete from f1_season_entries where config_id = p_config_id and user_id = auth.uid() and kind = p_kind;

  insert into f1_season_entries (config_id, user_id, kind, position, driver_id, team_id)
  select p_config_id, auth.uid(), p_kind, t.ord::int,
         case when p_kind = 'constructors' then null else t.d end,
         case when p_kind = 'constructors' then t.d else null end
  from unnest(case when p_kind = 'champion' then p_ids[1:1] else p_ids end) with ordinality as t(d, ord)
  where t.d is not null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.f1_save_season(uuid, text, uuid[]) to authenticated;

-- Score the season from the championship standings sync-f1 keeps. Can be run
-- during the season to see where everyone would stand ("if it ended now");
-- p_final = true marks it settled.
create or replace function public.f1_score_season(p_config_id uuid, p_final boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg f1_season_configs%rowtype;
  v_n   integer;
begin
  select * into v_cfg from f1_season_configs where id = p_config_id;
  if not found then return 0; end if;
  if auth.role() <> 'service_role' and not is_competition_admin(v_cfg.competition_id) then
    raise exception 'Only a league admin can settle the season';
  end if;

  with hits as (
    select e.user_id, e.kind
    from f1_season_entries e
    join f1_championship ch
      on ch.season = v_cfg.season
     and ((e.kind = 'champion'     and ch.kind = 'drivers'      and ch.position = 1          and ch.driver_id = e.driver_id)
       or (e.kind = 'drivers'      and ch.kind = 'drivers'      and ch.position = e.position and ch.driver_id = e.driver_id and v_cfg.driver_table_enabled)
       or (e.kind = 'constructors' and ch.kind = 'constructors' and ch.position = e.position and ch.team_id   = e.team_id   and v_cfg.constructor_table_enabled))
    where e.config_id = p_config_id
  ),
  everyone as (
    select distinct user_id from f1_season_entries where config_id = p_config_id
  ),
  sums as (
    select ev.user_id,
           count(h.kind) filter (where h.kind in ('drivers', 'constructors'))::int as table_correct,
           (count(h.kind) filter (where h.kind = 'drivers') * v_cfg.driver_table_points
            + count(h.kind) filter (where h.kind = 'constructors') * v_cfg.constructor_table_points)::int as table_points,
           count(h.kind) filter (where h.kind = 'champion')::int as picks_correct,
           (count(h.kind) filter (where h.kind = 'champion') * v_cfg.champion_points)::int as picks_points
    from everyone ev left join hits h on h.user_id = ev.user_id
    group by ev.user_id
  )
  insert into season_scores (competition_id, user_id, table_points, table_correct, picks_points, picks_correct, updated_at)
  select v_cfg.competition_id, s.user_id, s.table_points, s.table_correct, s.picks_points, s.picks_correct, now()
  from sums s
  on conflict (competition_id, user_id) do update
    set table_points = excluded.table_points, table_correct = excluded.table_correct,
        picks_points = excluded.picks_points, picks_correct = excluded.picks_correct, updated_at = now();

  get diagnostics v_n = row_count;
  if p_final then update f1_season_configs set settled = true where id = p_config_id; end if;
  return v_n;
end;
$$;

grant execute on function public.f1_score_season(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- STEP 7 — The F1 feed's log and daily request count, separate from
-- football's and the NFL's.
-- ---------------------------------------------------------------------------
create table if not exists public.f1_sync_log (
  id             uuid primary key default uuid_generate_v4(),
  ran_at         timestamptz not null default now(),
  kind           text not null,
  requests_used  int  not null default 0,
  rows_updated   int  not null default 0,
  error          text
);

create index if not exists idx_f1_sync_log_ran on public.f1_sync_log (ran_at desc);

create or replace function public.f1_requests_used_today()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(requests_used), 0)::int
  from f1_sync_log
  where ran_at >= date_trunc('day', now() at time zone 'UTC');
$$;

grant execute on function public.f1_requests_used_today() to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 8 — Who can read what. Everything is written by sync-f1 (service role)
-- or through the functions above; nobody writes these tables directly.
-- ---------------------------------------------------------------------------
alter table public.f1_teams          enable row level security;
alter table public.f1_drivers        enable row level security;
alter table public.f1_races          enable row level security;
alter table public.f1_results        enable row level security;
alter table public.f1_championship   enable row level security;
alter table public.f1_picks          enable row level security;
alter table public.f1_race_scores    enable row level security;
alter table public.f1_season_configs enable row level security;
alter table public.f1_season_entries enable row level security;
alter table public.f1_sync_log       enable row level security;

drop policy if exists f1_teams_read        on public.f1_teams;
drop policy if exists f1_drivers_read      on public.f1_drivers;
drop policy if exists f1_races_read        on public.f1_races;
drop policy if exists f1_races_admin       on public.f1_races;
drop policy if exists f1_results_read      on public.f1_results;
drop policy if exists f1_championship_read on public.f1_championship;
drop policy if exists f1_picks_read        on public.f1_picks;
drop policy if exists f1_race_scores_read  on public.f1_race_scores;
drop policy if exists f1_season_cfg_read   on public.f1_season_configs;
drop policy if exists f1_season_cfg_admin  on public.f1_season_configs;
drop policy if exists f1_season_ent_read   on public.f1_season_entries;
drop policy if exists f1_sync_log_read     on public.f1_sync_log;

create policy f1_teams_read        on public.f1_teams        for select to authenticated using (true);
create policy f1_drivers_read      on public.f1_drivers      for select to authenticated using (true);
create policy f1_races_read        on public.f1_races        for select to authenticated using (true);
create policy f1_results_read      on public.f1_results      for select to authenticated using (true);
create policy f1_championship_read on public.f1_championship for select to authenticated using (true);
create policy f1_sync_log_read     on public.f1_sync_log     for select to authenticated using (true);

-- Admins can correct a race's times by hand.
create policy f1_races_admin on public.f1_races for update to authenticated
  using (f1_is_race_admin(id)) with check (f1_is_race_admin(id));

-- Your own picks always; everyone's once the session has locked, so the
-- league can compare, as with football predictions after kickoff.
create policy f1_picks_read on public.f1_picks for select to authenticated
  using (user_id = auth.uid()
         or (now() >= f1_lock_time(race_id, session) and f1_is_race_player(race_id)));

create policy f1_race_scores_read on public.f1_race_scores for select to authenticated
  using (is_participant(competition_id));

create policy f1_season_cfg_read on public.f1_season_configs for select to authenticated
  using (is_participant(competition_id));
create policy f1_season_cfg_admin on public.f1_season_configs for all to authenticated
  using (is_competition_admin(competition_id)) with check (is_competition_admin(competition_id));

create policy f1_season_ent_read on public.f1_season_entries for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from f1_season_configs c
    where c.id = config_id and is_participant(c.competition_id)
      and c.deadline is not null and now() >= c.deadline));

-- ---------------------------------------------------------------------------
-- STEP 9 — Check. Every value should match "expected".
-- ---------------------------------------------------------------------------
select 'F1 sport (off until 121)' as check,
       (select name || ', enabled ' || enabled from public.sports where id = 'f1') as value,
       'F1, enabled false' as expected
union all
select 'F1 tables',
       (select count(*)::text from information_schema.tables
         where table_schema = 'public' and table_name in
           ('f1_teams','f1_drivers','f1_races','f1_results','f1_championship','f1_picks',
            'f1_race_scores','f1_season_configs','f1_season_entries','f1_sync_log')),
       '10'
union all
select 'F1 point columns',
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'point_rules'
           and column_name in ('f1_grid_points','f1_grid_positions','f1_race_points','f1_race_positions','f1_sprint_points')),
       '5'
union all
select 'F1 functions',
       (select count(*)::text from pg_proc where proname in
         ('f1_save_picks','f1_score_race','f1_confirm_session','f1_set_result','f1_unconfirm_session',
          'f1_save_season','f1_score_season','f1_requests_used_today')),
       '8';
