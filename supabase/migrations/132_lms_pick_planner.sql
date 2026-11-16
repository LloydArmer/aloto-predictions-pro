-- =============================================================================
-- 132 — Last Man Standing: pick planner.
--
-- Each player can plan which team each of their entries will use in the
-- gameweeks ahead. A plan is private to its owner and is only a note: it never
-- makes a pick. The real pick is still made on the Pick screen (or given
-- automatically at the deadline).
--
-- Run on Dev, then Prod, after 126–131.
-- =============================================================================

-- STEP 0 — 126 must already be in place.
do $$
begin
  if to_regclass('public.lms_entries') is null then
    raise exception 'Run 126_last_man_standing.sql on this project first, then this file.';
  end if;
end $$;

-- STEP 1 — The plan: one team per entry per gameweek.
create table if not exists public.lms_plans (
  entry_id   uuid not null references public.lms_entries(id) on delete cascade,
  game_id    uuid not null references public.lms_games(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  round      int  not null,
  team_id    int  not null,
  team_name  text not null,
  updated_at timestamptz not null default now(),
  primary key (entry_id, round)
);

create index if not exists idx_lms_plans_game_user on public.lms_plans (game_id, user_id);

-- STEP 2 — Only the owner can see or change their plan, and only for their own entries.
alter table public.lms_plans enable row level security;

drop policy if exists lms_plans_own on public.lms_plans;
create policy lms_plans_own on public.lms_plans
  for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.lms_entries e
      where e.id = entry_id and e.user_id = auth.uid() and e.game_id = lms_plans.game_id));

grant select, insert, update, delete on public.lms_plans to authenticated;

-- STEP 3 — Check: expect planner_table = true, owner_only = true.
select
  to_regclass('public.lms_plans') is not null as planner_table,
  exists (select 1 from pg_policies where tablename = 'lms_plans' and policyname = 'lms_plans_own') as owner_only;
