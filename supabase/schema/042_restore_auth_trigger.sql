-- 042_restore_auth_trigger.sql
--
-- RUN ON THE DEV PROJECT. Production already has all of this.
--
-- `supabase db dump` captures the public schema. This trigger lives on
-- auth.users, which is outside it, so it did not come across in the baseline —
-- which is why signing up on dev created an auth account but no profiles row,
-- and why `update profiles set role = 'admin'` matched nothing.
--
-- Anything else attached to auth.* will have the same problem. This is the only
-- one this app has.

-- ---------------------------------------------------------------------------
-- STEP 1 — Recreate the function and trigger.
--
-- Copied from 001_initial_schema.sql so dev matches production exactly.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure handle_new_user();

-- ---------------------------------------------------------------------------
-- STEP 2 — Backfill accounts created before the trigger existed.
--
-- The trigger only fires on new sign-ups, so any account already made through
-- the dashboard has no profile row. This creates one for each, using the same
-- naming rule the trigger uses.
-- ---------------------------------------------------------------------------
insert into profiles (id, display_name, email)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
  u.email
from auth.users u
left join profiles p on p.id = u.id
where p.id is null;

-- ---------------------------------------------------------------------------
-- STEP 3 — Make yourself admin.
--
-- Every profile on dev, because it is your test database and you are the only
-- real person in it. Never run this on production.
-- ---------------------------------------------------------------------------
update profiles set role = 'admin';

-- ---------------------------------------------------------------------------
-- STEP 4 — Confirm. You should see a row per account, each with role = admin.
-- ---------------------------------------------------------------------------
select id, display_name, email, role from profiles;
