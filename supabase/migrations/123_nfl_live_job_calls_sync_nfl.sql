-- The NFL live job (sync-nfl-live) was calling send-invite instead of
-- sync-nfl, so no NFL live score was ever fetched (found 16 Nov 2026).
-- This points it at sync-nfl and gives the call 10 seconds instead of 1.
-- It changes nothing else in the job: the key already in it is kept as it is,
-- and it is not written in this file.

select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'sync-nfl-live'),
  command := replace(
               replace((select command from cron.job where jobname = 'sync-nfl-live'),
                       '/functions/v1/send-invite', '/functions/v1/sync-nfl'),
               'timeout_milliseconds:=1000', 'timeout_milliseconds:=10000')
);

-- Every scheduled job and which function it calls. sync-nfl-live should now
-- say sync-nfl. Keys are not shown.
select jobname,
       schedule,
       case when active then 'on' else 'OFF' end as state,
       substring(command from 'functions/v1/[A-Za-z0-9_-]+') as calls
from cron.job
order by jobname;
