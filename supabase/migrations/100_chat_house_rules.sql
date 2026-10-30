-- 100_chat_house_rules.sql
--
-- Records that someone has accepted the chat house rules.
--
-- This is the fourth of Apple's requirements, and the one easiest to dismiss
-- as a formality: there must be terms that prohibit objectionable content and
-- abusive behaviour, and users must have agreed to them. A reviewer looks for
-- the moment of agreement, so it has to be a thing a person does once, before
-- their first message, not a line of small print in Settings.
--
-- A timestamp rather than a boolean, so that changing the rules later is a
-- matter of comparing dates rather than clearing a flag for every account.
--
-- RUN ON DEV FIRST, then production.

alter table public.profiles
  add column if not exists chat_rules_accepted_at timestamptz;

comment on column public.profiles.chat_rules_accepted_at is
  'When this player accepted the chat house rules. Null means they have not, and the composer stays closed until they do.';

-- The existing profiles_update policy already allows a player to update their
-- own row, which is all this needs — no new policy.

-- ---------------------------------------------------------------------------
-- Check. Should return one row describing the new column.
-- ---------------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name  = 'chat_rules_accepted_at';
