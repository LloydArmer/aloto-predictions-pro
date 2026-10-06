-- READ-ONLY. Changes nothing. One result set. Run in Production.
--
-- Season predictions attached to a competition that is NOT a league.
--
-- These pre-date the rule that stopped them being created, so nothing in the
-- app can reach them any more: the admin Season tab refuses to open for a cup,
-- and the player tab is about to stop showing one. They are orphaned rather
-- than harmful, but worth deciding about.
--
-- "entries saved" is what would be lost if they were deleted. If it is 0 on
-- every row, removing them costs nothing at all.
--
-- Nothing returned means there are none and there is nothing to do.

select c.name                                    as competition,
       c.format,
       'final table'                             as prediction_type,
       (select count(*) from season_table_predictions p
         where p.config_id = t.id)               as entries_saved
from season_table_configs t
join competitions c on c.id = t.competition_id
where c.format is distinct from 'league'

union all

select c.name,
       c.format,
       'individual picks',
       (select count(*)
          from season_pick_answers a
          join season_picks sp on sp.id = a.pick_id
         where sp.config_id = pc.id)
from season_pick_configs pc
join competitions c on c.id = pc.competition_id
where c.format is distinct from 'league'

order by competition, prediction_type;
