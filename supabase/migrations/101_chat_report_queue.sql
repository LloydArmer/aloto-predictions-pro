-- 101_chat_report_queue.sql
--
-- What an admin needs in order to action a report, which turns out to be two
-- things the schema could not give them.
--
-- FIRST: an admin cannot necessarily read the message they are being asked to
-- judge. The read policy hides messages from anyone the reader has blocked —
-- correctly, for ordinary reading — but an admin who blocked a player and is
-- then handed a report about them would see an empty row. The person most
-- likely to have blocked someone is the person most likely to be moderating
-- them, so this is not an edge case.
--
-- SECOND: removing a message blanks its body, on purpose, so nobody can read
-- it back. That also erases the evidence from the queue, leaving a resolved
-- report that no longer says what it was about — which is precisely what you
-- want to still have if anyone ever asks how a complaint was handled.
--
-- So: the report keeps its own copy of the message as it stood when it was
-- reported, and the queue is read through a function that answers to
-- is_competition_admin() rather than to the reading policy.
--
-- RUN ON DEV FIRST, then production. Depends on 096 and 097.

-- ---------------------------------------------------------------------------
-- The evidence, kept with the report.
-- ---------------------------------------------------------------------------
alter table public.chat_reports
  add column if not exists message_snapshot text;

comment on column public.chat_reports.message_snapshot is
  'The message exactly as it read when it was reported. Survives removal, which blanks the message itself — this is the record of what was complained about.';

-- Filled server-side rather than sent by the client, which would let a
-- reporter write their own version of what somebody said.
create or replace function chat_snapshot_reported_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select body into new.message_snapshot
  from chat_messages where id = new.message_id;
  return new;
end;
$$;

drop trigger if exists trg_chat_report_snapshot on public.chat_reports;
create trigger trg_chat_report_snapshot
  before insert on public.chat_reports
  for each row execute function chat_snapshot_reported_message();

-- ---------------------------------------------------------------------------
-- The queue.
-- ---------------------------------------------------------------------------
--
-- Security definer, with the admin check in the WHERE clause rather than
-- around it: a non-admin asking for someone else's queue gets no rows, not an
-- error, and no information either way.
--
-- Oldest first. The report closest to running out of time is the one that
-- should be at the top, and "newest first" would bury exactly the one that
-- matters.
create or replace function chat_report_queue(
  p_competition_id   uuid,
  p_include_resolved boolean default false
)
returns table (
  report_id        uuid,
  reason           text,
  note             text,
  reported_at      timestamptz,
  resolved_at      timestamptz,
  action           text,
  reporter_id      uuid,
  reporter_name    text,
  message_id       uuid,
  message_snapshot text,
  message_live     boolean,
  author_id        uuid,
  author_name      text,
  author_banned    boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.reason,
    r.note,
    r.created_at,
    r.resolved_at,
    r.action,
    r.reporter_id,
    coalesce(rp.display_name, 'Someone'),
    m.id,
    -- Falls back to the live body for any report written before this column
    -- existed. Those have no snapshot and never will.
    coalesce(r.message_snapshot, m.body),
    m.deleted_at is null,
    m.user_id,
    coalesce(ap.display_name, 'Someone'),
    exists (
      select 1 from chat_bans b
      where b.competition_id = r.competition_id and b.user_id = m.user_id
    )
  from chat_reports r
  join chat_messages m on m.id = r.message_id
  left join profiles rp on rp.id = r.reporter_id
  left join profiles ap on ap.id = m.user_id
  where r.competition_id = p_competition_id
    and is_competition_admin(p_competition_id)
    and (p_include_resolved or r.resolved_at is null)
  order by r.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Who is barred, so an admin can let them back in.
-- ---------------------------------------------------------------------------
create or replace function chat_banned_players(p_competition_id uuid)
returns table (
  user_id      uuid,
  display_name text,
  banned_at    timestamptz,
  banned_by    uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select b.user_id, coalesce(p.display_name, 'Someone'), b.created_at, b.banned_by
  from chat_bans b
  left join profiles p on p.id = b.user_id
  where b.competition_id = p_competition_id
    and is_competition_admin(p_competition_id)
  order by b.created_at desc;
$$;

grant execute on function chat_report_queue(uuid, boolean) to authenticated;
grant execute on function chat_banned_players(uuid)        to authenticated;

-- ---------------------------------------------------------------------------
-- Check. Both should return 0 on a database where nothing has been reported,
-- and must not error.
-- ---------------------------------------------------------------------------
-- Across every competition, so it does not depend on which one comes first.
select
  (select count(*) from competitions c, lateral chat_report_queue(c.id, true)) as reports_visible_to_you,
  (select count(*) from competitions c, lateral chat_banned_players(c.id))     as banned_players;
