-- Each individual season prediction can have its own lock date and time.
--
-- Until now there was ONE deadline on the question set, so every question
-- locked together. That is wrong for the questions themselves: the Premier
-- League winner has to be locked before the season starts, while the Golden
-- Boot or the FA Cup winner could sensibly stay open for weeks longer.
--
-- A question's own deadline OVERRIDES the set's. Leaving it empty keeps the
-- set's deadline, so every question that exists today carries on behaving
-- exactly as it does now and nothing needs migrating.
--
-- The rules below use coalesce(question, set), which is that sentence in SQL.

alter table public.season_picks
  add column if not exists deadline timestamptz;

comment on column public.season_picks.deadline is
  'Overrides the set''s deadline for this question. Null means use the set''s.';

-- ---- Who may ANSWER, and until when --------------------------------------
--
-- The screen greys a locked question out, but the screen is only the first
-- line. This is what actually stops a late answer.

drop policy if exists spa_write on public.season_pick_answers;

create policy spa_write on public.season_pick_answers
  for all
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from season_picks p
      join season_pick_configs c on c.id = p.config_id
      where p.id = season_pick_answers.pick_id
        and c.is_open
        and (coalesce(p.deadline, c.deadline) is null
             or coalesce(p.deadline, c.deadline) > now())
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from season_picks p
      join season_pick_configs c on c.id = p.config_id
      where p.id = season_pick_answers.pick_id
        and c.is_open
        and (coalesce(p.deadline, c.deadline) is null
             or coalesce(p.deadline, c.deadline) > now())
    )
  );

-- ---- Who may SEE everyone else's answers ---------------------------------
--
-- Per question now, not all at once: a question opens up the moment ITS OWN
-- deadline passes, while the ones still running stay sealed. Revealing a
-- question that is still open would hand everybody else the answers.
--
-- The competition's admin still reads at any time, which is what the
-- "Who's entered" screen needs.

drop policy if exists spa_read on public.season_pick_answers;

create policy spa_read on public.season_pick_answers
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from season_picks p
      join season_pick_configs c on c.id = p.config_id
      where p.id = season_pick_answers.pick_id
        and (
          public.is_competition_admin(c.competition_id)
          or (
            public.is_participant(c.competition_id)
            and (
              (coalesce(p.deadline, c.deadline) is not null
                and coalesce(p.deadline, c.deadline) < now())
              or c.is_open = false
            )
          )
        )
    )
  );
