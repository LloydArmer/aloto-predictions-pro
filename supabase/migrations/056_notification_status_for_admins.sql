-- 056_notification_status_for_admins.sql
--
-- Lets a competition admin see who will actually receive reminders.
--
-- Two separate things have to be true for a reminder to arrive, and they fail
-- differently:
--
--   profiles.notify_push    the participant hasn't muted reminders
--   a push_tokens row       a device is actually registered
--
-- The second is the one that catches people out. Someone can have the toggle
-- showing on and still receive nothing, because they never granted the browser
-- permission or they're on an iPhone that isn't installed to the Home Screen.
-- An admin chasing missed deadlines needs to see that difference.
--
-- Done as a function rather than a policy on push_tokens, because a push token
-- is a sending credential — anyone holding one and the FCM key can push to that
-- device. This returns counts and never the tokens themselves.
--
-- RUN ON DEV FIRST.

create or replace function competition_notification_status(p_competition_id uuid)
returns table (
  user_id       uuid,
  display_name  text,
  notify_push   boolean,
  device_count  bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pr.id,
    pr.display_name,
    coalesce(pr.notify_push, true),
    (select count(*) from push_tokens t where t.user_id = pr.id)
  from participants pa
  join profiles pr on pr.id = pa.user_id
  where pa.competition_id = p_competition_id
    -- The admin check lives inside the function: security definer bypasses RLS,
    -- so without this any participant could call it for any competition.
    and is_competition_admin(p_competition_id)
  order by pr.display_name;
$$;

grant execute on function competition_notification_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Check. Run as yourself against a competition you administer — you should see
-- a row per participant. device_count of 0 with notify_push true is the case
-- worth knowing about: they think they're signed up and they aren't.
-- ---------------------------------------------------------------------------
select proname, pronargs
from pg_proc
where proname = 'competition_notification_status';
