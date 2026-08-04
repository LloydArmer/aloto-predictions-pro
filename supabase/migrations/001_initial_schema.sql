-- ============================================================
-- ALOTO Prediction Pro — Supabase database schema
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- Profiles (auto-created on signup)
create table profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  display_name     text not null,
  avatar_initials  text generated always as (upper(left(display_name,2))) stored,
  email            text,
  role             text not null default 'player' check (role in ('player','admin')),
  phone_number     text,
  notify_whatsapp  boolean default true,
  notify_sms       boolean default false,
  wa_opted_in      boolean default false,
  created_at       timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)), new.email);
  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure handle_new_user();

-- Competitions
create table competitions (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  emoji       text default '⚽',
  format      text not null default 'league' check (format in ('league','knockout','group_knockout')),
  status      text not null default 'active' check (status in ('active','paused','completed')),
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);

-- Point rules (one row per competition, auto-created)
create table point_rules (
  id                       uuid primary key default uuid_generate_v4(),
  competition_id           uuid not null unique references competitions(id) on delete cascade,
  exact_score_points       int not null default 5,
  correct_result_points    int not null default 2,
  clean_sheet_bonus        int not null default 1,
  correct_finalist_points  int not null default 5,
  correct_winner_points    int not null default 10,
  updated_at               timestamptz not null default now()
);

create or replace function create_default_rules() returns trigger language plpgsql as $$
begin insert into point_rules (competition_id) values (new.id); return new; end; $$;
create trigger on_competition_created after insert on competitions for each row execute procedure create_default_rules();

-- Participants
create table participants (
  id              uuid primary key default uuid_generate_v4(),
  competition_id  uuid not null references competitions(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  role            text not null default 'player' check (role in ('player','admin')),
  joined_at       timestamptz not null default now(),
  unique (competition_id, user_id)
);

-- Invitations
create table invitations (
  id              uuid primary key default uuid_generate_v4(),
  competition_id  uuid not null references competitions(id) on delete cascade,
  email           text not null,
  invited_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  unique (competition_id, email)
);

-- Gameweeks (month_key drives monthly leaderboards — admin-assigned)
create table gameweeks (
  id              uuid primary key default uuid_generate_v4(),
  competition_id  uuid not null references competitions(id) on delete cascade,
  number          int not null,
  status          text not null default 'upcoming' check (status in ('upcoming','active','completed')),
  month_key       text,   -- 'YYYY-MM' — admin assigns each GW to a month
  deadline        timestamptz,
  created_at      timestamptz not null default now(),
  unique (competition_id, number)
);

-- Fixtures
create table fixtures (
  id              uuid primary key default uuid_generate_v4(),
  gameweek_id     uuid not null references gameweeks(id) on delete cascade,
  home_team       text not null,
  away_team       text not null,
  kickoff_time    timestamptz not null,
  venue           text,
  home_score      int,
  away_score      int,
  status          text not null default 'upcoming' check (status in ('upcoming','active','completed')),
  created_at      timestamptz not null default now()
);

-- Predictions
create table predictions (
  id              uuid primary key default uuid_generate_v4(),
  fixture_id      uuid not null references fixtures(id) on delete cascade,
  gameweek_id     uuid not null references gameweeks(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  predicted_home  int not null,
  predicted_away  int not null,
  points_earned   int not null default 0,
  submitted_at    timestamptz not null default now(),
  unique (fixture_id, user_id)
);

-- Gameweek scores (aggregated)
create table gameweek_scores (
  id              uuid primary key default uuid_generate_v4(),
  gameweek_id     uuid not null references gameweeks(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  points          int not null default 0,
  exact_scores    int not null default 0,
  correct_results int not null default 0,
  updated_at      timestamptz not null default now(),
  unique (gameweek_id, user_id)
);

-- Reminder log (prevents duplicate sends)
create table reminder_log (
  id              uuid primary key default uuid_generate_v4(),
  fixture_id      uuid not null references fixtures(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  reminder_type   text not null,
  channel         text not null,
  sent_at         timestamptz not null default now(),
  unique (fixture_id, user_id, reminder_type, channel)
);

-- Bracket matches
create table bracket_matches (
  id              uuid primary key default uuid_generate_v4(),
  competition_id  uuid not null references competitions(id) on delete cascade,
  round           text not null,
  round_order     int not null default 0,
  home_team       text,
  away_team       text,
  home_score      int,
  away_score      int,
  winner_team     text,
  status          text not null default 'upcoming',
  kickoff_time    timestamptz,
  created_at      timestamptz not null default now()
);

-- Bracket predictions
create table bracket_predictions (
  id               uuid primary key default uuid_generate_v4(),
  match_id         uuid not null references bracket_matches(id) on delete cascade,
  competition_id   uuid not null references competitions(id) on delete cascade,
  user_id          uuid not null references profiles(id) on delete cascade,
  predicted_winner text not null,
  points_earned    int not null default 0,
  created_at       timestamptz not null default now(),
  unique (match_id, user_id)
);

-- Overall leaderboard view
create or replace view leaderboard_overall as
select
  gw.competition_id,
  gs.user_id,
  pr.display_name,
  pr.avatar_initials,
  sum(gs.points)          as total_points,
  sum(gs.exact_scores)    as exact_scores,
  sum(gs.correct_results) as correct_results,
  count(gs.gameweek_id)   as games_played
from gameweek_scores gs
join gameweeks gw on gw.id = gs.gameweek_id
join profiles  pr on pr.id = gs.user_id
group by gw.competition_id, gs.user_id, pr.display_name, pr.avatar_initials;

-- Row level security
alter table profiles           enable row level security;
alter table competitions       enable row level security;
alter table point_rules        enable row level security;
alter table participants       enable row level security;
alter table invitations        enable row level security;
alter table gameweeks          enable row level security;
alter table fixtures           enable row level security;
alter table predictions        enable row level security;
alter table gameweek_scores    enable row level security;
alter table reminder_log       enable row level security;
alter table bracket_matches    enable row level security;
alter table bracket_predictions enable row level security;

create policy "profiles_select"    on profiles for select using (true);
create policy "profiles_update"    on profiles for update using (auth.uid() = id);
create policy "competitions_select" on competitions for select using (auth.role() = 'authenticated');
create policy "competitions_insert" on competitions for insert with check (auth.uid() = created_by);
create policy "rules_select"       on point_rules for select using (true);
create policy "rules_all"          on point_rules for all using (exists(select 1 from participants where competition_id=point_rules.competition_id and user_id=auth.uid() and role='admin'));
create policy "participants_select" on participants for select using (auth.role() = 'authenticated');
create policy "participants_insert" on participants for insert with check (auth.uid() = user_id or exists(select 1 from participants p2 where p2.competition_id=competition_id and p2.user_id=auth.uid() and p2.role='admin'));
create policy "participants_delete" on participants for delete using (exists(select 1 from participants p2 where p2.competition_id=competition_id and p2.user_id=auth.uid() and p2.role='admin'));
create policy "gameweeks_select"   on gameweeks for select using (auth.role() = 'authenticated');
create policy "gameweeks_admin"    on gameweeks for all using (exists(select 1 from participants where competition_id=gameweeks.competition_id and user_id=auth.uid() and role='admin'));
create policy "fixtures_select"    on fixtures for select using (auth.role() = 'authenticated');
create policy "fixtures_admin"     on fixtures for all using (exists(select 1 from participants pa join gameweeks gw on gw.competition_id=pa.competition_id where gw.id=fixtures.gameweek_id and pa.user_id=auth.uid() and pa.role='admin'));
create policy "predictions_select" on predictions for select using (user_id=auth.uid() or exists(select 1 from participants pa join gameweeks gw on gw.competition_id=pa.competition_id where gw.id=predictions.gameweek_id and pa.user_id=auth.uid() and pa.role='admin'));
create policy "predictions_insert" on predictions for insert with check (user_id=auth.uid());
create policy "predictions_update" on predictions for update using (user_id=auth.uid());
create policy "gw_scores_select"   on gameweek_scores for select using (auth.role() = 'authenticated');
create policy "gw_scores_admin"    on gameweek_scores for all using (exists(select 1 from participants pa join gameweeks gw on gw.competition_id=pa.competition_id where gw.id=gameweek_scores.gameweek_id and pa.user_id=auth.uid() and pa.role='admin'));
create policy "reminder_log_admin" on reminder_log for all using (exists(select 1 from profiles where id=auth.uid() and role='admin'));
create policy "bracket_select"     on bracket_matches for select using (auth.role() = 'authenticated');
create policy "bracket_admin"      on bracket_matches for all using (exists(select 1 from participants where competition_id=bracket_matches.competition_id and user_id=auth.uid() and role='admin'));
create policy "bpred_select"       on bracket_predictions for select using (user_id=auth.uid());
create policy "bpred_write"        on bracket_predictions for all using (user_id=auth.uid());

-- Indexes
create index idx_gw_comp        on gameweeks(competition_id);
create index idx_gw_month       on gameweeks(month_key);
create index idx_fx_gw          on fixtures(gameweek_id);
create index idx_pred_gw        on predictions(gameweek_id);
create index idx_pred_user      on predictions(user_id);
create index idx_gws_gw         on gameweek_scores(gameweek_id);
create index idx_gws_user       on gameweek_scores(user_id);
create index idx_part_comp      on participants(competition_id);
create index idx_bracket_comp   on bracket_matches(competition_id);
create index idx_reminder_fx    on reminder_log(fixture_id);
create index idx_reminder_user  on reminder_log(user_id);
