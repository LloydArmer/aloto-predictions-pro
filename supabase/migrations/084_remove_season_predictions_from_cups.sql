-- Removes season predictions attached to a competition that is NOT a league.
--
-- These pre-date the rule that stopped them being created. Nothing in the app
-- can reach them any more — the admin Season tab refuses to open for a cup and
-- the player tab no longer appears — so they would sit there for good.
--
-- Scoped to non-league competitions ONLY. A league's season predictions are
-- untouched, whatever state they are in.
--
-- One statement, so it is all-or-nothing: if anything fails, nothing is
-- removed. It reports what it deleted.
--
-- Deleting a config takes its teams, questions, options, answers and saved
-- entries with it. Check 083 first and be content with the "entries saved"
-- numbers, because this cannot be undone.

with dead_tables as (
  delete from season_table_configs t
  using competitions c
  where c.id = t.competition_id
    and c.format is distinct from 'league'
  returning t.id
),
dead_picks as (
  delete from season_pick_configs pc
  using competitions c
  where c.id = pc.competition_id
    and c.format is distinct from 'league'
  returning pc.id
),
dead_scores as (
  -- Season points calculated for a cup have nowhere to go either.
  delete from season_scores s
  using competitions c
  where c.id = s.competition_id
    and c.format is distinct from 'league'
  returning s.id
)
select
  (select count(*) from dead_tables) as final_tables_removed,
  (select count(*) from dead_picks)  as question_sets_removed,
  (select count(*) from dead_scores) as score_rows_removed;
