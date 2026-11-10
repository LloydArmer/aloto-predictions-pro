-- 118_free_tier_one_league.sql
--
-- Free admins can run ONE league per sport (Lloyd, 10 Nov 2026).
--
-- The free plan was always meant to be: one league, one cup, one final league
-- table prediction. Migration 060 left leagues unlimited by mistake. This puts
-- the league limit in the database, next to the existing cup limit.
--
-- The limit is per sport: a free admin can run one football league AND one
-- NFL league. NFL is league only, so the NFL free plan is one league plus the
-- Super Bowl, AFC champion and NFC champion questions (114).
--
-- Pro (has_pro) removes the limit, as before.
--
-- EXISTING LEAGUES ARE UNTOUCHED. The trigger only runs when a competition is
-- created. A free admin who already runs two football leagues keeps both, but
-- cannot create a third until they have Pro.
--
-- RUN ON DEV FIRST, then Prod.

-- ---------------------------------------------------------------------------
-- STEP 1 — The limit check, replacing the version from 060.
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
begin
  if has_pro(new.created_by) then
    return new;
  end if;

  if new.format = 'league' then
    -- Counted in the sport being created, so a football league does not
    -- stop the same admin from running an NFL league.
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

-- The trigger from 060 already calls this function, so it picks up the new
-- version straight away. Re-created here so this file works on its own.
drop trigger if exists trg_competition_limit on competitions;
create trigger trg_competition_limit
before insert on competitions
for each row
execute function enforce_competition_limit();

-- ---------------------------------------------------------------------------
-- STEP 2 — Check. Free admins who already run more than one league in a sport.
-- They keep what they have; they just cannot add another without Pro.
-- No rows is fine.
-- ---------------------------------------------------------------------------
select
  pr.display_name,
  c.sport,
  count(*) as leagues
from competitions c
join profiles pr on pr.id = c.created_by
where c.format = 'league'
  and not has_pro(c.created_by)
group by pr.display_name, c.sport
having count(*) > 1
order by leagues desc, pr.display_name;
