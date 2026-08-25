-- 059_reset_push_devices.sql
--
-- Clears a participant's registered push devices so they can register again
-- cleanly. Safe on either environment.
--
-- Use when someone shows more devices than they own, or reminders arrive
-- erratically. That usually means two token rows point at the same phone: one
-- dead, one alive, so some reminders land and some don't.
--
-- It happens when the browser's user_agent string changes between
-- registrations — an iOS update, or registering once in Safari and again from
-- the Home Screen app. The app's automatic dedupe matches on that string, so
-- it can't spot these.
--
-- Deleting a token is harmless: it stops that device receiving reminders until
-- the participant switches them on again, and nothing else references it.

-- ---------------------------------------------------------------------------
-- STEP 1 — Look first. Replace the name with theirs, exactly as it appears in
-- the app.
-- ---------------------------------------------------------------------------
select
  pr.display_name,
  t.platform,
  left(coalesce(t.user_agent, '(none)'), 60) as device,
  t.created_at,
  t.last_seen_at
from push_tokens t
join profiles pr on pr.id = t.user_id
where pr.display_name = 'REPLACE WITH THEIR NAME'
order by t.created_at;

-- Two rows with slightly different device strings for one real phone is the
-- case this file is for. Two genuinely different devices — a phone and a
-- laptop — are correct and should be left alone.

-- ---------------------------------------------------------------------------
-- STEP 2 — Clear them. Same name again.
-- ---------------------------------------------------------------------------
delete from push_tokens
where user_id = (select id from profiles where display_name = 'REPLACE WITH THEIR NAME');

-- ---------------------------------------------------------------------------
-- STEP 3 — Make sure they aren't left muted.
--
-- The app sets notify_push to false when the last device is removed, so
-- clearing tokens can leave them muted without them having chosen it. This
-- puts it back.
-- ---------------------------------------------------------------------------
update profiles
set notify_push = true
where display_name = 'REPLACE WITH THEIR NAME';

-- ---------------------------------------------------------------------------
-- STEP 4 — Confirm: no rows.
-- ---------------------------------------------------------------------------
select count(*) as devices_remaining
from push_tokens t
join profiles pr on pr.id = t.user_id
where pr.display_name = 'REPLACE WITH THEIR NAME';

-- ---------------------------------------------------------------------------
-- STEP 5 — They re-register. This part can't be done from here: only their
-- browser can issue a push token.
--
--   iPhone   Delete the ALOTO icon from the Home Screen. Open the site in
--            Safari, Share -> Add to Home Screen, open it from the new icon,
--            then Settings -> tick Push notifications -> Allow.
--
--   Android  Open the app, Settings, untick Push notifications, tick it again,
--            Allow.
--
-- The Home Screen removal matters on iPhone: the installed app caches its
-- service worker hard, and a stale one is a common cause of erratic delivery.
--
-- Then re-run STEP 1 — exactly one row should appear.
-- ---------------------------------------------------------------------------
