-- 052_gameweek_bonus_overrides.sql
--
-- Lets a gameweek carry its own full house bonuses, overriding the
-- competition's normal rules.
--
-- The case that prompted this: an end-of-season gameweek with all 10 fixtures
-- on at once. Getting 10 from 10 is far harder than the usual 6, so the bonus
-- should be bigger — but only for that gameweek, without disturbing the rules
-- every other gameweek is scored under.
--
-- Both columns are nullable and BOTH are consulted independently: a gameweek
-- can raise the all-scores bonus while leaving all-results alone. Null means
-- "use the competition's rule", so every existing gameweek is unaffected.
--
-- RUN ON DEV FIRST.

alter table gameweeks add column if not exists full_house_results_bonus int;
alter table gameweeks add column if not exists full_house_scores_bonus  int;

comment on column gameweeks.full_house_results_bonus is
  'Overrides point_rules.full_house_results_bonus for this gameweek only. Null = use the competition rule.';
comment on column gameweeks.full_house_scores_bonus is
  'Overrides point_rules.full_house_scores_bonus for this gameweek only. Null = use the competition rule.';

-- ---------------------------------------------------------------------------
-- Check. Existing gameweeks should all show null for both — meaning nothing
-- about how they score has changed.
-- ---------------------------------------------------------------------------
select
  number,
  status,
  coalesce(full_house_results_bonus::text, '(competition rule)') as results_bonus,
  coalesce(full_house_scores_bonus::text,  '(competition rule)') as scores_bonus
from gameweeks
order by number;
