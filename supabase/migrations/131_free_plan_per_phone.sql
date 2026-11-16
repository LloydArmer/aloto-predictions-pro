-- 131_free_plan_per_phone.sql
--
-- The free plan's competition limits apply PER PHONE, not per account, in
-- every sport (Brittany, 16 Nov 2026): Football, NFL, F1 and Last Man
-- Standing. Making new accounts with other email addresses on the same phone
-- no longer gives more free competitions.
--
-- The limits themselves are unchanged (118 and 126):
--   * one league per sport,
--   * one cup (Knockout or Group + Knockout),
--   * one Last Man Standing.
-- What changes is whose competitions are counted: the account creating it,
-- plus every account that has been signed in on the same phone (recorded by
-- the app from version 2.4, see 130). Accounts with no phone recorded keep
-- the per-account limit, exactly as now.
--
-- Needs 130. Safe to run more than once. RUN ON DEV FIRST, then Prod.

-- ---------------------------------------------------------------------------
-- STEP 1 — The accounts that share a phone with an account (itself included).
-- ---------------------------------------------------------------------------
create or replace function public.phone_accounts(p_user_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select p_user_id
  union
  select d2.user_id
  from public.user_devices d1
  join public.user_devices d2 on d2.device_id = d1.device_id
  where d1.user_id = p_user_id;
$$;

revoke execute on function public.phone_accounts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 2 — The free-plan check on new competitions, counted per phone.
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
  lms_count    int;
begin
  if has_pro(new.created_by) then
    return new;
  end if;

  if new.format = 'league' then
    select count(*) into league_count
    from competitions
    where created_by in (select phone_accounts(new.created_by))
      and format = 'league'
      and sport = coalesce(new.sport, 'football');

    if league_count >= 1 then
      raise exception 'FREE_TIER_LEAGUE_LIMIT';
    end if;

    return new;
  end if;

  if new.format = 'last_man_standing' then
    select count(*) into lms_count
    from competitions
    where created_by in (select phone_accounts(new.created_by))
      and format = 'last_man_standing';

    if lms_count >= 1 then
      raise exception 'FREE_TIER_LMS_LIMIT';
    end if;

    return new;
  end if;

  select count(*) into cup_count
  from competitions
  where created_by in (select phone_accounts(new.created_by))
    and format in ('knockout','group_knockout');

  if cup_count >= 1 then
    raise exception 'FREE_TIER_CUP_LIMIT';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_competition_limit on competitions;
create trigger trg_competition_limit
before insert on competitions
for each row
execute function enforce_competition_limit();

-- ---------------------------------------------------------------------------
-- STEP 3 — Check. Should show per_phone = true.
-- ---------------------------------------------------------------------------
select position('phone_accounts' in pg_get_functiondef('public.enforce_competition_limit()'::regprocedure)) > 0 as per_phone;
