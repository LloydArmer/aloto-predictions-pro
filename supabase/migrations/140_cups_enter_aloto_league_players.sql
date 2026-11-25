-- =============================================================================
-- 140 — One-off: put every player in "ALOTO Predictions League - 26/27" into
-- "ALOTO Carabao Cup - 26/27" and "ALOTO FA Cup - 26/27".
-- (Names are matched ignoring spaces, dashes and capitals.)
--
-- Anyone already in a cup is left as they are. Pending invites (people who
-- haven't signed up yet) are not players, so they are not copied.
--
-- Run on Prod. Safe to run more than once.
-- =============================================================================

do $$
declare
  v_league uuid;
  v_cup    uuid;
  v_name   text;
  v_key    text;
  v_n      int;
begin
  select count(*) into v_n from competitions where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'alotopredictionsleague2627';
  if v_n <> 1 then raise exception 'Expected one competition named ALOTO Predictions League - 26/27, found %', v_n; end if;
  select id into v_league from competitions where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'alotopredictionsleague2627';

  foreach v_key in array array['alotocarabaocup2627', 'alotofacup2627'] loop
    select count(*) into v_n from competitions where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = v_key;
    if v_n <> 1 then raise exception 'Expected one competition matching %, found %', v_key, v_n; end if;
    select id, name into v_cup, v_name from competitions where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = v_key;

    insert into participants (competition_id, user_id, role)
    select v_cup, p.user_id, 'player'
    from participants p
    where p.competition_id = v_league
      and not exists (select 1 from participants x where x.competition_id = v_cup and x.user_id = p.user_id);
    get diagnostics v_n = row_count;
    raise notice '% : % players added', v_name, v_n;
  end loop;
end $$;

-- CHECK: players in the league and in each cup (the cups should be at least the league's number).
select c.name, count(p.user_id) as players
from competitions c
left join participants p on p.competition_id = c.id
where regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') in ('alotopredictionsleague2627', 'alotocarabaocup2627', 'alotofacup2627')
group by c.name
order by c.name;
