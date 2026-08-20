-- 043_competition_join_codes.sql
--
-- Self-service joining: an admin shares a short code, a participant enters it,
-- and they're added to that competition and no other.
--
-- This also closes a hole. The existing participants_insert policy allows
-- `auth.uid() = user_id`, which means ANY signed-up user can currently add
-- themselves to ANY competition — they only need its id, and competitions are
-- readable by every authenticated user. Joining now goes through a function
-- that checks the code, and the policy no longer permits open self-insert.
--
-- RUN ON DEV FIRST.

-- ---------------------------------------------------------------------------
-- STEP 1 — The code column.
--
-- Codes are 6 characters from an alphabet with no 0/O/1/I/L, because these get
-- read aloud and typed by hand from a WhatsApp message. That still gives about
-- 887 million combinations, so guessing one is not a realistic attack.
-- ---------------------------------------------------------------------------
alter table competitions add column if not exists join_code text;

create unique index if not exists idx_competitions_join_code
  on competitions (upper(join_code)) where join_code is not null;

create or replace function generate_join_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  attempts  int := 0;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    exit when not exists (select 1 from competitions where upper(join_code) = candidate);

    attempts := attempts + 1;
    if attempts > 50 then
      raise exception 'Could not generate a unique join code';
    end if;
  end loop;

  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- STEP 2 — Give every competition a code, now and in future.
-- ---------------------------------------------------------------------------
update competitions set join_code = generate_join_code() where join_code is null;

create or replace function set_join_code_on_insert()
returns trigger
language plpgsql
as $$
begin
  if new.join_code is null then
    new.join_code := generate_join_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_join_code on competitions;

create trigger trg_set_join_code
before insert on competitions
for each row
execute function set_join_code_on_insert();

-- ---------------------------------------------------------------------------
-- STEP 3 — Joining by code.
--
-- security definer so it can insert a participants row the caller could not
-- insert directly. That is the whole point: the code is the authorisation, and
-- this function is the only path that accepts it.
--
-- Returns a json result rather than raising, so the app can tell "no such code"
-- apart from "you're already in this one" and word each properly.
-- ---------------------------------------------------------------------------
create or replace function join_competition_with_code(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  comp record;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select id, name, status into comp
  from competitions
  where upper(join_code) = upper(trim(p_code));

  if not found then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;

  if comp.status = 'completed' then
    return json_build_object('ok', false, 'error', 'completed', 'name', comp.name);
  end if;

  if exists (select 1 from participants where competition_id = comp.id and user_id = auth.uid()) then
    return json_build_object('ok', true, 'already', true, 'competition_id', comp.id, 'name', comp.name);
  end if;

  insert into participants (competition_id, user_id, role)
  values (comp.id, auth.uid(), 'player');

  return json_build_object('ok', true, 'already', false, 'competition_id', comp.id, 'name', comp.name);
end;
$$;

grant execute on function join_competition_with_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 4 — Let an admin issue a fresh code.
--
-- Needed if a code leaks beyond the intended group. Old code stops working
-- immediately; nobody already in the competition is affected.
-- ---------------------------------------------------------------------------
create or replace function regenerate_join_code(p_competition_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if not exists (
    select 1 from participants
    where competition_id = p_competition_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only an admin of this competition can change its join code';
  end if;

  new_code := generate_join_code();
  update competitions set join_code = new_code where id = p_competition_id;
  return new_code;
end;
$$;

grant execute on function regenerate_join_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STEP 5 — Close the open-join hole.
--
-- Was: `auth.uid() = user_id or <caller is an admin of the competition>`.
-- The first half let any authenticated user insert themselves into any
-- competition. Now self-insert is allowed only for the person who CREATED the
-- competition (so creating one still seeds them as its admin); everyone else
-- arrives either through the code function above or by an admin adding them.
-- ---------------------------------------------------------------------------
drop policy if exists "participants_insert" on participants;

create policy "participants_insert" on participants
for insert with check (
  exists (
    select 1 from participants p2
    where p2.competition_id = participants.competition_id
      and p2.user_id = auth.uid()
      and p2.role = 'admin'
  )
  or exists (
    select 1 from competitions c
    where c.id = participants.competition_id
      and c.created_by = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- STEP 6 — Check. Every competition should now show a 6-character code.
-- ---------------------------------------------------------------------------
select name, format, join_code from competitions order by created_at;
