-- Remembers where each Live Activity's owner stood at the last push.
--
-- The lock screen shows an arrow — up two places, down one — and the phone has
-- no memory of what it was showing a minute ago. The only place that can work
-- out the movement is here, by comparing the position now against the one that
-- was last successfully sent.
--
-- Written only when a push actually lands. If one fails, the phone is still
-- displaying the old position and the next arrow has to be measured from that,
-- not from a figure nobody ever saw.
--
-- Null means nothing has been sent yet, which is why the first push of a
-- gameweek shows a position with no arrow rather than a spurious climb.

alter table public.live_activity_tokens
  add column if not exists last_position int;

comment on column public.live_activity_tokens.last_position is
  'Position last successfully pushed to this activity. Null before the first push.';
