-- 120_f1_live_schedule.sql
--
-- Runs the F1 feed (sync-f1) every minute, so race weekends update live:
-- qualifying order, race order and lap, then the result.
--
-- It copies the football live-scores job (aloto-live-scores), which already
-- holds this project's address and key, and points the copy at sync-f1. So
-- the same file works on Dev and Prod with nothing to fill in.
--
-- COST: sync-f1 only calls the F1 API while a race in a league is inside its
-- window (qualifying or race running). The rest of the week each run checks
-- the database and stops, using no API requests.
--
-- Deploy sync-f1 BEFORE running this. Run on Dev first, then Prod.
-- Needs 119. Safe to run more than once: the old copy is replaced.

-- ---------------------------------------------------------------------------
-- STEP 1 — Remove an earlier copy, if any.
-- ---------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'aloto-f1-live';

-- ---------------------------------------------------------------------------
-- STEP 2 — Schedule sync-f1 every minute, copied from the football job.
-- ---------------------------------------------------------------------------
select cron.schedule('aloto-f1-live', '* * * * *', replace(command, 'sync-football', 'sync-f1'))
from cron.job
where jobname = 'aloto-live-scores';

-- ---------------------------------------------------------------------------
-- STEP 3 — Check. aloto-f1-live should be listed, every minute, on, and its
-- command should mention sync-f1. If it is missing, the football job has a
-- different name: tell Claude what the list below shows.
-- ---------------------------------------------------------------------------
select jobname,
       schedule,
       case when active then 'on' else 'OFF' end as state,
       position('sync-f1' in command) > 0 as calls_sync_f1
from cron.job
order by jobname;
