-- 108_check_review_accounts.sql
--
-- Read-only. Answers why 107 said it could not find the review accounts.
--
-- Three possibilities, and this tells you which:
--   the sign-ups have not been done        → no rows at all
--   they went in under different addresses → you will see them here
--   they exist but are unconfirmed         → confirmed shows false, which 107
--                                            fixes by itself
--
-- Changes nothing. Safe to run on either environment.

-- ---------------------------------------------------------------------------
-- 1. The two addresses 107 looks for, and whether each exists.
-- ---------------------------------------------------------------------------
select
  wanted.email,
  u.id is not null                  as account_exists,
  u.email_confirmed_at is not null  as confirmed,
  p.display_name
from (values
  ('appreview.admin@alotopredictionpro.co.uk'),
  ('appreview.player@alotopredictionpro.co.uk')
) as wanted(email)
left join auth.users u on lower(u.email) = wanted.email
left join profiles   p on p.id = u.id;

-- ---------------------------------------------------------------------------
-- 2. The ten most recent accounts, so you can see what addresses actually got
--    created if the sign-ups went in under something else.
-- ---------------------------------------------------------------------------
select
  u.email,
  p.display_name,
  u.email_confirmed_at is not null as confirmed,
  u.created_at
from auth.users u
left join profiles p on p.id = u.id
order by u.created_at desc
limit 10;
