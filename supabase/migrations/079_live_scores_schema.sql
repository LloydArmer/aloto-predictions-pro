-- 079_live_scores_schema.sql
--
-- Foundation for automatic results and live scores.
--
-- The design principle throughout: this is an ENHANCEMENT layered on manual
-- entry, never a replacement. Coverage stops at step 4 of the English pyramid,
-- so North West Counties, West Lancashire, works leagues and Sunday leagues are
-- all outside it — and an admin running one of those must keep working exactly
-- as they do now. Every column added here is nullable, and nothing existing
-- changes behaviour.
--
-- RUN ON DEV FIRST.

-- ---------------------------------------------------------------------------
-- STEP 1 — Which competitions the API covers, cached locally.
--
-- Cached because the free tier allows 100 requests a day and this list changes
-- perhaps twice a season. Re-fetching it on every page load would spend the
-- whole allowance before anyone had predicted anything.
-- ---------------------------------------------------------------------------
create table if not exists api_leagues (
  id            int primary key,          -- API-Football's own league id
  name          text not null,
  country       text,
  type          text,                     -- 'League' or 'Cup'
  logo_url      text,
  current_season int,
  -- Whether live in-play events are available. The FA Cup, for instance, gives
  -- fixtures and final results but no minute-by-minute — worth knowing before
  -- promising an admin live updates that won't come.
  has_live_events boolean not null default false,
  last_synced_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- STEP 2 — Link a gameweek to a competition and season.
--
-- Set once by the admin, then fixture lookups know where to search. Null means
-- a manually-run gameweek, which is the default and always permitted.
-- ---------------------------------------------------------------------------
alter table gameweeks add column if not exists api_league_id int references api_leagues(id) on delete set null;
alter table gameweeks add column if not exists api_season    int;

-- ---------------------------------------------------------------------------
-- STEP 3 — Link an individual fixture to a real match.
--
-- api_fixture_id is what makes automatic results possible. Where it's null the
-- fixture is manual and the admin enters the result, exactly as today.
--
-- The live columns are kept SEPARATE from home_score/away_score on purpose.
-- Scoring reads home_score, which only an admin sets; live data lands in its
-- own columns and is displayed as provisional. A wrong feed can therefore never
-- silently change anyone's points — the admin still confirms the result, and
-- that confirmation is one tap once the data is sitting there.
-- ---------------------------------------------------------------------------
alter table fixtures add column if not exists api_fixture_id  bigint unique;
alter table fixtures add column if not exists live_home_score int;
alter table fixtures add column if not exists live_away_score int;
-- 'NS' not started, '1H' first half, 'HT' half time, '2H', 'FT' full time,
-- 'PST' postponed, 'CANC' cancelled — API-Football's own short codes.
alter table fixtures add column if not exists live_status     text;
alter table fixtures add column if not exists live_minute     int;
alter table fixtures add column if not exists live_updated_at timestamptz;

create index if not exists idx_fixtures_api_id on fixtures(api_fixture_id) where api_fixture_id is not null;

-- ---------------------------------------------------------------------------
-- STEP 4 — A log of what the sync did.
--
-- Two purposes: seeing why a result didn't arrive, and staying inside the
-- request quota. Without a record of when each league was last polled, a
-- restarted job could burn a day's allowance in minutes.
-- ---------------------------------------------------------------------------
create table if not exists api_sync_log (
  id            uuid primary key default uuid_generate_v4(),
  ran_at        timestamptz not null default now(),
  kind          text not null,            -- 'leagues' | 'fixtures' | 'live'
  api_league_id int,
  requests_used int not null default 1,
  fixtures_seen int not null default 0,
  fixtures_updated int not null default 0,
  error         text
);

create index if not exists idx_api_sync_log_ran on api_sync_log(ran_at desc);

-- ---------------------------------------------------------------------------
-- STEP 5 — How many requests have been used today.
--
-- The free tier allows 100 a day, resetting at midnight UTC. The sync job calls
-- this before starting and stops short rather than failing halfway through with
-- a 429.
-- ---------------------------------------------------------------------------
create or replace function api_requests_used_today()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(requests_used), 0)::int
  from api_sync_log
  where ran_at >= date_trunc('day', now() at time zone 'UTC');
$$;

grant execute on function api_requests_used_today() to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 6 — Row level security.
--
-- The league list is readable by anyone signed in — it populates a dropdown.
-- Everything is written by the service role only, from the edge function.
-- ---------------------------------------------------------------------------
alter table api_leagues  enable row level security;
alter table api_sync_log enable row level security;

drop policy if exists api_leagues_read on api_leagues;
create policy api_leagues_read on api_leagues for select using (auth.role() = 'authenticated');

-- The sync log is operational detail, and it records nothing about any person,
-- so competition admins can read it to see why a result is missing.
drop policy if exists api_sync_log_read on api_sync_log;
create policy api_sync_log_read on api_sync_log for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- STEP 7 — Check.
-- ---------------------------------------------------------------------------
select 'api_leagues table'        as check,
       (select count(*)::text from information_schema.tables
        where table_schema='public' and table_name='api_leagues')                  as value,
       '1' as expected
union all
select 'api_sync_log table',
       (select count(*)::text from information_schema.tables
        where table_schema='public' and table_name='api_sync_log'), '1'
union all
select 'gameweek link columns',
       (select count(*)::text from information_schema.columns
        where table_name='gameweeks' and column_name in ('api_league_id','api_season')), '2'
union all
select 'fixture link + live columns',
       (select count(*)::text from information_schema.columns
        where table_name='fixtures'
          and column_name in ('api_fixture_id','live_home_score','live_away_score',
                              'live_status','live_minute','live_updated_at')), '6'
union all
select 'quota function',
       (select count(*)::text from pg_proc where proname='api_requests_used_today'), '1'
union all
-- Should be 0: nothing existing is linked, so nothing existing changes.
select 'fixtures already linked (expect 0)',
       (select count(*)::text from fixtures where api_fixture_id is not null), '0';
