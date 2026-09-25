-- 053: Individual season predictions can only be set up by an admin with Pro.
--
-- Enforced in the database as well as on screen. The screen is the courteous
-- half — it shows an upgrade card instead of the setup — but anything talking
-- to the database directly would walk straight past it, so the rule lives
-- here too, the same way the free-tier cup limit already works.
--
-- The check is on CREATING a set, not on managing one. An admin whose
-- subscription lapses keeps the questions they already run, so their players
-- still get marked and scored; they simply cannot start a new set. Locking a
-- lapsed admin out of marking would punish the twelve people who paid nothing
-- and did nothing wrong.
--
-- The FINAL LEAGUE TABLE is untouched and stays free for everyone.
--
-- has_pro() covers a purchased subscription and a permanent owner grant alike:
-- a grant has no expiry date, and the function reads "no expiry" as never
-- expiring rather than as already expired.

create or replace function public.season_picks_require_pro()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Whether the COMPETITION'S ADMIN has Pro, not whoever happens to be signed
  -- in. The admin is the person who pays under this pricing, so theirs is the
  -- plan that decides. With more than one admin, any one of them holding Pro
  -- is enough.
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

drop trigger if exists season_pick_configs_require_pro on public.season_pick_configs;

create trigger season_pick_configs_require_pro
  before insert on public.season_pick_configs
  for each row execute function public.season_picks_require_pro();
