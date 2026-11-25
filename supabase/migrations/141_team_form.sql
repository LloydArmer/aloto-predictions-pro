-- 141_team_form.sql
-- Last 5 results and league position for the real teams on the Predict match
-- cards (League, Group + Knockout and Knockout), using the same W/D/L chips as
-- Last Man Standing.
--
-- Where it comes from:
--   * sync-lms already loads a whole league season (one request) and its table
--     (one more) into lms_fixtures / lms_standings for Last Man Standing.
--   * It now does the same for every league a predicted match comes from:
--     Premier League, Championship, League One, and so on. It looks each
--     linked match up once (20 per request) to learn its league, saved in the
--     three columns below.
--   * For a CUP match (FA Cup, Champions League...) there is no league season
--     to load, so each of its two teams has its last 5 games in any
--     competition fetched directly (one request per team, twice a day) into
--     team_recent_fixtures.
--   * team_form() then reads the last 5 finished games per team, plus any
--     finished match in a competition here, and the team's league position.
--
-- Safe to run more than once.

alter table public.fixtures add column if not exists api_league_id   int;
alter table public.fixtures add column if not exists api_season      int;
-- 'league' (Regular Season rounds, so form can be loaded) or 'cup'.
alter table public.fixtures add column if not exists api_league_kind text;
alter table public.fixtures add column if not exists api_home_team_id int;
alter table public.fixtures add column if not exists api_away_team_id int;

-- Recent games of teams playing in cup matches, any competition.
create table if not exists public.team_recent_fixtures (
  api_fixture_id bigint primary key,
  kickoff        timestamptz not null,
  status         text not null,
  home_team_id   int  not null,
  home_team      text not null,
  away_team_id   int  not null,
  away_team      text not null,
  home_goals     int,
  away_goals     int,
  updated_at     timestamptz not null default now()
);
-- When each team's last 5 were last fetched.
create table if not exists public.team_form_sync (
  team_id    int primary key,
  team_name  text,
  fetched_at timestamptz not null default now()
);
alter table public.team_recent_fixtures enable row level security;
alter table public.team_form_sync       enable row level security;
-- No policies: only the sync (service role) and team_form() read them.

drop function if exists public.team_form(text[], timestamptz);

create or replace function public.team_form(p_teams text[], p_before timestamptz default now())
returns table (team text, kickoff timestamptz, res text, opponent text, home boolean, score text, table_position int)
language sql
stable
security definer
set search_path = public
as $$
  with games as (
    select distinct on (lower(g.home_team), lower(g.away_team), (g.kickoff at time zone 'UTC')::date)
           g.kickoff, g.home_team, g.away_team, g.hg, g.ag
    from (
      select lf.kickoff, lf.home_team, lf.away_team, lf.home_goals as hg, lf.away_goals as ag, 1 as src
      from lms_fixtures lf
      where lf.sport = 'football'
        and lf.status in ('FT', 'AET', 'PEN', 'AWD', 'WO')
        and lf.home_goals is not null and lf.away_goals is not null
      union all
      select r.kickoff, r.home_team, r.away_team, r.home_goals, r.away_goals, 2
      from team_recent_fixtures r
      where r.status in ('FT', 'AET', 'PEN', 'AWD', 'WO')
        and r.home_goals is not null and r.away_goals is not null
      union all
      select f.kickoff_time, f.home_team, f.away_team, f.home_score, f.away_score, 3
      from fixtures f
      where f.home_score is not null and f.away_score is not null
        and f.status is distinct from 'void'
        and f.api_nfl_game_id is null
    ) g
    where g.kickoff < p_before
    order by lower(g.home_team), lower(g.away_team), (g.kickoff at time zone 'UTC')::date, g.src
  ),
  teams as (select distinct t from unnest(p_teams) t where t is not null),
  last5 as (
    select t.t as team, x.*
    from teams t
    cross join lateral (
      select g.kickoff,
             case when lower(g.home_team) = lower(t.t) then g.hg else g.ag end as mine,
             case when lower(g.home_team) = lower(t.t) then g.ag else g.hg end as theirs,
             case when lower(g.home_team) = lower(t.t) then g.away_team else g.home_team end as opponent,
             lower(g.home_team) = lower(t.t) as home
      from games g
      where lower(g.home_team) = lower(t.t) or lower(g.away_team) = lower(t.t)
      order by g.kickoff desc
      limit 5
    ) x
  ),
  pos as (
    select distinct on (lower(s.team_name)) lower(s.team_name) as k, s.position
    from lms_standings s
    where s.sport = 'football'
    order by lower(s.team_name), s.season desc, s.updated_at desc
  )
  select l.team, l.kickoff,
         case when l.mine > l.theirs then 'W' when l.mine = l.theirs then 'D' else 'L' end,
         l.opponent, l.home, l.mine || '-' || l.theirs,
         (select p.position from pos p where p.k = lower(l.team))
  from last5 l
  order by l.team, l.kickoff;
$$;

revoke all on function public.team_form(text[], timestamptz) from public, anon;
grant execute on function public.team_form(text[], timestamptz) to authenticated;

-- Check: the new columns, tables and the function.
select 'fixtures form columns' as check,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'fixtures'
           and column_name in ('api_league_id', 'api_season', 'api_league_kind', 'api_home_team_id', 'api_away_team_id'))::text as value,
       '5' as expected
union all
select 'form tables',
       (select count(*) from information_schema.tables
         where table_schema = 'public' and table_name in ('team_recent_fixtures', 'team_form_sync'))::text, '2'
union all
select 'team_form function',
       (select count(*) from pg_proc where proname = 'team_form')::text, '1';
