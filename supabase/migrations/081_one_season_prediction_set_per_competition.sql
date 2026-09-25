-- 054: One final league table, and one set of individual predictions, per
-- competition.
--
-- This is already how the app behaves — the admin screen only offers the setup
-- when none exists — but nothing in the database enforced it, so a second row
-- could appear and the screen reads them with .maybeSingle(), which errors on
-- more than one. That would take the whole Season tab down rather than degrade.
--
-- If either index fails to create with a duplicate-key error, a second row
-- already exists for some competition. Nothing will have changed; send me the
-- message and I will give you a file to find it.

create unique index if not exists season_table_configs_one_per_competition
  on public.season_table_configs (competition_id);

create unique index if not exists season_pick_configs_one_per_competition
  on public.season_pick_configs (competition_id);
