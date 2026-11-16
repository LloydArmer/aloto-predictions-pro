-- "Confirm results automatically" for every competition, football, NFL and
-- F1, and for every competition created from now on (16 Nov 2026).
-- Then fills in any finished result from the last 14 days that the feeds
-- already have but nobody confirmed. It only fills BLANK results: a score
-- an admin has entered is never changed. Gameweeks are not marked completed;
-- that, and the points, stay the admin's call.

-- 1. Every competition, now and in future.
update competitions
set auto_finalise_scores = true
where auto_finalise_scores is distinct from true;

alter table competitions
  alter column auto_finalise_scores set default true;

-- 2. Finished games and matches the feeds already have, still unconfirmed.
--    Football: FT, AET, PEN. NFL: FT, AOT (overtime included).
update fixtures
set home_score = live_home_score,
    away_score = live_away_score,
    status     = 'completed'
where home_score is null
  and status <> 'void'
  and live_home_score is not null
  and live_away_score is not null
  and live_status in ('FT', 'AET', 'PEN', 'AOT')
  and kickoff_time > now() - interval '14 days';

-- 3. Check: every competition should say true.
select sport, name, auto_finalise_scores
from competitions
order by sport, name;
