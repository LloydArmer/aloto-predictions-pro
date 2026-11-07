-- 115_app_review_demo_nfl.sql
--
-- Creates the "App Review Demo NFL" competition and puts both App Review
-- accounts in it, so Apple's reviewer can see the NFL side of 2.2.
--
-- Same pattern as 107 (the football demo): it does not create logins. The two
-- accounts already exist from 107:
--     appreview.admin@alotopredictionpro.co.uk   (admin of this competition)
--     appreview.player@alotopredictionpro.co.uk  (player)
--
-- Also switches chat on and adds a few chat messages from both accounts, so
-- the reviewer has someone else's message to report whichever account they
-- sign in with.
--
-- Run 114 first (NFL free season questions). 116 needs it.
--
-- Safe to run more than once.
--
-- RUN ON PRODUCTION. (Dev too if you want to rehearse it.)

do $$
declare
  v_admin  uuid;
  v_player uuid;
  v_comp   uuid;
begin
  select id into v_admin  from auth.users where email = 'appreview.admin@alotopredictionpro.co.uk';
  select id into v_player from auth.users where email = 'appreview.player@alotopredictionpro.co.uk';

  if v_admin is null or v_player is null then
    raise exception
      'Review accounts not found (admin found: %, player found: %). Run 107 first.',
      v_admin is not null, v_player is not null;
  end if;

  -- ── The competition ─────────────────────────────────────────────────────
  -- sport = 'nfl' makes the create_default_rules trigger give it NFL margin
  -- scoring (111/113), and the app show it under NFL in the sport chooser.
  select id into v_comp from competitions where name = 'App Review Demo NFL';

  if v_comp is null then
    insert into competitions (name, emoji, format, status, created_by, sport)
    values ('App Review Demo NFL', '🏈', 'league', 'active', v_admin, 'nfl')
    returning id into v_comp;
  end if;

  update competitions set chat_enabled = true, sport = 'nfl' where id = v_comp;

  insert into participants (competition_id, user_id, role) values
    (v_comp, v_admin,  'admin'),
    (v_comp, v_player, 'player')
  on conflict (competition_id, user_id) do update set role = excluded.role;

  -- ── Chat ────────────────────────────────────────────────────────────────
  if not exists (select 1 from chat_messages where competition_id = v_comp) then
    insert into chat_messages (competition_id, user_id, body, created_at) values
      (v_comp, v_admin,  'Welcome to the NFL league. Picks lock at each kick-off', now() - interval '9 days'),
      (v_comp, v_player, 'Chiefs by 3 every week until they let me down', now() - interval '9 days' + interval '20 minutes'),
      (v_comp, v_admin,  'Bold. I have got the Eagles going all the way', now() - interval '9 days' + interval '41 minutes'),
      (v_comp, v_player, 'Nailed the exact score in the Chiefs game. 22 points', now() - interval '2 days'),
      (v_comp, v_admin,  'Fair play. Next week''s picks are open, get them in', now() - interval '2 days' + interval '15 minutes');
  end if;

  raise notice 'App Review Demo NFL ready. Competition %, admin %, player %', v_comp, v_admin, v_player;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check. Every true/false column should read true, and messages should be 5.
-- ---------------------------------------------------------------------------
select
  c.name,
  c.sport = 'nfl'                                                                   as is_nfl,
  c.chat_enabled,
  (select r.scoring_mode = 'margin' from point_rules r where r.competition_id = c.id) as margin_scoring,
  (select count(*) from participants p where p.competition_id = c.id) = 2            as both_accounts_in,
  (select count(*) from chat_messages m where m.competition_id = c.id)               as messages,
  c.join_code
from competitions c
where c.name = 'App Review Demo NFL';
