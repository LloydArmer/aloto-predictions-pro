-- READ-ONLY. Changes nothing. One result set. Run in Production.
--
-- Why the dashboard's prediction list and the group stage card disagree about
-- which gameweek it is.
--
-- They read different tables:
--
--   The GROUP STAGE card reads group_fixtures, which carries the gameweek a
--   round was played in. That is how it knows round 11 was GW11.
--
--   The PREDICTIONS list reads competition_gameweeks — the table that says
--   which gameweeks a competition uses — and shows the highest one there.
--
-- Assigning a gameweek to a group round writes group_fixtures.gameweek_id and
-- nothing else, so the two can drift apart: the competition plays a round in
-- GW11 while competition_gameweeks has never heard of GW11.
--
-- HOW TO READ IT:
--
--   linked = "yes"  the dashboard can see this gameweek
--   linked = "NO"   a round was played in it, but the competition is not
--                   linked to it — this is the drift, and the highest "yes"
--                   row is the gameweek the prediction list is stuck on
--
-- Nothing returned at all means the competition name below didn't match.

with comp as (
  select id, name from competitions
  where name ilike '%Champions League%'
  order by created_at
  limit 1
),
linked as (
  select g.id, g.number, g.status
  from competition_gameweeks cg
  join gameweeks g on g.id = cg.gameweek_id
  where cg.competition_id = (select id from comp)
),
used as (
  select g.id, g.number, g.status, min(gf.round_number) as round
  from group_fixtures gf
  join gameweeks g on g.id = gf.gameweek_id
  where gf.competition_id = (select id from comp)
  group by g.id, g.number, g.status
)
select (select name from comp)                       as competition,
       coalesce(l.number, u.number)                  as gameweek,
       coalesce(l.status, u.status)                  as gameweek_status,
       case when l.id is not null
            then 'yes'
            else 'NO - the dashboard cannot see this one'
       end                                           as linked,
       u.round                                       as played_group_round
from linked l
full outer join used u on u.id = l.id
order by coalesce(l.number, u.number) desc;
