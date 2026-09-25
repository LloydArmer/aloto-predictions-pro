-- 055: A question is at most 80 characters, and cannot be blank.
--
-- Admins can now write their own questions, which is text one person writes
-- and eleven others read. A length cap is the cheapest sensible limit on that,
-- and having it in the database rather than only in the form is what makes it
-- true. It is also the kind of thing Apple looks for in an app where one
-- person's typed text is shown to others.
--
-- If this fails with a check-constraint error, an existing question is longer
-- than 80 characters. Nothing will have changed; shorten it and run again.

alter table public.season_picks
  add constraint season_picks_label_length
  check (char_length(btrim(label)) between 1 and 80);
