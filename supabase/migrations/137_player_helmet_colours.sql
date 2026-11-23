-- 137: Player helmet colours for NFL and F1.
--
-- The lock screen card (and the helmet picker in Settings) shows NFL and F1
-- players as a helmet in their own colours with their initials on the side.
-- Football keeps using badge_kit and is not touched.
--
-- Format: '<shell>:<stripe>', e.g. '#6a4c93:#f4a72c'. Empty = standard colours.
-- The same colours are used for the NFL helmet and the F1 helmet.

alter table public.profiles
  add column if not exists helmet text;
