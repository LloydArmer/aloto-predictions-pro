-- =============================================================================
-- 134 — Last Man Standing: the admin can put a player in the game.
--
-- lms_admin_add_entry(game, player): the competition admin gives a player in
-- the competition an entry (approved straight away), until the first
-- kick-off. Works whatever version of the app the player has. Up to 10
-- entries per player.
--
-- Run on Dev, then Prod. Needs 126. Safe to run more than once.
-- =============================================================================

-- STEP 0 — 126 must already be in place.
do $$
begin
  if to_regclass('public.lms_entries') is null then
    raise exception 'Run 126_last_man_standing.sql on this project first, then this file.';
  end if;
end $$;

-- STEP 1 — The approval flag from 133 (added here too, so this works without it).
alter table public.lms_entries add column if not exists approved boolean not null default true;

-- STEP 2 — Admin adds an entry for a player.
create or replace function public.lms_admin_add_entry(p_game_id uuid, p_user_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  g lms_games;
  v_no int;
  v_id uuid;
begin
  select * into g from lms_games where id = p_game_id;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_competition_admin(g.competition_id) then return json_build_object('ok', false, 'error', 'not_admin'); end if;
  if not exists (select 1 from participants where competition_id = g.competition_id and user_id = p_user_id) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  if g.status <> 'open' or coalesce(lms_round_lock(g.sport, g.league_id, g.season, g.start_round), 'infinity') <= now() then
    return json_build_object('ok', false, 'error', 'entries_closed');
  end if;
  if (select count(*) from lms_entries where game_id = g.id and user_id = p_user_id) >= 10 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_no from lms_entries where game_id = g.id and user_id = p_user_id;
  insert into lms_entries (game_id, user_id, entry_no, stake, approved)
  values (g.id, p_user_id, v_no, g.entry_points, true)
  returning id into v_id;

  return json_build_object('ok', true, 'entry_id', v_id, 'entry_no', v_no);
end;
$$;

revoke execute on function public.lms_admin_add_entry(uuid, uuid) from public, anon;
grant execute on function public.lms_admin_add_entry(uuid, uuid) to authenticated;

-- STEP 3 — Check: expect admin_add = true.
select to_regprocedure('public.lms_admin_add_entry(uuid, uuid)') is not null as admin_add;
