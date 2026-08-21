-- 053_season_predictions.sql
--
-- Season Predictions: a separate strand from gameweek predictions and cups.
-- Two independent parts, each enabled and scored on its own:
--
--   Final League Table  order a league's teams 1..N before the season starts
--   Individual Picks    one-off calls — who wins the league, the cup, the
--                       golden boot
--
-- Design decisions worth knowing, because they shape the UI:
--
-- 1. Teams and answers are PICKED FROM A LIST, never typed. A prediction stores
--    a team_id, not a name. That removes the whole class of "Man Utd" vs
--    "Manchester United" scoring failures — there is nothing to mistype.
--
-- 2. The team list is data, not code. An admin curates it once per season, so
--    promotions and relegations never need an app release.
--
-- 3. Points land against a NOMINATED GAMEWEEK (settled_gameweek_id). Season
--    points have no natural date of their own, and the monthly standings work
--    by gameweek — so the admin says which gameweek they count in.
--
-- RUN ON DEV FIRST.

-- ===========================================================================
-- PART 1 — Final League Table
-- ===========================================================================

create table if not exists season_table_configs (
  id                      uuid primary key default uuid_generate_v4(),
  competition_id          uuid not null references competitions(id) on delete cascade,
  league_name             text not null,                 -- 'English Premier League'
  team_count              int  not null check (team_count between 2 and 32),
  points_per_position     int  not null default 3,       -- awarded per exactly-right position
  deadline                timestamptz,                   -- entries lock at this moment
  is_open                 boolean not null default false,-- admin switches predictions on
  results_entered         boolean not null default false,-- admin has entered the real table
  settled_gameweek_id     uuid references gameweeks(id) on delete set null,
  created_at              timestamptz not null default now(),
  -- One final-table prediction per competition per season. A second season
  -- means a second competition, which is how the app already works.
  unique (competition_id)
);

-- The pool of teams for this league. Ordering here is just display order in
-- the admin list; it says nothing about the real table.
create table if not exists season_table_teams (
  id          uuid primary key default uuid_generate_v4(),
  config_id   uuid not null references season_table_configs(id) on delete cascade,
  name        text not null,
  short_name  text,                                      -- for narrow mobile rows
  sort_order  int  not null default 0,
  unique (config_id, name)
);

-- A participant's predicted table: one row per position.
create table if not exists season_table_predictions (
  id          uuid primary key default uuid_generate_v4(),
  config_id   uuid not null references season_table_configs(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  team_id     uuid not null references season_table_teams(id) on delete cascade,
  position    int  not null check (position > 0),
  updated_at  timestamptz not null default now(),
  -- Each position filled once, and each team used once. The database enforces
  -- a valid ordering so the app cannot save a half-broken table.
  unique (config_id, user_id, position),
  unique (config_id, user_id, team_id)
);

-- The real final table, entered by the admin.
create table if not exists season_table_results (
  id          uuid primary key default uuid_generate_v4(),
  config_id   uuid not null references season_table_configs(id) on delete cascade,
  team_id     uuid not null references season_table_teams(id) on delete cascade,
  position    int  not null check (position > 0),
  unique (config_id, position),
  unique (config_id, team_id)
);

-- ===========================================================================
-- PART 2 — Individual Picks
-- ===========================================================================

create table if not exists season_pick_configs (
  id                   uuid primary key default uuid_generate_v4(),
  competition_id       uuid not null references competitions(id) on delete cascade,
  deadline             timestamptz,
  is_open              boolean not null default false,
  settled_gameweek_id  uuid references gameweeks(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (competition_id)
);

-- One row per question the admin has switched on. `points` is per question, so
-- the Golden Boot can be worth more than the Conference League if the admin
-- wants. New questions are just new rows — no release needed.
create table if not exists season_picks (
  id                 uuid primary key default uuid_generate_v4(),
  config_id          uuid not null references season_pick_configs(id) on delete cascade,
  label              text not null,                      -- 'Premier League Winners'
  points             int  not null default 10,
  sort_order         int  not null default 0,
  correct_option_id  uuid,                               -- set by the admin at the end
  -- Free-text questions. Most picks are "choose one of these 20 teams", where a
  -- dropdown removes any chance of a typo. The Golden Boot isn't like that:
  -- hundreds of possible players, and the plausible list shifts in January. So
  -- that one is typed, and the admin decides afterwards which answers count —
  -- which is also how "Haaland" and "Erling Haaland" both get credited without
  -- anyone fighting a dropdown.
  allow_free_text    boolean not null default false,
  correct_answer     text,                               -- the admin's note of the right answer
  created_at         timestamptz not null default now()
);

alter table season_picks add column if not exists allow_free_text boolean not null default false;
alter table season_picks add column if not exists correct_answer  text;

-- The choices for a question. Participants select one; they never type.
create table if not exists season_pick_options (
  id          uuid primary key default uuid_generate_v4(),
  pick_id     uuid not null references season_picks(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  unique (pick_id, name)
);

alter table season_picks
  drop constraint if exists season_picks_correct_option_fk;
alter table season_picks
  add constraint season_picks_correct_option_fk
  foreign key (correct_option_id) references season_pick_options(id) on delete set null;

create table if not exists season_pick_answers (
  id          uuid primary key default uuid_generate_v4(),
  pick_id     uuid not null references season_picks(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  -- Exactly one of these is used, depending on the pick's allow_free_text.
  option_id   uuid references season_pick_options(id) on delete cascade,
  answer_text text,
  -- Only used by free-text picks, and only the admin can set it: they read the
  -- typed answers and tick the ones that count. Option-based picks ignore this
  -- and are scored by comparing option_id with the pick's correct_option_id,
  -- which needs no human judgement at all.
  is_correct  boolean,
  updated_at  timestamptz not null default now(),
  unique (pick_id, user_id),
  constraint season_pick_answers_one_form check (
    (option_id is not null and answer_text is null)
    or (option_id is null and answer_text is not null)
  )
);

-- ===========================================================================
-- PART 3 — Scored totals
-- ===========================================================================
--
-- Written once when the admin runs the scoring, rather than recalculated on
-- every page load: a season score is final, and the standings shouldn't have to
-- re-derive it every time someone opens the table.

create table if not exists season_scores (
  id                    uuid primary key default uuid_generate_v4(),
  competition_id        uuid not null references competitions(id) on delete cascade,
  user_id               uuid not null references profiles(id) on delete cascade,
  table_points          int  not null default 0,
  table_correct         int  not null default 0,   -- how many positions were exactly right
  picks_points          int  not null default 0,
  picks_correct         int  not null default 0,
  settled_gameweek_id   uuid references gameweeks(id) on delete set null,
  updated_at            timestamptz not null default now(),
  unique (competition_id, user_id)
);

-- ===========================================================================
-- Indexes
-- ===========================================================================
create index if not exists idx_stt_config    on season_table_teams(config_id);
create index if not exists idx_stp_user      on season_table_predictions(config_id, user_id);
create index if not exists idx_str_config    on season_table_results(config_id);
create index if not exists idx_sp_config     on season_picks(config_id);
create index if not exists idx_spo_pick      on season_pick_options(pick_id);
create index if not exists idx_spa_user      on season_pick_answers(pick_id, user_id);
create index if not exists idx_ss_comp       on season_scores(competition_id);

-- ===========================================================================
-- Row level security
-- ===========================================================================
--
-- Shape throughout: participants of the competition can read; only its admins
-- can change configuration; participants write only their OWN entries, and
-- only while the deadline is open.

alter table season_table_configs     enable row level security;
alter table season_table_teams       enable row level security;
alter table season_table_predictions enable row level security;
alter table season_table_results     enable row level security;
alter table season_pick_configs      enable row level security;
alter table season_picks             enable row level security;
alter table season_pick_options      enable row level security;
alter table season_pick_answers      enable row level security;
alter table season_scores            enable row level security;

-- Helper: is the caller a participant of this competition?
create or replace function is_participant(p_competition_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from participants
    where competition_id = p_competition_id and user_id = auth.uid()
  );
$$;

-- Helper: is the caller an ADMIN of this competition?
create or replace function is_competition_admin(p_competition_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from participants
    where competition_id = p_competition_id and user_id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function is_participant(uuid)        to authenticated;
grant execute on function is_competition_admin(uuid)  to authenticated;

-- Config tables: participants read, admins write.
drop policy if exists stc_read  on season_table_configs;
drop policy if exists stc_write on season_table_configs;
create policy stc_read  on season_table_configs for select using (is_participant(competition_id));
create policy stc_write on season_table_configs for all
  using (is_competition_admin(competition_id)) with check (is_competition_admin(competition_id));

drop policy if exists spc_read  on season_pick_configs;
drop policy if exists spc_write on season_pick_configs;
create policy spc_read  on season_pick_configs for select using (is_participant(competition_id));
create policy spc_write on season_pick_configs for all
  using (is_competition_admin(competition_id)) with check (is_competition_admin(competition_id));

-- Everything hanging off a config inherits that config's competition.
drop policy if exists stt_read  on season_table_teams;
drop policy if exists stt_write on season_table_teams;
create policy stt_read on season_table_teams for select using (
  exists (select 1 from season_table_configs c where c.id = config_id and is_participant(c.competition_id)));
create policy stt_write on season_table_teams for all using (
  exists (select 1 from season_table_configs c where c.id = config_id and is_competition_admin(c.competition_id)))
  with check (
  exists (select 1 from season_table_configs c where c.id = config_id and is_competition_admin(c.competition_id)));

drop policy if exists str_read  on season_table_results;
drop policy if exists str_write on season_table_results;
create policy str_read on season_table_results for select using (
  exists (select 1 from season_table_configs c where c.id = config_id and is_participant(c.competition_id)));
create policy str_write on season_table_results for all using (
  exists (select 1 from season_table_configs c where c.id = config_id and is_competition_admin(c.competition_id)))
  with check (
  exists (select 1 from season_table_configs c where c.id = config_id and is_competition_admin(c.competition_id)));

drop policy if exists sp_read  on season_picks;
drop policy if exists sp_write on season_picks;
create policy sp_read on season_picks for select using (
  exists (select 1 from season_pick_configs c where c.id = config_id and is_participant(c.competition_id)));
create policy sp_write on season_picks for all using (
  exists (select 1 from season_pick_configs c where c.id = config_id and is_competition_admin(c.competition_id)))
  with check (
  exists (select 1 from season_pick_configs c where c.id = config_id and is_competition_admin(c.competition_id)));

drop policy if exists spo_read  on season_pick_options;
drop policy if exists spo_write on season_pick_options;
create policy spo_read on season_pick_options for select using (
  exists (select 1 from season_picks p join season_pick_configs c on c.id = p.config_id
          where p.id = pick_id and is_participant(c.competition_id)));
create policy spo_write on season_pick_options for all using (
  exists (select 1 from season_picks p join season_pick_configs c on c.id = p.config_id
          where p.id = pick_id and is_competition_admin(c.competition_id)))
  with check (
  exists (select 1 from season_picks p join season_pick_configs c on c.id = p.config_id
          where p.id = pick_id and is_competition_admin(c.competition_id)));

-- ---------------------------------------------------------------------------
-- Participant entries.
--
-- Readable by everyone in the competition ONLY once the deadline has passed —
-- the same principle as predictions locking at kickoff. Before then you can see
-- your own and nobody else's.
--
-- Writable only by their owner, and only while the config is open and the
-- deadline hasn't passed. The deadline is enforced HERE rather than in the app,
-- so a late entry cannot be slipped in through the API.
-- ---------------------------------------------------------------------------
drop policy if exists stp_read  on season_table_predictions;
drop policy if exists stp_write on season_table_predictions;
create policy stp_read on season_table_predictions for select using (
  user_id = auth.uid()
  or exists (select 1 from season_table_configs c
             where c.id = config_id and is_participant(c.competition_id)
               and c.deadline is not null and c.deadline < now()));
create policy stp_write on season_table_predictions for all using (
  user_id = auth.uid()
  and exists (select 1 from season_table_configs c
              where c.id = config_id and c.is_open
                and (c.deadline is null or c.deadline > now())))
  with check (
  user_id = auth.uid()
  and exists (select 1 from season_table_configs c
              where c.id = config_id and c.is_open
                and (c.deadline is null or c.deadline > now())));

drop policy if exists spa_read  on season_pick_answers;
drop policy if exists spa_write on season_pick_answers;
create policy spa_read on season_pick_answers for select using (
  user_id = auth.uid()
  or exists (select 1 from season_picks p join season_pick_configs c on c.id = p.config_id
             where p.id = pick_id and is_participant(c.competition_id)
               and c.deadline is not null and c.deadline < now()));
create policy spa_write on season_pick_answers for all using (
  user_id = auth.uid()
  and exists (select 1 from season_picks p join season_pick_configs c on c.id = p.config_id
              where p.id = pick_id and c.is_open
                and (c.deadline is null or c.deadline > now())))
  with check (
  user_id = auth.uid()
  and exists (select 1 from season_picks p join season_pick_configs c on c.id = p.config_id
              where p.id = pick_id and c.is_open
                and (c.deadline is null or c.deadline > now())));

drop policy if exists ss_read  on season_scores;
drop policy if exists ss_write on season_scores;
create policy ss_read  on season_scores for select using (is_participant(competition_id));
create policy ss_write on season_scores for all
  using (is_competition_admin(competition_id)) with check (is_competition_admin(competition_id));

-- ===========================================================================
-- Check
-- ===========================================================================
select table_name
from information_schema.tables
where table_schema = 'public' and table_name like 'season_%'
order by table_name;

-- ---------------------------------------------------------------------------
-- The admin marks free-text answers correct. Participants must not be able to
-- set is_correct on their own answer, so that column is writable only through
-- this function, which checks admin rights first.
-- ---------------------------------------------------------------------------
create or replace function mark_pick_answer(p_answer_id uuid, p_correct boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  comp_id uuid;
begin
  select c.competition_id into comp_id
  from season_pick_answers a
  join season_picks p        on p.id = a.pick_id
  join season_pick_configs c on c.id = p.config_id
  where a.id = p_answer_id;

  if comp_id is null then
    raise exception 'No such answer';
  end if;

  if not is_competition_admin(comp_id) then
    raise exception 'Only an admin of this competition can mark answers';
  end if;

  update season_pick_answers set is_correct = p_correct where id = p_answer_id;
end;
$$;

grant execute on function mark_pick_answer(uuid, boolean) to authenticated;

-- Expect nine tables: season_pick_answers, season_pick_configs,
-- season_pick_options, season_picks, season_scores, season_table_configs,
-- season_table_predictions, season_table_results, season_table_teams.
