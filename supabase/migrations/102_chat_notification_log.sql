-- 102_chat_notification_log.sql
--
-- Stops a chat notification being sent twice.
--
-- The notify-chat function is driven by a database webhook, and a webhook that
-- does not get a clean response is retried. Without a record of what has
-- already gone out, a slow APNs call or a cold start would send the same "X
-- mentioned you" two or three times — which is worse than not sending it, and
-- is exactly the complaint that led to the reminder dedupe in the first place.
--
-- Same shape as notification_log, for the same reason: the unique constraint
-- IS the guard. The function inserts before it sends and treats a conflict as
-- "somebody already did this", so the check and the claim are one statement
-- and two overlapping retries cannot both win.
--
-- RUN ON DEV FIRST, then production. Depends on 096.

create table if not exists public.chat_notification_log (
  message_id  uuid not null references chat_messages(id) on delete cascade,
  user_id     uuid not null references profiles(id)      on delete cascade,
  kind        text not null check (kind in ('chat_mention','chat_reply')),
  sent_at     timestamptz not null default now(),
  primary key (message_id, user_id)
);

comment on table public.chat_notification_log is
  'One row per person per message notified. The primary key is the duplicate guard — the function inserts before sending and a conflict means someone else already has.';

-- Only the service role writes here, and only the function reads it. No policy
-- is granted to players, so RLS with no policies is exactly right: enabled,
-- and closed to everyone the service role is not.
alter table public.chat_notification_log enable row level security;

-- ---------------------------------------------------------------------------
-- Housekeeping.
-- ---------------------------------------------------------------------------
--
-- The log only has to outlive the webhook's retry window, which is minutes.
-- Keeping a week is generous and makes it useful for answering "did that
-- notification actually go out?" without it growing without limit.
create index if not exists idx_chat_notif_sent on public.chat_notification_log (sent_at);

-- ---------------------------------------------------------------------------
-- Check. Should return the table with zero rows.
-- ---------------------------------------------------------------------------
select count(*) as rows_so_far from public.chat_notification_log;
