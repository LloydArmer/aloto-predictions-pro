-- 055_reveal_season_entries_when_locked.sql
--
-- Fixes "Nobody has answered this yet" without giving admins an early look.
--
-- The old policies revealed other people's entries only once
-- `deadline < now()`. Two problems:
--
--   1. A config with NO deadline could never satisfy that, so its entries were
--      invisible to everyone but their author, permanently, with no way out
--      short of editing the database.
--
--   2. There was no way to test the marking panel without waiting for a real
--      date to pass.
--
-- The fix is to reveal entries when the predictions are LOCKED, which is true
-- in either of two ways:
--
--   the deadline has passed, OR
--   the admin has unticked "Open for predictions"
--
-- That closes the dead end and makes testing a single click, while keeping the
-- rule that matters: nobody — admin included — sees anyone else's entries while
-- they can still be changed. An admin who plays in their own league gets no
-- advantage over anyone else.
--
-- RUN ON DEV FIRST.

-- ---------------------------------------------------------------------------
-- Individual Predictions answers
-- ---------------------------------------------------------------------------
drop policy if exists spa_read on season_pick_answers;

create policy spa_read on season_pick_answers for select using (
  -- your own, always
  user_id = auth.uid()

  -- everyone else in the competition, once entries are locked
  or exists (
    select 1 from season_picks p
    join season_pick_configs c on c.id = p.config_id
    where p.id = pick_id
      and is_participant(c.competition_id)
      and (
        (c.deadline is not null and c.deadline < now())
        or c.is_open = false
      )
  )
);

-- ---------------------------------------------------------------------------
-- Final league table predictions — same rule.
-- ---------------------------------------------------------------------------
drop policy if exists stp_read on season_table_predictions;

create policy stp_read on season_table_predictions for select using (
  user_id = auth.uid()

  or exists (
    select 1 from season_table_configs c
    where c.id = config_id
      and is_participant(c.competition_id)
      and (
        (c.deadline is not null and c.deadline < now())
        or c.is_open = false
      )
  )
);

-- ---------------------------------------------------------------------------
-- Check. Both should mention is_open, meaning the closed-for-entries route
-- exists and there is no longer a dead end for a config with no deadline.
-- ---------------------------------------------------------------------------
select
  tablename,
  policyname,
  case when qual::text like '%is_open%' then 'ok — revealed when locked'
       else 'NOT UPDATED — policy did not change' end as status
from pg_policies
where tablename in ('season_pick_answers', 'season_table_predictions')
  and cmd = 'SELECT'
order by tablename;

-- ---------------------------------------------------------------------------
-- To test the marking panel: untick "Open for predictions" on the section in
-- Admin. Entries become visible immediately. Tick it again to reopen — though
-- in a real season you would simply let the deadline pass.
-- ---------------------------------------------------------------------------
