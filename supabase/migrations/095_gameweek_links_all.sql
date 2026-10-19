-- READ-ONLY. Changes nothing. One result set. Run in Production.
--
-- Replaces 094, which came back empty. That query filtered on a competition
-- name and joined two sets that both turned out to be empty, so "no rows" told
-- us nothing — it could equally have meant the name didn't match, or that
-- there are no links at all. A diagnostic that can return nothing is a bad
-- diagnostic. This one returns a row for every competition, whatever the data
-- looks like.
--
-- THE QUESTION: the dashboard's prediction list and the group stage card read
-- different tables, and they disagree about which gameweek it is.
--
--   highest_linked       the gameweek the PREDICTION LIST shows. It comes from
--                        competition_gameweeks, the table saying which
--                        gameweeks a competition uses.
--
--   highest_group_gw     the gameweek the GROUP STAGE card shows. It comes
--                        from group_fixtures, where each round records the
--                        gameweek it was played in.
--
-- If those two differ for the Champions League, that is the whole bug: a round
-- was assigned a gameweek without the competition being linked to it, because
-- assigning a round writes group_fixtures.gameweek_id and nothing else.
--
-- If they MATCH, the data is fine and the fault is in the dashboard's code.
-- Either way this settles it.

select c.name                                                  as competition,
       c.format,

       (select count(*)
          from competition_gameweeks cg
         where cg.competition_id = c.id)                        as linked_count,

       (select max(g.number)
          from competition_gameweeks cg
          join gameweeks g on g.id = cg.gameweek_id
         where cg.competition_id = c.id)                        as highest_linked,

       (select count(*)
          from group_fixtures gf
         where gf.competition_id = c.id
           and gf.gameweek_id is not null)                      as group_rounds_dated,

       (select max(g.number)
          from group_fixtures gf
          join gameweeks g on g.id = gf.gameweek_id
         where gf.competition_id = c.id)                        as highest_group_gw,

       (select max(g.number)
          from bracket_matches bm
          join gameweeks g on g.id = bm.gameweek_id
         where bm.competition_id = c.id)                        as highest_bracket_gw

from competitions c
order by c.name;
