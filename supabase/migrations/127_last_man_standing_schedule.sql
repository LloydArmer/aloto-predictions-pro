-- 127_last_man_standing_schedule.sql
--
-- Runs the Last Man Standing job (sync-lms) every 10 minutes. Each run:
--   1. refreshes the fixtures, results and league tables of every league a game
--      is using (football or NFL) when it needs to,
--   2. moves players through or knocks them out once a gameweek has finished
--      and gives out the automatic picks at the deadline (lms_settle, from 126),
--   3. sends the "you're through / you're out / you've won" notifications and
--      the pick reminders (24 hours and 2 hours before the deadline).
--
-- It copies an existing job that calls one of this project's edge functions
-- (aloto-live-scores, sync-nfl-live or aloto-live-activity-push first, else
-- any job that calls an edge function), so it already holds the project's address and key, and
-- points the copy at sync-lms. The same file works on Dev and Prod with
-- nothing to fill in, and the key is never written in this file.

-- COST: sync-lms only calls API-Sports when a Last Man Standing game is
-- running, and then at most once every 20 minutes while a game it is waiting
-- on should have finished, plus once every 6 hours to catch rearranged
-- fixtures, and the league tables twice a day. The rest of the time a run only checks the database.
--
-- Deploy sync-lms BEFORE running this. Run on Dev first, then Prod.
-- Needs 126. Safe to run more than once: the old copy is replaced.

-- ---------------------------------------------------------------------------
-- STEP 1 — Remove an earlier copy, if any.
-- ---------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'aloto-lms';

-- ---------------------------------------------------------------------------
-- STEP 2 — Schedule sync-lms every 10 minutes, copied from an existing job.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'aloto-lms',
  '*/10 * * * *',
  regexp_replace(
    regexp_replace(command, '(/functions/v1/|\.functions\.supabase\.co/)[A-Za-z0-9_-]+', '\1sync-lms'),
    'timeout_milliseconds\s*:=\s*\d+', 'timeout_milliseconds:=10000'))
from (
  select command
  from cron.job
  where jobname <> 'aloto-lms'
    and command ~ '(/functions/v1/|\.functions\.supabase\.co/)[A-Za-z0-9_-]+'
  order by coalesce(array_position(array['aloto-live-scores', 'sync-nfl-live', 'aloto-live-activity-push'], jobname), 99), jobname
  limit 1
) j;

-- ---------------------------------------------------------------------------
-- STEP 3 — Check. aloto-lms should be listed, every 10 minutes, on, and its
-- command should mention sync-lms. If it is missing, tell Claude what the
-- list below shows.
-- ---------------------------------------------------------------------------
select jobname,
       schedule,
       case when active then 'on' else 'OFF' end as state,
       position('sync-lms' in command) > 0 as calls_sync_lms,
       left(regexp_replace(command, '(Bearer|apikey"?\s*:\s*"?)\s*[A-Za-z0-9._-]{20,}', '\1 [hidden]', 'gi'), 160) as command_start
from cron.job
order by jobname;
