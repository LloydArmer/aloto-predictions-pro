-- 107_app_review_demo.sql
--
-- Sets up the two accounts Apple's reviewer signs in with, and a competition
-- for them to test chat in.
--
-- WHY A SEPARATE COMPETITION. The reviewer's job is to post something
-- objectionable, report it, and check it disappears. If they do that in one of
-- your real leagues, your actual players watch it happen. This gives them a
-- room of their own.
--
-- WHAT IT DOES NOT DO: create the logins. Those are made by signing up through
-- the app, because inventing a row in auth.users means hand-rolling a password
-- hash and a matching identities row, which is undocumented and changes
-- between releases. A reviewer who cannot sign in is the worst failure
-- available here, so that part goes through the front door.
--
-- BEFORE RUNNING THIS, sign up both accounts in the app:
--     appreview.admin@alotopredictionpro.co.uk
--     appreview.player@alotopredictionpro.co.uk
-- Any passwords. They do not need to be real mailboxes — this file confirms
-- them, so an unread confirmation email does not matter.
--
-- Safe to run more than once.
--
-- RUN ON PRODUCTION. (Dev too if you want to rehearse it, but the reviewer
-- only ever sees production.)

do $$
declare
  v_admin  uuid;
  v_player uuid;
  v_comp   uuid;
begin
  -- ── The two accounts ────────────────────────────────────────────────────
  select id into v_admin  from auth.users where email = 'appreview.admin@alotopredictionpro.co.uk';
  select id into v_player from auth.users where email = 'appreview.player@alotopredictionpro.co.uk';

  if v_admin is null or v_player is null then
    raise exception
      'Sign up both accounts in the app first: appreview.admin@... and appreview.player@... (admin found: %, player found: %)',
      v_admin is not null, v_player is not null;
  end if;

  -- Confirm them, so an unread confirmation email cannot stop the reviewer
  -- signing in. One column on two existing rows — nothing is being invented.
  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now())
   where id in (v_admin, v_player);

  -- Names the reviewer will see, set here rather than depending on what got
  -- typed into the sign-up form.
  update profiles set display_name = 'Review Admin'  where id = v_admin;
  update profiles set display_name = 'Review Player' where id = v_player;

  -- They have already agreed to the house rules. The gate is still there to be
  -- seen — it is part of what Apple is checking — but it must not be the thing
  -- standing between a reviewer and the report button they came to test.
  update profiles
     set chat_rules_accepted_at = coalesce(chat_rules_accepted_at, now())
   where id in (v_admin, v_player);

  -- ── The competition ─────────────────────────────────────────────────────
  select id into v_comp from competitions where name = 'App Review Demo';

  if v_comp is null then
    insert into competitions (name, format, status, created_by)
    values ('App Review Demo', 'league', 'active', v_admin)
    returning id into v_comp;
  end if;

  update competitions set chat_enabled = true where id = v_comp;

  insert into participants (competition_id, user_id, role) values
    (v_comp, v_admin,  'admin'),
    (v_comp, v_player, 'player')
  on conflict (competition_id, user_id) do update set role = excluded.role;

  -- ── Something to report ─────────────────────────────────────────────────
  --
  -- Deliberately dull, and deliberately from both of them: a reviewer signed
  -- in as either account needs somebody else's message in front of them,
  -- because you cannot report or block yourself.
  --
  -- Timestamps are backdated so the room looks lived-in rather than created
  -- ninety seconds ago.
  if not exists (select 1 from chat_messages where competition_id = v_comp) then
    insert into chat_messages (competition_id, user_id, body, created_at) values
      (v_comp, v_admin,  'Right, who fancies their chances this week then', now() - interval '2 days'),
      (v_comp, v_player, 'Going for the draw at Anfield, feels like one of those', now() - interval '2 days' + interval '14 minutes'),
      (v_comp, v_admin,  'Brave. I have got them winning comfortably', now() - interval '2 days' + interval '31 minutes'),
      (v_comp, v_player, 'We will see. Did you watch the midweek game?', now() - interval '1 day'),
      (v_comp, v_admin,  'Caught the second half. Thought the keeper was at fault for both', now() - interval '1 day' + interval '8 minutes'),
      (v_comp, v_player, 'Harsh. No chance with the first one', now() - interval '1 day' + interval '22 minutes'),
      (v_comp, v_admin,  'Agree to disagree. Predictions in before Saturday please', now() - interval '3 hours');
  end if;

  raise notice 'App Review Demo ready. Competition %, admin %, player %', v_comp, v_admin, v_player;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check. Every column should read true, and messages should be 7.
-- ---------------------------------------------------------------------------
select
  c.name,
  c.chat_enabled,
  (select count(*) from participants p where p.competition_id = c.id) = 2            as both_accounts_in,
  (select count(*) from chat_messages m where m.competition_id = c.id)               as messages,
  (select bool_and(u.email_confirmed_at is not null) from auth.users u
    where u.email in ('appreview.admin@alotopredictionpro.co.uk',
                      'appreview.player@alotopredictionpro.co.uk'))                  as both_confirmed,
  (select bool_and(p.chat_rules_accepted_at is not null) from profiles p
    join auth.users u on u.id = p.id
   where u.email like 'appreview.%@alotopredictionpro.co.uk')                        as rules_accepted
from competitions c
where c.name = 'App Review Demo';
