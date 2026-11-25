-- =============================================================================
-- 139 — Add every player from one competition to another, in one tap.
--
-- Admin → Players → "Add players from another competition" (Brittany,
-- 25 Nov 2026): a cup made for the people already in the league no longer
-- needs everyone to enter a join code again.
--
-- add_players_from_competition(target, source, users) puts the chosen players
-- of `source` (or all of them when `users` is left out) into `target` as
-- players. Anyone already in `target` is left as they are.
-- Only an admin of BOTH competitions can do it.
-- Returns {"ok": true, "added": n} or {"ok": false, "error": "..."}.
--
-- Run on Dev, then Prod. Safe to run more than once.
-- =============================================================================

drop function if exists public.add_players_from_competition(uuid, uuid);

create or replace function public.add_players_from_competition(p_target uuid, p_source uuid, p_user_ids uuid[] default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_added int;
begin
  if p_target = p_source then
    return json_build_object('ok', false, 'error', 'same_competition');
  end if;
  if not is_competition_admin(p_target) or not is_competition_admin(p_source) then
    return json_build_object('ok', false, 'error', 'not_admin');
  end if;

  insert into participants (competition_id, user_id, role)
  select p_target, p.user_id, 'player'
  from participants p
  where p.competition_id = p_source
    and (p_user_ids is null or p.user_id = any(p_user_ids))
    and not exists (select 1 from participants x where x.competition_id = p_target and x.user_id = p.user_id);
  get diagnostics v_added = row_count;

  return json_build_object('ok', true, 'added', v_added);
end;
$$;

grant execute on function public.add_players_from_competition(uuid, uuid, uuid[]) to authenticated;

-- CHECK: the function exists (expect 1).
select count(*) as functions_found from pg_proc where proname = 'add_players_from_competition';
