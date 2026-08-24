-- 058_fix_competition_admin_check.sql
--
-- Fixes the empty Reminders panel in Admin -> Players.
--
-- Two different definitions of "admin" had drifted apart:
--
--   the APP    profiles.role = 'admin'  — global, and what gates the Admin
--                                        panel and every tab inside it
--   my checks  a participants row for THAT competition with role = 'admin'
--
-- So an app admin looking at a competition they aren't flagged as admin of —
-- or aren't a participant of at all — was shown the panel and then handed no
-- rows. The panel looked broken rather than restricted.
--
-- is_competition_admin now accepts either. That's the honest reading: someone
-- with profiles.role = 'admin' already has the whole Admin panel, so refusing
-- them one read-only list wasn't protecting anything.
--
-- This also fixes the season prediction policies, which use the same function —
-- a global admin who wasn't a participant-admin couldn't edit a season config
-- either, and would have hit the same dead end later.
--
-- RUN ON DEV FIRST, then production.

create or replace function is_competition_admin(p_competition_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    -- Admin of this specific competition
    exists (
      select 1 from participants
      where competition_id = p_competition_id
        and user_id = auth.uid()
        and role = 'admin'
    )
    -- ...or a global admin, which is what the app itself checks
    or exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    );
$$;

-- ---------------------------------------------------------------------------
-- Check. Run as yourself against a competition where the panel was empty —
-- replace the id, or leave it and read the first row.
-- ---------------------------------------------------------------------------
select
  c.name                                as competition,
  is_competition_admin(c.id)            as you_are_admin,
  (select count(*) from competition_notification_status(c.id)) as rows_returned
from competitions c
order by c.created_at;

-- you_are_admin should be true and rows_returned should match the number of
-- participants. If rows_returned is 0 while you_are_admin is true, the
-- competition genuinely has no participants yet.
