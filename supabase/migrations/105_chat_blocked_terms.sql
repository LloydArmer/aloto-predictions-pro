-- 105_chat_blocked_terms.sql
--
-- A working blocklist, replacing the seventeen-word starter in 098.
--
-- Organised by what each group is FOR, because they are not the same job:
--
--   profanity   mostly tone. Blocking it keeps a league chat civil, and is
--               what stops the app being an 17+ rating on language alone.
--   sexual      explicit content, which Apple treats as its own category.
--   slurs       the ones that actually get an app pulled. These are not a
--               matter of tone and there is no context in a football chat
--               that makes them acceptable.
--   harm        telling someone to kill themselves, and threats. Rarer, far
--               more serious, and the hardest to catch with a word list.
--
-- Inflections are listed separately — "fuck" does not match "fucking",
-- because the matcher anchors both ends of the word on purpose. Spelling
-- variants are NOT listed: 104 handles repeated letters, separators and digit
-- swaps, so "fuuuck", "f.u.c.k" and "sh1t" need no entries of their own.
--
-- RUN ON DEV FIRST, then production. Depends on 096, and 104 for the matcher.
--
-- ---------------------------------------------------------------------------
-- A WORD ABOUT WHAT THIS CANNOT DO
-- ---------------------------------------------------------------------------
--
-- A blocklist catches words. It does not catch abuse, and the two are not the
-- same thing. "You are a waste of oxygen and everyone in this league thinks
-- so" contains nothing on any list and is worse than most of what is here.
--
-- That is what the report queue is for, and why Apple asks for both. Do not
-- read a long list as the problem being solved — the filter is the first line,
-- the queue is the one that actually handles abuse, and the 24-hour response
-- is the promise that makes it mean anything.

insert into public.chat_blocked_terms (term) values
  -- ── Profanity, with inflections ─────────────────────────────────────────
  ('fuck'), ('fucks'), ('fucked'), ('fucking'), ('fucker'), ('fuckers'),
  ('fuckwit'), ('fuckface'), ('motherfucker'), ('motherfuckers'), ('mindfuck'),
  ('shit'), ('shits'), ('shite'), ('shitty'), ('shithead'), ('shitbag'),
  ('bullshit'), ('dogshit'), ('horseshit'),
  ('cunt'), ('cunts'), ('cunty'),
  ('twat'), ('twats'), ('twatted'),
  ('wanker'), ('wankers'), ('wanking'), ('wank'),
  ('bellend'), ('bellends'),
  ('bastard'), ('bastards'),
  ('bollocks'), ('bollock'),
  ('prick'), ('pricks'),
  ('dickhead'), ('dickheads'), ('dick'), ('dicks'),
  ('knobhead'), ('knobend'),
  ('arsehole'), ('arseholes'), ('asshole'), ('assholes'),
  ('piss off'), ('pissed off'), ('pisshead'),
  ('tosser'), ('tossers'),
  ('git'), ('plonker'), ('pillock'),
  ('slag'), ('slags'),
  ('scumbag'), ('scumbags'),

  -- ── Sexual ──────────────────────────────────────────────────────────────
  ('slut'), ('sluts'), ('slutty'),
  ('whore'), ('whores'),
  ('nonce'), ('nonces'),
  ('paedo'), ('paedos'), ('pedo'), ('pedos'), ('paedophile'), ('pedophile'),
  ('rape'), ('raped'), ('rapist'), ('rapists'),
  ('blowjob'), ('blowjobs'), ('handjob'),
  ('cock'), ('cocks'), ('knob'), ('knobs'),
  ('pussy'), ('minge'), ('fanny'),
  ('tits'), ('titties'),
  ('cum'), ('jizz'), ('spunk'),
  ('porn'), ('porno'), ('pornhub'),
  ('horny'), ('milf'),

  -- ── Slurs ───────────────────────────────────────────────────────────────
  --
  -- Racial and ethnic.
  ('nigger'), ('niggers'), ('nigga'), ('niggas'),
  ('coon'), ('coons'),
  ('paki'), ('pakis'),
  ('chink'), ('chinks'),
  ('gook'), ('gooks'),
  ('spic'), ('spics'),
  ('wog'), ('wogs'),
  ('wetback'), ('wetbacks'),
  ('gyppo'), ('gypo'), ('pikey'), ('pikeys'),
  ('darkie'), ('darky'),
  ('golliwog'),
  -- Religious.
  ('kike'), ('kikes'),
  ('towelhead'), ('towelheads'), ('raghead'), ('ragheads'),
  ('christkiller'),
  -- Homophobic and transphobic.
  ('faggot'), ('faggots'), ('fag'), ('fags'), ('faggy'),
  ('dyke'), ('dykes'),
  ('poof'), ('poofs'), ('poofter'), ('poofters'),
  ('batty boy'), ('batty man'),
  ('tranny'), ('trannies'), ('shemale'),
  -- Ableist.
  ('retard'), ('retards'), ('retarded'),
  ('spastic'), ('spastics'), ('spaz'), ('spacker'),
  ('mong'), ('mongs'), ('mongol'),
  ('cripple'), ('cripples'),

  -- ── Harm and threats ────────────────────────────────────────────────────
  --
  -- Phrases, because the individual words are all perfectly ordinary. The
  -- matcher treats a space as "a gap of any size", so "kill  your  self"
  -- is caught too.
  ('kill yourself'), ('kill your self'), ('kys'),
  ('go die'), ('hope you die'), ('hope he dies'), ('hope she dies'),
  ('drink bleach'),
  ('hang yourself'),
  ('neck yourself'),
  ('i will kill you'), ('im going to kill you'),
  ('watch your back'),
  ('know where you live'), ('i know where you live')
on conflict (term) do nothing;

-- ---------------------------------------------------------------------------
-- Adding to it later. No release needed — that is the point of it being data.
-- ---------------------------------------------------------------------------
--
--   insert into chat_blocked_terms (term) values ('whatever')
--   on conflict (term) do nothing;
--
-- And removing one that is causing trouble:
--
--   delete from chat_blocked_terms where term = 'whatever';
--
-- Before adding a term, check it against the names of teams, towns and
-- players. The matcher anchors both ends of a word, so "arse" does not block
-- Arsenal — but a term that IS a whole word somebody might legitimately use
-- will block it everywhere, and the person it blocks gets no explanation
-- beyond "rephrase it".

-- ---------------------------------------------------------------------------
-- Check.
-- ---------------------------------------------------------------------------
--
-- The second column is the one that matters: these are the phrases a football
-- chat is actually going to contain, and every one of them must get through.
with innocent(text) as (values
  ('Scunthorpe away on a Tuesday night'),
  ('Arsenal were poor again'),
  ('great assist from Saka'),
  ('Hancock had an absolute shocker'),
  ('class finish that'),
  ('driving through Penistone'),
  ('what a cracking match'),
  ('Cocu was the manager then'),
  ('Dickinson scored in the 90th'),
  ('he was gutted after the final whistle')
)
select
  (select count(*) from chat_blocked_terms)                       as terms_loaded,
  (select bool_and(not exists (
      select 1 from chat_blocked_terms t
      where translate(lower(innocent.text), '0134578@$!', 'oieastbasi') ~ chat_term_pattern(t.term)))
   from innocent)                                                 as football_talk_unaffected;
