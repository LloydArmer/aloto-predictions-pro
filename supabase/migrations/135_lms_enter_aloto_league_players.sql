-- =============================================================================
-- 135 — One-off: put every player in "ALOTO Predictions League 26/27" into
-- the open game of "ALOTO LMS" (one approved entry each).
--
-- Adds them to the ALOTO LMS competition if they are not in it yet, then
-- gives anyone without an entry in the open game one entry, approved.
-- Players who already have an entry are left as they are.
--
-- Run on Prod (and Dev if you want the same there). Safe to run more than once.
-- =============================================================================

do $$
declare
  v_league uuid;
  v_lms    uuid;
  v_game   public.lms_games;
  v_n      int;
begin
  select count(*) into v_n from competitions where name ilike 'ALOTO Predictions League 26/27';
  if v_n <> 1 then raise exception 'Expected one competition named ALOTO Predictions League 26/27, found %', v_n; end if;
  select id into v_league from competitions where name ilike 'ALOTO Predictions League 26/27';

  select count(*) into v_n from competitions where name ilike 'ALOTO LMS' and format = 'last_man_standing';
  if v_n <> 1 then raise exception 'Expected one Last Man Standing named ALOTO LMS, found %', v_n; end if;
  select id into v_lms from competitions where name ilike 'ALOTO LMS' and format = 'last_man_standing';

  select * into v_game from lms_games where competition_id = v_lms and status = 'open';
  if v_game.id is null then raise exception 'ALOTO LMS has no game taking entries'; end if;
  if lms_round_lock(v_game.sport, v_game.league_id, v_game.season, v_game.start_round) <= now() then
    raise exception 'ALOTO LMS game has already kicked off';
  end if;

  -- The approval flag (from 133/134), in case neither has been run here.
  alter table public.lms_entries add column if not exists approved boolean not null default true;

  -- 1. Into the competition.
  insert into participants (competition_id, user_id, role)
  select v_lms, p.user_id, 'player'
  from participants p
  where p.competition_id = v_league
    and not exists (select 1 from participants x where x.competition_id = v_lms and x.user_id = p.user_id);

  -- 2. One approved entry each in the open game, for anyone without one.
  execute format($q$
    insert into lms_entries (game_id, user_id, entry_no, stake, approved)
    select %L, p.user_id, 1, %s, true
    from participants p
    where p.competition_id = %L
      and not exists (select 1 from lms_entries e where e.game_id = %L and e.user_id = p.user_id)
  $q$, v_game.id, v_game.entry_points, v_lms, v_game.id);

  -- Entries waiting for approval from these players: approve them.
  update lms_entries set approved = true
  where game_id = v_game.id and not approved
    and user_id in (select user_id from participants where competition_id = v_league);
end $$;

-- Check: everyone in the open ALOTO LMS game, with their entries.
select pr.display_name, count(e.id) as entries, bool_and(e.approved) as approved
from lms_games g
join competitions c on c.id = g.competition_id and c.name ilike 'ALOTO LMS'
join lms_entries e on e.game_id = g.id
join profiles pr on pr.id = e.user_id
where g.status = 'open'
group by pr.display_name
order by pr.display_name;
