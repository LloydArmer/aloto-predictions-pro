-- Lets a competition accept the feed's full-time score as the confirmed one.
--
-- Until now every result has been typed in by an admin. The feed's score sits
-- in the live_* columns and is treated as provisional on purpose: a feed can
-- be wrong, delayed, or still reporting a match that was abandoned, and a
-- wrong score that quietly rewrites the table is worse than a slow one.
--
-- With this on, a fixture whose feed status says the match is over has its
-- live score copied into the confirmed one, and the fixture is marked
-- completed — exactly what the admin would have typed, without the typing.
--
-- OFF BY DEFAULT, and deliberately so. Turning it on is a decision about
-- whether you trust the feed more than you trust yourself, and that is the
-- organiser's call, per competition, not ours.
--
-- What it does NOT do: mark the gameweek completed or recalculate anyone's
-- points. That remains a deliberate act, because it is the moment provisional
-- scores become official and people's league positions change. Auto-finalise
-- removes the tedious part — entering twelve results — not the judgement.
--
-- An admin can still correct any score afterwards, exactly as before.

alter table public.competitions
  add column if not exists auto_finalise_scores boolean not null default false;

comment on column public.competitions.auto_finalise_scores is
  'When true, a full-time score from the football feed becomes the confirmed score without an admin entering it. Does not complete the gameweek or recalculate points.';
