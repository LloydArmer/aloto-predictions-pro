-- 106_chat_enabled.sql
--
-- Chat becomes something an admin switches on, per competition, rather than
-- something every competition has.
--
-- THE PROBLEM. One room per competition sounded right until you count the
-- rooms. An admin running a league and two cups over the same fixtures has
-- three competitions containing the same twelve people — so three chats, each
-- getting a third of the conversation, and all three dying of it. A quiet chat
-- is worse than no chat: people open it, find nothing, and stop looking.
--
-- WHY NOT JUST RESTRICT IT TO LEAGUES. Because the format is not the boundary.
-- Someone can run three leagues as easily as three cups, and would have the
-- same problem; and a cup run on its own, with its own people, has every
-- reason to want a chat. There is no rule here that holds — only a choice,
-- which belongs to whoever runs the competition.
--
-- DEFAULT OFF, deliberately. A new competition starts with no chat and the
-- admin turns it on where they want one. Defaulting to on is how you end up
-- with the three dead rooms again, and it is the wrong default for
-- user-generated content besides: a room nobody asked for is a room nobody is
-- moderating.
--
-- RUN ON DEV FIRST, then production. Depends on 096 and 097.

alter table public.competitions
  add column if not exists chat_enabled boolean not null default false;

comment on column public.competitions.chat_enabled is
  'Whether this competition has a chat room. Off by default — the admin turns it on. See 106 for why it is not per-format.';

-- ---------------------------------------------------------------------------
-- Do not switch off a conversation that is already happening.
-- ---------------------------------------------------------------------------
--
-- Anything with a message in it was in use before this migration existed, and
-- having it go dark on deploy would be a change nobody asked for. Everything
-- else starts off, which is the new default.
update public.competitions c
   set chat_enabled = true
 where exists (select 1 from chat_messages m where m.competition_id = c.id);

-- ---------------------------------------------------------------------------
-- Is chat on here?
-- ---------------------------------------------------------------------------
--
-- Security definer, like is_participant() and is_competition_admin(), and for
-- the same reason. A policy that reads `competitions` directly is evaluated as
-- the signed-in user, so it inherits that table's own RLS and grants — and the
-- first version of this file did exactly that and failed with "permission
-- denied for table competitions". A policy must not depend on the reader
-- having rights to a table the policy is only consulting.
--
-- Named chat_is_enabled rather than chat_enabled so it cannot be confused with
-- the column: in Postgres, `chat_enabled(competition_id)` inside a policy can
-- be read as field selection on the row rather than a function call.
create or replace function chat_is_enabled(p_competition_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select c.chat_enabled from competitions c where c.id = p_competition_id),
    false);
$$;

grant execute on function chat_is_enabled(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The policies have to know about it, or the UI is the only thing stopping
-- anyone posting into a room that is supposed to be closed.
-- ---------------------------------------------------------------------------

-- Reading. A closed room's history stays readable to its participants: turning
-- chat off should not destroy what people said, and an admin who switches it
-- off by mistake has not lost anything.
--
-- Posting is a different matter, below.
drop policy if exists cm_select on public.chat_messages;
create policy cm_select on public.chat_messages for select using (
  is_participant(competition_id)
  and not exists (
    select 1 from public.chat_blocks b
    where b.blocker_id = auth.uid()
      and b.blocked_id = chat_messages.user_id
  )
);

-- Posting, now with the switch as a condition.
drop policy if exists cm_insert on public.chat_messages;
create policy cm_insert on public.chat_messages for insert with check (
  user_id = auth.uid()
  and is_participant(competition_id)
  and chat_is_enabled(competition_id)
  and not exists (
    select 1 from public.chat_bans n
    where n.competition_id = chat_messages.competition_id
      and n.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- The badge should not count a room nobody can post in.
-- ---------------------------------------------------------------------------
create or replace function chat_unread_counts()
returns table (competition_id uuid, unread bigint)
language sql
security definer
set search_path = public
stable
as $$
  select p.competition_id,
         count(m.id) as unread
  from participants p
  join competitions c
    on c.id = p.competition_id
   and c.chat_enabled
  left join chat_reads r
         on r.competition_id = p.competition_id
        and r.user_id = p.user_id
  left join chat_messages m
         on m.competition_id = p.competition_id
        and m.user_id <> p.user_id
        and m.deleted_at is null
        and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
        and not exists (
          select 1 from chat_blocks b
          where b.blocker_id = p.user_id and b.blocked_id = m.user_id
        )
  where p.user_id = auth.uid()
  group by p.competition_id;
$$;

-- ---------------------------------------------------------------------------
-- Check. Shows which competitions have chat on, and whether any of them got
-- there by already being in use.
-- ---------------------------------------------------------------------------
select
  c.name,
  c.chat_enabled,
  (select count(*) from chat_messages m where m.competition_id = c.id) as messages
from competitions c
order by c.chat_enabled desc, c.name;
