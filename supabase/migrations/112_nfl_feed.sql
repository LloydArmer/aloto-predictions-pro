-- 112_nfl_feed.sql
--
-- What the NFL feed (the sync-nfl edge function) needs. Separate from the
-- football feed's columns and log on purpose:
--
--   fixtures.api_nfl_game_id   The game's id in the NFL feed. NOT api_fixture_id:
--                              the two providers number their games
--                              independently, so sharing the column would let a
--                              football id and an NFL id collide, and the
--                              football sync would then poll NFL games.
--   fixtures.live_clock        The game clock from the feed ("08:41"), shown
--                              beside the quarter. The quarter itself goes in
--                              the existing live_status (Q1..Q4, HT, OT, FT, AOT).
--   nfl_sync_log               What the NFL sync did and how many requests it
--                              used. Its own table so NFL requests never count
--                              against football's daily allowance — they are
--                              separate subscriptions.
--
-- Every column is nullable and nothing existing changes. Safe to run twice.
--
-- RUN ON DEV FIRST, then production. The same file for both. Needs 111.

-- ---------------------------------------------------------------------------
-- STEP 1 — Link a fixture to an NFL game, and the game clock.
-- ---------------------------------------------------------------------------
alter table public.fixtures add column if not exists api_nfl_game_id bigint unique;
alter table public.fixtures add column if not exists live_clock text;

comment on column public.fixtures.api_nfl_game_id is
  'The game id in the API-SPORTS American Football feed. NFL only; football uses api_fixture_id. See 112.';
comment on column public.fixtures.live_clock is
  'NFL game clock from the feed, e.g. 08:41. The quarter is in live_status. See 112.';

-- ---------------------------------------------------------------------------
-- STEP 2 — The NFL sync log, and today's request count.
-- ---------------------------------------------------------------------------
create table if not exists public.nfl_sync_log (
  id             uuid primary key default uuid_generate_v4(),
  ran_at         timestamptz not null default now(),
  kind           text not null,          -- 'import' | 'live' | 'finalise' | 'error'
  requests_used  int  not null default 0,
  games_seen     int  not null default 0,
  games_updated  int  not null default 0,
  error          text
);

create index if not exists idx_nfl_sync_log_ran on public.nfl_sync_log (ran_at desc);

create or replace function public.nfl_requests_used_today()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(requests_used), 0)::int
  from nfl_sync_log
  where ran_at >= date_trunc('day', now() at time zone 'UTC');
$$;

grant execute on function public.nfl_requests_used_today() to authenticated;

-- Written by the edge function only (service role). Readable when signed in,
-- so an admin can see why a score is missing. It records nothing about anyone.
alter table public.nfl_sync_log enable row level security;
drop policy if exists nfl_sync_log_read on public.nfl_sync_log;
create policy nfl_sync_log_read on public.nfl_sync_log for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- STEP 3 — Check. Every value should match "expected".
-- ---------------------------------------------------------------------------
select 'fixtures NFL columns' as check,
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'fixtures'
           and column_name in ('api_nfl_game_id', 'live_clock')) as value,
       '2' as expected
union all
select 'nfl_sync_log table',
       (select count(*)::text from information_schema.tables
         where table_schema = 'public' and table_name = 'nfl_sync_log'), '1'
union all
select 'quota function',
       (select count(*)::text from pg_proc where proname = 'nfl_requests_used_today'), '1'
union all
select 'football fixtures untouched (NFL-linked fixtures, expect 0)',
       (select count(*)::text from fixtures where api_nfl_game_id is not null), '0';
