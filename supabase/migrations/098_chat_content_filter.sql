-- 098_chat_content_filter.sql
--
-- The filter that stops objectionable messages being posted at all.
--
-- This is the first of Apple's four requirements for user-generated content,
-- and the wording matters: it asks for a method of "filtering objectionable
-- material FROM BEING POSTED to the app". Hiding it after the fact does not
-- satisfy that. So this is a BEFORE trigger that refuses the write, and the
-- author is told immediately and can rewrite.
--
-- It runs on edits as well as new messages. A filter that only checked inserts
-- would be defeated by posting "hello" and editing it.
--
-- RUN ON DEV FIRST, then production. Depends on 096 (tables).

-- ---------------------------------------------------------------------------
-- The check.
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
  -- Fold the obvious substitutions before matching, or the list has to carry
  -- every spelling of every word and still misses the next one.
  v_text := lower(new.body);
  v_text := translate(v_text, '0134578@$!', 'oieastbasi');

  -- Match on word boundaries, not substrings.
  --
  -- This is the Scunthorpe problem, and it is not hypothetical in a football
  -- app: substring matching bans the town, the United fixture, and anyone
  -- typing about either. A boundary-anchored match costs nothing and avoids
  -- the entire class of embarrassment.
  --
  -- The regexp_replace escapes regex metacharacters in the stored term, so a
  -- term can be added by anyone without knowing that '.' means something.
  select t.term into v_hit
  from chat_blocked_terms t
  where v_text ~ (
    '(^|[^a-z0-9])'
    || regexp_replace(lower(btrim(t.term)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
    || '([^a-z0-9]|$)'
  )
  limit 1;

  if v_hit is not null then
    -- Deliberately does not name the word that matched. Telling someone
    -- exactly which term tripped the filter turns it into a game of finding
    -- the edge of the list.
    raise exception 'That message was blocked by the chat filter. Please rephrase it.'
      using errcode = 'check_violation';
  end if;

  -- Stamp the edit here rather than trusting the client to.
  --
  -- Not when the change is a removal: chat_delete_message() blanks the body,
  -- which is a change to it, and marking a moderated message "edited" would
  -- be both untrue and a misleading thing to show next to it.
  if tg_op = 'UPDATE'
     and new.body is distinct from old.body
     and new.deleted_at is null then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_chat_filter on public.chat_messages;
create trigger trg_chat_filter
  before insert or update of body on public.chat_messages
  for each row execute function chat_filter_message();

-- ---------------------------------------------------------------------------
-- A starter list.
-- ---------------------------------------------------------------------------
--
-- Common English profanity only. It is enough to demonstrate that the filter
-- works — which is what a reviewer will test — and nothing like enough for
-- live use.
--
-- WHAT IS MISSING, and you do need to deal with it: racial, homophobic and
-- other slurs. Those are the terms that actually get an app pulled, and they
-- are not in this file because a migration committed to a public repository is
-- the wrong place to keep a list of them. Add them straight into the table on
-- production:
--
--     insert into chat_blocked_terms (term) values ('...'), ('...')
--     on conflict (term) do nothing;
--
-- No release needed — that is why the list is a table. Ofcom's "Quick Reference
-- Guide to Offensive Language" is a reasonable, maintained starting point for
-- British English, and football chat is squarely British English.
insert into public.chat_blocked_terms (term) values
  ('fuck'), ('fucking'), ('fucker'), ('motherfucker'),
  ('shit'), ('bullshit'), ('shite'),
  ('cunt'), ('twat'), ('wanker'), ('bellend'),
  ('bastard'), ('bollocks'), ('prick'), ('dickhead'),
  ('slut'), ('whore')
on conflict (term) do nothing;

-- ---------------------------------------------------------------------------
-- Check it works. Both should return true.
-- ---------------------------------------------------------------------------
select
  -- A blocked term is caught...
  (select count(*) from chat_blocked_terms
    where 'that was shit'      ~ ('(^|[^a-z0-9])' || term || '([^a-z0-9]|$)')) > 0  as catches_profanity,
  -- ...and Scunthorpe is not.
  (select count(*) from chat_blocked_terms
    where 'scunthorpe away'    ~ ('(^|[^a-z0-9])' || term || '([^a-z0-9]|$)')) = 0  as scunthorpe_is_safe;
