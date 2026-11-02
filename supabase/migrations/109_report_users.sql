-- 109_report_users.sql
--
-- Everyone registered on the app, one row each. Read-only.
--
-- Newest first, because the question is almost always "who signed up recently"
-- rather than "who signed up in March".

select
  p.display_name,
  u.email,
  p.role                                                   as app_role,
  u.email_confirmed_at is not null                         as confirmed,
  u.last_sign_in_at,
  u.created_at                                             as registered,

  -- How many competitions they play in, and which. The list is what makes
  -- this useful: a user in nothing is either a drop-off or a stuck invite.
  (select count(*) from participants pa where pa.user_id = p.id)   as competitions,
  (select string_agg(c.name, ', ' order by c.name)
     from participants pa
     join competitions c on c.id = pa.competition_id
    where pa.user_id = p.id)                                       as plays_in,
  (select string_agg(c.name, ', ' order by c.name)
     from participants pa
     join competitions c on c.id = pa.competition_id
    where pa.user_id = p.id and pa.role = 'admin')                 as runs,

  -- Can a reminder actually reach them? A user with no device gets nothing,
  -- however carefully the reminder job is set up.
  (select count(*) from push_tokens t where t.user_id = p.id)      as devices,
  (select string_agg(distinct t.platform, ', ')
     from push_tokens t where t.user_id = p.id)                    as platforms,
  coalesce(p.notify_push, false)                                   as push_on,

  -- Chat house rules: null means they have never opened a chat.
  p.chat_rules_accepted_at is not null                             as accepted_chat_rules

from profiles p
join auth.users u on u.id = p.id
order by u.created_at desc;
