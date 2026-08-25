-- 060_pro_entitlements.sql
--
-- The Pro unlock, and the free tier limits it removes.
--
-- Decisions this encodes, and why:
--
-- The ADMIN pays, not participants. If every participant had to pay, one
-- person's decision to add a cup would impose a cost on nineteen others — half
-- wouldn't pay, and you'd have a competition most of the league couldn't see.
-- One transaction from the person who wanted it is easier to collect and
-- earns more.
--
-- ONE unlock, not several. Two products means two purchases, two entitlement
-- checks and two things to support, and people resist a second charge far more
-- than a slightly higher first one.
--
-- FREE TIER: unlimited Leagues, one Cup, one Final League Table.
-- Leagues stay unlimited because they're the core product — someone running one
-- league for their mates should never hit a wall, or they won't stay long
-- enough to want more.
--
-- Nothing here charges anyone yet. Limits are enforced; the purchase flow comes
-- with RevenueCat. Existing competitions are unaffected — see step 4.
--
-- RUN ON DEV FIRST.

-- ---------------------------------------------------------------------------
-- STEP 1 — Who has Pro.
--
-- Keyed to the USER, not the competition: store purchases attach to an Apple
-- or Google account, and an admin who pays should get it across everything
-- they run rather than one competition at a time.
-- ---------------------------------------------------------------------------
create table if not exists pro_entitlements (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references profiles(id) on delete cascade,
  -- 'purchase'  a verified store transaction
  -- 'granted'   given by you — your own leagues, a comp, an apology
  source       text not null default 'purchase' check (source in ('purchase','granted')),
  -- Null means it never expires. A yearly subscription sets this and
  -- RevenueCat pushes the new date on renewal.
  expires_at   timestamptz,
  store        text,                        -- 'apple' | 'google' | null when granted
  notes        text,
  created_at   timestamptz not null default now(),
  unique (user_id)
);

alter table pro_entitlements enable row level security;

-- Readable by its owner so the app can show their status. Writable only by the
-- service role — the purchase webhook — because a policy letting users write
-- their own row would let anyone grant themselves Pro.
drop policy if exists pro_read on pro_entitlements;
create policy pro_read on pro_entitlements for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- STEP 2 — Does this user have Pro?
-- ---------------------------------------------------------------------------
create or replace function has_pro(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from pro_entitlements
    where user_id = p_user_id
      and (expires_at is null or expires_at > now())
  );
$$;

grant execute on function has_pro(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 3 — Enforce the limits in the database.
--
-- The app will also check, so it can explain the limit rather than just fail —
-- but a UI check alone is bypassable through the API, and "pay us" is exactly
-- the kind of rule people try to route around.
-- ---------------------------------------------------------------------------
create or replace function enforce_competition_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cup_count int;
begin
  -- Leagues are unlimited on the free tier.
  if new.format = 'league' then
    return new;
  end if;

  if has_pro(new.created_by) then
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

drop trigger if exists trg_competition_limit on competitions;
create trigger trg_competition_limit
before insert on competitions
for each row
execute function enforce_competition_limit();

create or replace function enforce_season_table_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id    uuid;
  table_count int;
begin
  select created_by into owner_id from competitions where id = new.competition_id;

  if has_pro(owner_id) then
    return new;
  end if;

  -- Counted across everything this admin runs, not per competition — otherwise
  -- the limit is avoided by making another competition.
  select count(*) into table_count
  from season_table_configs stc
  join competitions c on c.id = stc.competition_id
  where c.created_by = owner_id;

  if table_count >= 1 then
    raise exception 'FREE_TIER_TABLE_LIMIT';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_season_table_limit on season_table_configs;
create trigger trg_season_table_limit
before insert on season_table_configs
for each row
execute function enforce_season_table_limit();

-- ---------------------------------------------------------------------------
-- STEP 4 — Grandfather everyone already over the limit.
--
-- Anyone who has built more than the free tier allows keeps it. Taking working
-- competitions away from people to sell them back is not a way to launch a paid
-- tier, and the triggers only fire on INSERT so existing rows are safe anyway —
-- but without this they'd be blocked from creating anything new.
-- ---------------------------------------------------------------------------
insert into pro_entitlements (user_id, source, notes)
select distinct c.created_by, 'granted', 'Grandfathered — over the free limit before Pro existed'
from competitions c
where c.created_by is not null
  and c.format in ('knockout','group_knockout')
group by c.created_by
having count(*) > 1
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- STEP 5 — Grant yourself Pro, permanently.
--
-- REPLACE the name with yours, exactly as it appears in the app. To find it:
--
--     select display_name, email from profiles order by display_name;
--
-- The row it creates stores your USER ID, so changing your display name later
-- won't revoke it. But re-running this file after a name change would fail to
-- match you, so if you ever rename yourself, come back and update this line.
-- ---------------------------------------------------------------------------
insert into pro_entitlements (user_id, source, notes)
select id, 'granted', 'Owner'
from profiles
where display_name = 'lloyd.armer'
on conflict (user_id) do update
  set source = 'granted', expires_at = null, notes = 'Owner';

-- ---------------------------------------------------------------------------
-- STEP 6 — Check.
-- ---------------------------------------------------------------------------
select
  pr.display_name,
  pe.source,
  coalesce(pe.expires_at::text, 'never expires') as expires,
  pe.notes
from pro_entitlements pe
join profiles pr on pr.id = pe.user_id
order by pr.display_name;

-- You should appear with source 'granted'. If STEP 5 returned nothing, the name
-- didn't match — check it against: select display_name from profiles;
