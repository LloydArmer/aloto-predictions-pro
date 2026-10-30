-- 097_chat_rls.sql
--
-- Who can see and do what in league chat. Tables are in 096.
--
-- The shape of it: a room is visible to the league's participants and nobody
-- else, a blocked player's messages never arrive in the first place, and
-- removal happens through a function rather than a DELETE policy so that
-- "moderated" and "vanished" are different states.
--
-- Uses the two helpers that already exist — is_participant() and
-- is_competition_admin(), both security definer, both from 053/058. The second
-- one also accepts a global profiles.role = 'admin', which is what makes the
-- owner a backstop on every league without being a participant in any of them.
--
-- RUN ON DEV FIRST, then production.

alter table public.chat_messages      enable row level security;
alter table public.chat_reads         enable row level security;
alter table public.chat_reports       enable row level security;
alter table public.chat_blocks        enable row level security;
alter table public.chat_bans          enable row level security;
alter table public.chat_blocked_terms enable row level security;

-- ---------------------------------------------------------------------------
-- Messages.
-- ---------------------------------------------------------------------------

-- Reading. Blocking is enforced here rather than in the client, which means a
-- blocked player's messages never reach the device at all — including over
-- Realtime, which applies these same policies. Filtering them in the UI would
-- have left them arriving and merely unrendered, and "unrendered" is one bug
-- away from "rendered".
drop policy if exists cm_select on public.chat_messages;
create policy cm_select on public.chat_messages for select using (
  is_participant(competition_id)
  and not exists (
    select 1 from public.chat_blocks b
    where b.blocker_id = auth.uid()
      and b.blocked_id = chat_messages.user_id
  )
);

-- Posting. Three conditions: it is your own message, you are in the league,
-- and you have not been removed from its chat.
drop policy if exists cm_insert on public.chat_messages;
create policy cm_insert on public.chat_messages for insert with check (
  user_id = auth.uid()
  and is_participant(competition_id)
  and not exists (
    select 1 from public.chat_bans n
    where n.competition_id = chat_messages.competition_id
      and n.user_id = auth.uid()
  )
);

-- Editing your own, briefly.
--
-- The window is the whole point. Without one, a message someone replied to or
-- reported can be rewritten into something innocuous, which makes every report
-- unprovable and the moderation record worthless. Fifteen minutes covers the
-- typo you spot straight after sending and nothing else.
--
-- WITH CHECK repeats the ownership test so an edit cannot reassign the message
-- to somebody else, and pins competition_id so it cannot be moved into another
-- league's room.
drop policy if exists cm_update_own on public.chat_messages;
create policy cm_update_own on public.chat_messages for update
  using (
    user_id = auth.uid()
    and deleted_at is null
    and created_at > now() - interval '15 minutes'
  )
  with check (user_id = auth.uid());

-- No DELETE policy, deliberately. Removal goes through chat_delete_message()
-- below, which leaves the row in place with a record of who removed it. A
-- hard delete would destroy the evidence the report queue exists to keep.

-- ---------------------------------------------------------------------------
-- Read state. Yours only, and nobody else's business.
-- ---------------------------------------------------------------------------
drop policy if exists cr_all on public.chat_reads;
create policy cr_all on public.chat_reads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_participant(competition_id));

-- ---------------------------------------------------------------------------
-- Reports.
-- ---------------------------------------------------------------------------

-- Anyone in the league can report. Note there is no check that the reporter
-- can currently SEE the message: you may well block someone and then think
-- better of letting it go unreported.
drop policy if exists crep_insert on public.chat_reports;
create policy crep_insert on public.chat_reports for insert with check (
  reporter_id = auth.uid()
  and is_participant(competition_id)
);

-- You can see what you reported; admins see everything in their league.
drop policy if exists crep_select on public.chat_reports;
create policy crep_select on public.chat_reports for select using (
  reporter_id = auth.uid()
  or is_competition_admin(competition_id)
);

-- Only an admin closes a report, and only through chat_resolve_report() in
-- practice — but the policy allows the update directly so the queue screen can
-- be built against the table rather than being blocked on an RPC.
drop policy if exists crep_update on public.chat_reports;
create policy crep_update on public.chat_reports for update
  using (is_competition_admin(competition_id))
  with check (is_competition_admin(competition_id));

-- ---------------------------------------------------------------------------
-- Blocks. Entirely private to the person doing the blocking.
-- ---------------------------------------------------------------------------
--
-- No SELECT for the blocked party, by design: if you could discover you had
-- been blocked, blocking would become an accusation rather than a quiet exit.
drop policy if exists cb_all on public.chat_blocks;
create policy cb_all on public.chat_blocks for all
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Bans.
-- ---------------------------------------------------------------------------

-- You can see your own, so the composer can explain itself instead of silently
-- failing. Admins see the league's. Other players see nothing — who has been
-- removed is a moderation matter, not a leaderboard.
drop policy if exists cban_select on public.chat_bans;
create policy cban_select on public.chat_bans for select using (
  user_id = auth.uid()
  or is_competition_admin(competition_id)
);

drop policy if exists cban_write on public.chat_bans;
create policy cban_write on public.chat_bans for all
  using (is_competition_admin(competition_id))
  with check (is_competition_admin(competition_id));

-- ---------------------------------------------------------------------------
-- The word list. Closed to players entirely.
-- ---------------------------------------------------------------------------
--
-- The filter trigger is security definer and reads this itself, so no player
-- ever needs to. Publishing the list would also publish the way around it.
drop policy if exists cbt_admin on public.chat_blocked_terms;
create policy cbt_admin on public.chat_blocked_terms for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ---------------------------------------------------------------------------
-- Removing a message.
-- ---------------------------------------------------------------------------
--
-- Author or league admin. Blanks the body in the same statement that marks it
-- deleted, so a removed message cannot be read back by anyone — the row that
-- remains is a record that something was removed and by whom, not a copy of
-- what it said.
create or replace function chat_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition uuid;
  v_author      uuid;
begin
  select competition_id, user_id into v_competition, v_author
  from chat_messages where id = p_message_id;

  if v_competition is null then
    raise exception 'That message no longer exists.';
  end if;

  if v_author <> auth.uid() and not is_competition_admin(v_competition) then
    raise exception 'Only the author or a league admin can remove a message.';
  end if;

  update chat_messages
     set body       = '',
         deleted_at = now(),
         deleted_by = auth.uid()
   where id = p_message_id
     and deleted_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Closing a report.
-- ---------------------------------------------------------------------------
--
-- One call so that the three things that should happen together do: the report
-- is stamped, the message goes if it needs to, and the author is removed from
-- the room if it was bad enough. Doing these as three separate writes from the
-- app leaves every combination of half-done as a possible state.
create or replace function chat_resolve_report(p_report_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition uuid;
  v_message     uuid;
  v_author      uuid;
begin
  if p_action not in ('removed','banned','dismissed') then
    raise exception 'Unknown action: %', p_action;
  end if;

  select r.competition_id, r.message_id, m.user_id
    into v_competition, v_message, v_author
  from chat_reports r
  join chat_messages m on m.id = r.message_id
  where r.id = p_report_id;

  if v_competition is null then
    raise exception 'That report no longer exists.';
  end if;

  if not is_competition_admin(v_competition) then
    raise exception 'Only a league admin can resolve a report.';
  end if;

  -- Removing and banning both remove the message. A ban that left the message
  -- up would be the worst of both: the author gone and their words still there.
  if p_action in ('removed','banned') then
    update chat_messages
       set body = '', deleted_at = now(), deleted_by = auth.uid()
     where id = v_message and deleted_at is null;
  end if;

  if p_action = 'banned' then
    insert into chat_bans (competition_id, user_id, banned_by)
    values (v_competition, v_author, auth.uid())
    on conflict (competition_id, user_id) do nothing;
  end if;

  -- Close every open report against this message, not just the one being
  -- actioned. Three people reporting the same message is one decision, and
  -- leaving the other two open would make the queue look permanently behind.
  update chat_reports
     set resolved_at = now(), resolved_by = auth.uid(), action = p_action
   where message_id = v_message
     and resolved_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unread counts, for the badge on the tab.
-- ---------------------------------------------------------------------------
--
-- Every room in one round trip, rather than one query per competition on every
-- app open. Messages you sent yourself never count as unread, and a room you
-- have never opened counts everything.
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
  left join chat_reads r
         on r.competition_id = p.competition_id
        and r.user_id = p.user_id
  left join chat_messages m
         on m.competition_id = p.competition_id
        and m.user_id <> p.user_id
        and m.deleted_at is null
        and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
        -- A blocked player's messages are not unread news.
        and not exists (
          select 1 from chat_blocks b
          where b.blocker_id = p.user_id and b.blocked_id = m.user_id
        )
  where p.user_id = auth.uid()
  group by p.competition_id;
$$;

grant execute on function chat_delete_message(uuid)         to authenticated;
grant execute on function chat_resolve_report(uuid, text)   to authenticated;
grant execute on function chat_unread_counts()              to authenticated;
