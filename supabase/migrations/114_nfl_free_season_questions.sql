-- 114_nfl_free_season_questions.sql
--
-- NFL season predictions on the free plan, limited to three questions
-- (Lloyd, 7 Nov 2026):
--
--   FREE:  Super Bowl Winner, AFC Champion, NFC Champion
--   PRO:   everything else: NFL MVP, the division winners, questions the admin
--          writes, and any question added in future.
--
-- Before this file, setting up NFL season predictions at all needed Pro (080).
--
-- How it works:
--   1. public.free_season_questions lists, per sport, the questions a free
--      admin may add. Only NFL has rows. A sport with no rows works exactly as
--      before: football is untouched.
--   2. season_picks_require_pro() (the 080 check on CREATING a set) now lets a
--      free admin create a set when the competition's sport has free questions.
--   3. A new check on season_picks, on adding a question or changing its name:
--      for a sport with free questions, a competition with no Pro admin may
--      only use a name on that list. A new question is therefore Pro unless
--      its name is added to the list here.
--
-- Questions already added are never removed or locked. An admin whose Pro
-- lapses keeps the questions they have, the same as 080; they just cannot add
-- Pro ones.
--
-- RUN ON DEV FIRST, then production. The same file for both. Needs 111.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- STEP 1 — The free questions, per sport.
-- ---------------------------------------------------------------------------
create table if not exists public.free_season_questions (
  sport  text not null references public.sports(id),
  label  text not null,
  primary key (sport, label)
);

comment on table public.free_season_questions is
  'Season prediction questions a competition with no Pro admin may add, per sport. A sport with no rows keeps the 080 rule (whole set is Pro). See 114.';

alter table public.free_season_questions enable row level security;

drop policy if exists free_season_questions_select on public.free_season_questions;
create policy free_season_questions_select on public.free_season_questions
  for select to authenticated using (true);

grant select on public.free_season_questions to authenticated;

insert into public.free_season_questions (sport, label) values
  ('nfl', 'Super Bowl Winner'),
  ('nfl', 'AFC Champion'),
  ('nfl', 'NFC Champion')
on conflict (sport, label) do nothing;

-- ---------------------------------------------------------------------------
-- STEP 2 — Creating a set: free for a sport with free questions.
-- Same function name and trigger as 080, so the trigger needs no change.
-- ---------------------------------------------------------------------------
create or replace function public.season_picks_require_pro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sport text;
begin
  select coalesce(c.sport, 'football') into v_sport
    from competitions c where c.id = new.competition_id;

  -- NFL (and any sport given free questions later): anyone may set up the
  -- set. Which questions go in it is checked on season_picks, step 3.
  if exists (select 1 from free_season_questions f where f.sport = v_sport) then
    return new;
  end if;

  -- Everything else, unchanged from 080: one of the competition's admins
  -- must have Pro.
  if not exists (
    select 1
    from participants p
    where p.competition_id = new.competition_id
      and p.role = 'admin'
      and public.has_pro(p.user_id)
  ) then
    raise exception 'FREE_TIER_PICKS_LIMIT: Individual season predictions are part of ALOTO Pro';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- STEP 3 — Adding or renaming a question: only free ones without Pro.
-- ---------------------------------------------------------------------------
create or replace function public.season_pick_question_requires_pro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition uuid;
  v_sport       text;
begin
  select cfg.competition_id, coalesce(c.sport, 'football')
    into v_competition, v_sport
    from season_pick_configs cfg
    join competitions c on c.id = cfg.competition_id
   where cfg.id = new.config_id;

  -- A sport with no free list: the set itself already needed Pro, so any
  -- question in it is allowed, as before.
  if not exists (select 1 from free_season_questions f where f.sport = v_sport) then
    return new;
  end if;

  -- A free question, matched ignoring case and spaces at either end.
  if exists (
    select 1 from free_season_questions f
    where f.sport = v_sport
      and lower(f.label) = lower(btrim(new.label))
  ) then
    return new;
  end if;

  -- Any other question: one of the competition's admins must have Pro.
  if exists (
    select 1
    from participants p
    where p.competition_id = v_competition
      and p.role = 'admin'
      and public.has_pro(p.user_id)
  ) then
    return new;
  end if;

  raise exception 'FREE_TIER_QUESTION_LIMIT: This season question is part of ALOTO Pro';
end;
$$;

drop trigger if exists season_picks_question_requires_pro on public.season_picks;

create trigger season_picks_question_requires_pro
  before insert or update of label on public.season_picks
  for each row execute function public.season_pick_question_requires_pro();

-- ---------------------------------------------------------------------------
-- STEP 4 — Check.
-- ---------------------------------------------------------------------------
select 'free NFL questions' as check,
       (select string_agg(label, ', ' order by label) from public.free_season_questions where sport = 'nfl') as value,
       'AFC Champion, NFC Champion, Super Bowl Winner' as expected
union all
select 'free football questions (expect none)',
       (select count(*)::text from public.free_season_questions where sport = 'football'), '0'
union all
select 'set trigger (080) still there',
       (select count(*)::text from pg_trigger where tgname = 'season_pick_configs_require_pro'), '1'
union all
select 'question trigger',
       (select count(*)::text from pg_trigger where tgname = 'season_picks_question_requires_pro'), '1';
