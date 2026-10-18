-- Halves the delay between a goal and your lock screen.
--
-- Two jobs run in sequence: one fetches live scores from the football feed,
-- the other pushes them to the Live Activities. Both have been running every
-- two minutes, so in the worst case a goal waited two minutes to reach the
-- database and another two to reach the phone — four minutes behind the match.
--
-- At one minute each that worst case becomes two.
--
-- Below one minute is not possible here: a minute is the scheduler's floor.
-- Genuine real time is not available at any price on a polled feed; the score
-- only exists in our database as often as we ask for it.
--
-- WHAT IT COSTS: the live sync spends one API request per run, and only when
-- a linked fixture is actually in play — it returns without spending anything
-- when nothing is on. A six-hour Saturday is therefore about 360 requests
-- rather than 180. The Pro plan allows 7,500 a day, so this is roughly 5% of
-- it on the busiest day of the week.
--
-- Changes the timing only. Nothing about what the jobs do is touched.

do $$
declare
  r record;
begin
  for r in
    select jobid, jobname
    from cron.job
    where jobname in ('aloto-live-scores', 'aloto-live-activity-push')
  loop
    perform cron.alter_job(job_id => r.jobid, schedule => '* * * * *');
  end loop;
end $$;

-- What the schedule looks like now. The two above should read '* * * * *';
-- anything else listed here is a different job and is left alone.
select jobname,
       schedule,
       case when active then 'on' else 'OFF' end as state
from cron.job
order by jobname;
