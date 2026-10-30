-- 104_chat_filter_evasions.sql
--
-- Makes the filter survive the obvious ways round it.
--
-- 098 matched whole words after folding digits back to letters, which catches
-- "sh1t" and nothing cleverer. Anyone who has been moderated once works out
-- "f.u.c.k" or "fuuuck" within about a minute, and a list of five hundred
-- words is worth nothing if every one of them has a dozen spellings that sail
-- through.
--
-- So instead of matching the term literally, each term is compiled into a
-- pattern that tolerates the three evasions people actually use:
--
--   repeated letters      fuuuuck, shiiit, cuntttt
--   separators            f.u.c.k, f-u-c-k, f u c k, s*h*i*t
--   character swaps       sh1t, @rse, pr1ck            (already in 098)
--
-- WHAT IT DELIBERATELY DOES NOT DO: match inside words. Both ends are still
-- anchored to a word boundary, which is the only thing standing between this
-- filter and banning Scunthorpe, Arsenal and anyone called Hancock. That
-- restraint is tested at the bottom of this file and should stay tested.
--
-- RUN ON DEV FIRST, then production. Depends on 096 and 098.

-- ---------------------------------------------------------------------------
-- Compiling a term into a pattern.
-- ---------------------------------------------------------------------------
--
-- "kill yourself" becomes, roughly:
--   (^|[^a-z0-9]) k+[^a-z0-9]?i+[^a-z0-9]?l+[^a-z0-9]?l+ [^a-z0-9]+ y+... ([^a-z0-9]|$)
--
-- A letter in the term may repeat; a gap of at most one non-letter may sit
-- between letters; and a space in the term means a real gap. At most ONE
-- separator between letters is deliberate — allowing more lets a short term
-- match across two innocent words.
create or replace function chat_term_pattern(p_term text)
returns text
language plpgsql
immutable
as $$
declare
  t          text := lower(btrim(p_term));
  out        text := '';
  ch         text;
  i          int;
  prev_alnum boolean := false;
begin
  for i in 1..length(t) loop
    ch := substr(t, i, 1);
    if ch ~ '[a-z0-9]' then
      -- Between two letters, tolerate a single separator: the dot in f.u.c.k.
      if prev_alnum then out := out || '[^a-z0-9]?'; end if;
      -- The letter itself, repeated as often as they like.
      out := out || ch || '+';
      prev_alnum := true;
    else
      -- A space or punctuation IN THE TERM means a real gap in the text, so a
      -- phrase survives being typed with any amount of space in it.
      out := out || '[^a-z0-9]+';
      prev_alnum := false;
    end if;
  end loop;

  -- Both ends anchored. This is the Scunthorpe guard and it is not optional.
  return '(^|[^a-z0-9])' || out || '([^a-z0-9]|$)';
end;
$$;

comment on function chat_term_pattern(text) is
  'Compiles a blocked term into a regex tolerating repeated letters and single separators. Anchored at both ends so it never matches inside a longer word.';

-- ---------------------------------------------------------------------------
-- The filter, using it.
-- ---------------------------------------------------------------------------
create or replace function chat_filter_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
  v_hit  text;
begin
  v_text := lower(new.body);

  -- Fold the character swaps before matching, as 098 did.
  v_text := translate(v_text, '0134578@$!', 'oieastbasi');

  select t.term into v_hit
  from chat_blocked_terms t
  where v_text ~ chat_term_pattern(t.term)
  limit 1;

  if v_hit is not null then
    -- Still does not name the word that matched. Telling someone exactly which
    -- term tripped the filter turns it into a game of finding the edge.
    raise exception 'That message was blocked by the chat filter. Please rephrase it.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE'
     and new.body is distinct from old.body
     and new.deleted_at is null then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

-- The trigger itself is unchanged from 098 and is recreated only so this file
-- stands on its own.
drop trigger if exists trg_chat_filter on public.chat_messages;
create trigger trg_chat_filter
  before insert or update of body on public.chat_messages
  for each row execute function chat_filter_message();

-- ---------------------------------------------------------------------------
-- Check. Every column must be true.
-- ---------------------------------------------------------------------------
--
-- The first four are the evasions. The rest are the false positives, and they
-- matter just as much: a filter that stops people saying "Scunthorpe away" in
-- a football app is broken, however much swearing it catches.
with probe(label, text, should_block) as (values
  ('plain',            'that ref was shit',          true),
  ('repeated letters', 'that ref was shiiiiit',      true),
  ('dots',             'that ref was s.h.i.t',       true),
  ('spaced out',       'that ref was s h i t',       true),
  ('digit swap',       'that ref was sh1t',          true),
  ('Scunthorpe',       'Scunthorpe away on Tuesday', false),
  ('Arsenal',          'Arsenal were poor today',    false),
  ('assist',           'great assist from Saka',     false),
  ('Hancock',          'Hancock had a shocker',      false),
  ('classic',          'a classic performance',      false),
  ('Penistone',        'driving through Penistone',  false)
)
select
  bool_and(
    (exists (select 1 from chat_blocked_terms t
              where translate(lower(probe.text), '0134578@$!', 'oieastbasi') ~ chat_term_pattern(t.term)))
    = probe.should_block
  ) as every_case_correct
from probe;

-- If that returns false, this shows which one disagreed:
--
--   with probe(label, text, should_block) as (values ...same as above... )
--   select label, text, should_block,
--          exists (select 1 from chat_blocked_terms t
--                   where translate(lower(text), '0134578@$!', 'oieastbasi') ~ chat_term_pattern(t.term)) as blocked
--   from probe;
