-- =============================================================================
-- 138 — Every cup tie a player has in a gameweek.
--
-- A player can be in a Knockout cup AND a Group + Knockout competition that
-- are both scored from the same gameweek. my_gameweek_opponent gives only one
-- of those ties. These two functions give all of them, so the Dashboard and
-- the Lock Screen live card can show every tie (Brittany, 23 Nov 2026).
--
--   my_gameweek_ties(gameweek)            for the signed-in player (the app)
--   my_gameweek_ties_for(user, gameweek)  for the server (push-live-activity)
--
-- Byes (no opponent) are left out. Read only. Run on Dev, then Prod.
-- Safe to run more than once.
-- =============================================================================

create or replace function public.my_gameweek_ties_for(p_user_id uuid, p_gameweek_id uuid)
returns table (
  kind text, match_id uuid, competition_id uuid, competition_name text,
  round_label text, opponent_id uuid, opponent_name text, opponent_kit text
)
language sql stable security definer set search_path = public as $$
  select * from (
    -- Knockout ties: the gameweek is on the match, or set for its round.
    select 'knockout'::text, b.id, b.competition_id, c.name::text,
           (case b.round
              when 'playoff' then 'Playoff'       when 'r64' then 'Round of 64'
              when 'r32'     then 'Round of 32'   when 'r16' then 'Round of 16'
              when 'qf'      then 'Quarter-final' when 'sf'  then 'Semi-final'
              when 'f'       then 'Final'         else b.round end)::text,
           o.id, o.display_name::text, o.badge_kit::text
    from bracket_matches b
    join competitions c on c.id = b.competition_id
    join profiles o on o.id = case when b.home_user_id = p_user_id then b.away_user_id else b.home_user_id end
    where (b.home_user_id = p_user_id or b.away_user_id = p_user_id)
      and coalesce(b.gameweek_id,
            (select g.gameweek_id from bracket_round_gameweeks g
              where g.competition_id = b.competition_id and g.round = b.round limit 1)) = p_gameweek_id

    union all

    -- Group stage fixtures.
    select 'group'::text, f.id, f.competition_id, c.name::text,
           ('Group round ' || f.round_number)::text,
           o.id, o.display_name::text, o.badge_kit::text
    from group_fixtures f
    join competitions c on c.id = f.competition_id
    join profiles o on o.id = case when f.home_user_id = p_user_id then f.away_user_id else f.home_user_id end
    where (f.home_user_id = p_user_id or f.away_user_id = p_user_id)
      and f.gameweek_id = p_gameweek_id
  ) t
  order by 4, 1;
$$;

create or replace function public.my_gameweek_ties(p_gameweek_id uuid)
returns table (
  kind text, match_id uuid, competition_id uuid, competition_name text,
  round_label text, opponent_id uuid, opponent_name text, opponent_kit text
)
language sql stable security definer set search_path = public as $$
  select * from my_gameweek_ties_for(auth.uid(), p_gameweek_id);
$$;

revoke all on function public.my_gameweek_ties_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.my_gameweek_ties_for(uuid, uuid) to service_role;
grant execute on function public.my_gameweek_ties(uuid) to authenticated;

-- CHECK: both functions exist (expect 2).
select count(*) as functions_found from pg_proc
where proname in ('my_gameweek_ties', 'my_gameweek_ties_for');
