-- 096_chat_schema.sql
--
-- League chat: the tables. No policies here — those are 097.
--
-- One room per competition. Not per gameweek, not direct messages: a league
-- is already the group people think in, and `participants` already answers
-- "who is in it" and "who runs it", so the whole membership question is
-- answered by tables that exist.
--
-- Everything else in this file exists because the App Store requires it.
-- Guideline 1.2 will not accept user-generated content without a way to
-- filter it, report it, block its author, and have someone act within a day.
-- Those are not polish to add later — an app that ships chat without them is
-- rejected, so they are part of the schema from the first migration.
--
-- RUN ON DEV FIRST, then production.

-- ---------------------------------------------------------------------------
-- The messages themselves.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id              uuid primary key default uuid_generate_v4(),
  competition_id  uuid not null references competitions(id) on delete cascade,
  user_id         uuid not null references profiles(id)     on delete cascade,

  body            text not null,

  -- Who this is a reply to. ON DELETE SET NULL rather than CASCADE: deleting
  -- an abusive message must not silently take the replies to it with it —
  -- those replies are often the evidence that someone objected.
  reply_to_id     uuid references chat_messages(id) on delete set null,

  -- Who was @mentioned, resolved by the client at send time.
  --
  -- Stored rather than parsed out of the body later because display names
  -- change: "@Michael JNR" in a message from August must still notify the
  -- right person after he renames himself, and a name match cannot do that.
  -- It also keeps the notification job from re-parsing every message body.
  mentions        uuid[] not null default '{}',

  created_at      timestamptz not null default now(),
  edited_at       timestamptz,

  -- Soft delete. The row survives moderation so there is a record of what was
  -- removed and by whom; chat_delete_message() blanks the body at the same
  -- time, so a removed message cannot be read back by anyone.
  deleted_at      timestamptz,
  deleted_by      uuid references profiles(id),

  -- A live message has content; a removed one has had it blanked.
  --
  -- Written as one constraint across both columns rather than a length check
  -- on body alone. The length check came first and was wrong: it forbade the
  -- empty string, which is exactly what chat_delete_message() writes, so the
  -- first attempt to moderate anything failed on the constraint. The two
  -- states only make sense described together.
  --
  -- Trimmed length, so twenty spaces is not a message. The 2000 ceiling is
  -- about what a phone can render without the list stuttering, not storage.
  constraint chat_messages_body_shape check (
    case when deleted_at is null
         then char_length(btrim(body)) between 1 and 2000
         else body = ''
    end
  )
);

-- The only read pattern that matters: one room, newest last, excluding nothing
-- at the database level. Partial on deleted_at because a removed message is
-- still fetched (to draw the "removed" line) but never sorted separately.
create index if not exists idx_chat_msgs_room
  on public.chat_messages (competition_id, created_at desc);

-- For the unread badge, which asks "anything after this timestamp?"
create index if not exists idx_chat_msgs_room_created
  on public.chat_messages (competition_id, created_at);

-- The notification job looks up "messages mentioning me".
create index if not exists idx_chat_msgs_mentions
  on public.chat_messages using gin (mentions);

comment on table public.chat_messages is
  'League chat. One room per competition. Soft-deleted by chat_delete_message(), never hard-deleted, so moderation leaves a record.';

-- ---------------------------------------------------------------------------
-- Read state, for the unread badge on the tab.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_reads (
  competition_id  uuid not null references competitions(id) on delete cascade,
  user_id         uuid not null references profiles(id)     on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (competition_id, user_id)
);

comment on table public.chat_reads is
  'Last time each player opened each room. Drives the unread count; carries no history.';

-- ---------------------------------------------------------------------------
-- Reports.
-- ---------------------------------------------------------------------------
--
-- competition_id is denormalised rather than joined through the message on
-- purpose. An admin needs to list the reports for their own league, and the
-- message a report points at may be one this admin cannot read — it could be
-- from someone they have blocked. Joining through it would hide exactly the
-- reports that most need looking at.
--
-- resolved_at is the column that matters for the 24-hour commitment: anything
-- with a null in it is still owed an answer.
create table if not exists public.chat_reports (
  id              uuid primary key default uuid_generate_v4(),
  message_id      uuid not null references chat_messages(id) on delete cascade,
  competition_id  uuid not null references competitions(id)  on delete cascade,
  reporter_id     uuid not null references profiles(id)      on delete cascade,

  reason          text not null check (reason in ('abuse','harassment','spam','sexual','other')),
  note            text check (note is null or char_length(note) <= 500),

  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references profiles(id),
  action          text check (action in ('removed','banned','dismissed')),

  -- One report per person per message. Reporting twice is not a stronger
  -- signal, and without this a single upset player can bury the queue.
  unique (message_id, reporter_id)
);

-- The queue an admin opens: unresolved first, oldest first, because the clock
-- on the oldest one is the one closest to running out.
create index if not exists idx_chat_reports_open
  on public.chat_reports (competition_id, created_at)
  where resolved_at is null;

comment on table public.chat_reports is
  'Reported messages and what was done about them. A row with resolved_at null is still owed a response — Apple expects that within 24 hours.';

-- ---------------------------------------------------------------------------
-- Blocks.
-- ---------------------------------------------------------------------------
--
-- Account-wide, not per competition. Apple asks for the ability to block an
-- abusive user "from the service", and someone who harasses you in one league
-- is not someone you want to meet in another. It is also one-directional and
-- invisible: the blocked player is never told, which is what keeps blocking
-- from escalating a row rather than ending it.
create table if not exists public.chat_blocks (
  blocker_id  uuid not null references profiles(id) on delete cascade,
  blocked_id  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint chat_blocks_not_self check (blocker_id <> blocked_id)
);

comment on table public.chat_blocks is
  'Account-wide, one-directional mute. The blocked player sees no change; their messages simply stop arriving for the blocker.';

-- ---------------------------------------------------------------------------
-- Bans: removed from one league's chat by its admin.
-- ---------------------------------------------------------------------------
--
-- Deliberately separate from `participants`. Removing someone from the chat
-- must not remove them from the competition — they keep predicting, keep their
-- points, keep their place in the table. Folding this into participants would
-- make the mildest moderation action also the harshest.
create table if not exists public.chat_bans (
  competition_id  uuid not null references competitions(id) on delete cascade,
  user_id         uuid not null references profiles(id)     on delete cascade,
  banned_by       uuid references profiles(id),
  reason          text check (reason is null or char_length(reason) <= 500),
  created_at      timestamptz not null default now(),
  primary key (competition_id, user_id)
);

comment on table public.chat_bans is
  'Barred from one league''s chat. Does not affect predictions, points or standings.';

-- ---------------------------------------------------------------------------
-- The word list the filter checks against. Populated in 098.
-- ---------------------------------------------------------------------------
--
-- A table rather than a constant in the app, because the list will need
-- changing and a release takes a week of review. Adding a term here takes
-- effect on the next message.
create table if not exists public.chat_blocked_terms (
  term        text primary key check (char_length(btrim(term)) between 2 and 80),
  added_by    uuid references profiles(id),
  created_at  timestamptz not null default now()
);

comment on table public.chat_blocked_terms is
  'Terms the filter rejects at insert. Editable without an App Store release, which is the point of it being a table.';
