-- 110_report_leagues.sql
--
-- Every competition set up on the app, one row each. Read-only.
--
-- Ordered so the busiest leagues come first, since those are the ones where
-- anything going wrong matters most.

select
  c.name,
  c.format,
  c.status,
  c.join_code,

  -- Who runs it. There can be more than one admin, so this is a list.
  (select string_agg(pr.display_name, ', ' order by pr.display_name)
     from participants pa
     join profiles pr on pr.id = pa.user_id
    where pa.competition_id = c.id and pa.role = 'admin')          as admins,

  (select count(*) from participants pa
    where pa.competition_id = c.id)                                as players,

  -- Everyone in it, so you can see at a glance who is where without a second
  -- query per league.
  (select string_agg(pr.display_name, ', ' order by pr.display_name)
     from participants pa
     join profiles pr on pr.id = pa.user_id
    where pa.competition_id = c.id)                                as squad,

  -- Chat, as of 106: off unless someone switched it on.
  c.chat_enabled,
  (select count(*) from chat_messages m
    where m.competition_id = c.id and m.deleted_at is null)        as messages,
  (select max(m.created_at) from chat_messages m
    where m.competition_id = c.id)                                 as last_message,
  (select count(*) from chat_reports r
    where r.competition_id = c.id and r.resolved_at is null)       as open_reports,

  c.created_at

from competitions c
order by
  (select count(*) from participants pa where pa.competition_id = c.id) desc,
  c.created_at desc;
