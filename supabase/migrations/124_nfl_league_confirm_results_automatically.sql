-- Switches on "Confirm results automatically" for the ALOTO NFL 26-27 league,
-- so each game's final score (after overtime) is confirmed by the feed.
-- The admin screen had no switch for this on NFL leagues (16 Nov 2026).
update competitions
set auto_finalise_scores = true
where name = 'ALOTO NFL 26-27'
  and sport = 'nfl';

-- Should show one row, with auto_finalise_scores = true.
select name, sport, auto_finalise_scores
from competitions
where sport = 'nfl'
order by name;
