# ALOTO NFL predictions — project brief

Adding NFL as a competition type inside the existing ALOTO Prediction Pro app.
Written 5 November 2026. Nothing is built or installed yet.

---

## 1. The decision already taken

NFL lives **inside the existing app**, not as a separate product. A competition
gets `sport = 'nfl'` and scores on the margin instead of the exact score.

Why this way: the same people play, and they keep one login, one Pro
entitlement, one chat, one push registration and one App Store listing. A
separate app would mean rebuilding auth, chat, push, Pro and the whole admin
section, and asking everyone to make a second account.

---

## 2. Why margin scoring, not the football rules

The football app pays 5 for an exact score and 2 for the right result. Port
that to the NFL unchanged and the league breaks in two ways:

- **Exact scores never happen.** Real scores are 31–24. Nobody will ever claim
  the bonus, so the top of the scoring system is dead weight.
- **Favourites win about two thirds of the time.** If the result is all that
  pays, picking every favourite is a winning strategy and the league is a
  coin-flip between people doing the same thing.

Margin scoring asks the question the sport is actually about — how close was
it — and is what every NFL pool reaches for. It also needs no odds feed, which
keeps the build self-contained.

### The agreed points (updated 8 Nov 2026, migration 117)

Points ADD together, and only when the winner is correct. A wrong winner scores 0.

| Part | Points |
|---|---|
| Correct winner | 2 |
| Each team's score exact | +5 per team |
| Margin exact | +12 |
| Margin out by 1 to 2 | +10 |
| Margin out by 3 to 4 | +8 |
| Margin out by 5 to 7 | +6 |
| Margin out by 8 to 10 | +4 |
| Margin out by 11 to 14 | +2 |
| Margin out by 15 or more | 0 |

An exact score is 2 + 5 + 5 + 12 = 24. Columns: `winner_only_points`,
`team_score_points`, `margin_exact_points`, `margin_within_2/4/7/10/14_points`.
`exact_score_points` and `margin_within_3_points` are no longer read for NFL.
The SQL twin of the app's `marginScore` is `public.nfl_margin_points()`.

### Full house, no Triple Points, no months (Lloyd, 10 Nov 2026)

- Full house bonuses stay, as in football: `full_house_results_bonus` (every
  winner correct in a week) and `full_house_scores_bonus` (every score exact),
  set in Admin → Scoring, with a per-week override on the week's Settings tab.
  You need a pick for every live game; void games don't count. 0 = off.
- No Triple Points and no months in NFL: the week Settings card (Month, Block
  Triple Points) is hidden for NFL. Standings shows who won each week instead.
- The NFL table has a column per scoring line (CW, TS, EM, ≤2 … ≤14, FH, WW,
  S) with Pts at the end and a key of this league's values above it.
  `src/lib/sports/nfl/table.js` works the counts out from finished weeks.
- Wording: "Correct winner(s)", not "Right winner".

(Earlier versions: 111 had one band per game, exact score 20, within 3/7/14 =
9/6/3, winner only 1; 113 made the winner a base of 2 on top.)

**Margin is signed.** Predict the home team by 3, watch the away team win by 3,
and you are out by six — a touchdown — not level. Using the absolute margin
would score a backed winner and a backed loser identically whenever the game
was close, which is exactly backwards.

**Why these numbers.** Lloyd wanted more steps between an exact margin and
nothing, and a reward for getting one team's score right. The ladder drops 2
points per step, and only a wrong winner or a margin out by 15+ leaves just
the 2 for the winner.

All of these are defaults in `point_rules`, editable per competition.

---

## 3. The schema

Deliberately no new tables. NFL games are fixtures and NFL weeks are gameweeks.

**`competitions.sport`** — `'football' | 'nfl'`, default `'football'`.
Decides which feed syncs it and which badge style it draws.

**`point_rules.scoring_mode`** — `'exact_score' | 'margin'`, default
`'exact_score'`. Plus `margin_exact_points`, `margin_within_3_points`,
`margin_within_7_points`, `margin_within_14_points`, `winner_only_points`.

They are on **different tables on purpose**. `point_rules` is already what gets
handed to the scorer, so putting the mode there means every existing call site
picks it up with no new plumbing. `sport` is a competition-level concern — feed
and badges — and keeping them apart means margin scoring would work on football
too if anyone wanted it.

**`fixtures` and `predictions` need no changes at all.** `predicted_home` and
`predicted_away` already hold everything margin scoring reads. That is the part
worth noticing: the whole feature is two enum columns, some constants and a
second sync function.

`create_default_rules()` is extended so a competition created with
`sport = 'nfl'` starts with `scoring_mode = 'margin'`,
`exact_score_points = 20` and `correct_result_points = 0` — zero because the
consolation for calling the winner is `winner_only_points`, and paying both
would quietly double it.

The migration for all of the above was drafted as `111_nfl_margin_scoring.sql`
but **was never installed**. Rebuild it; the design above is complete.

---

## 4. What is left to build

| Piece | Notes |
|---|---|
| Migration `111` | The schema above. Dev first, then Production. |
| `src/lib/scoring.js` | `marginScore()` and `marginError()`; `scoreOnePrediction()` branches on `rules.scoring_mode === 'margin'` and returns early — the two modes must not stack, or a prediction is paid twice. `defaultRules()` must carry the margin fields too. |
| Admin — create | A sport chooser when creating a competition. |
| Admin — Scoring tab | Margin band inputs, shown when the mode is margin. |
| Predict | A margin readout under each fixture ("Philadelphia by 7"), and points shown by band once a game is final. |
| Standings / results | Band labels rather than "exact / correct result". |
| Badges | `Shirt.jsx` draws football kits. NFL wants helmets or team colour blocks. The one piece with no shortcut. |
| `sync-nfl` edge function | Fixtures and live scores. |

**Design mockups** exist as a Claude artifact, "ALOTO NFL — Predict &
Scoring": the Predict screen for a week, the scoring explainer, and a week's
results showing the bands in action. They use colour bars in place of kits,
which is how the badge question reads on screen.

---

## 5. The API

API-SPORTS American Football, `https://v1.american-football.api-sports.io`.

- Covers NFL and NCAA: schedules, live scores on a 30-second update,
  quarter-by-quarter scores, standings, injuries.
- Pre-match bookmaker odds including **handicap markets** — that is a spread,
  if against-the-spread scoring is ever wanted. Available 1–7 days out,
  refreshed four times a day.
- **Same API-SPORTS account and key as the football API, but almost certainly a
  separate subscription.** Confirm before building the sync:
  `curl -H "x-apisports-key: KEY" https://v1.american-football.api-sports.io/status`
  — a plan and request counts means it is covered; a subscription error means
  another $15–25/month.
- Volume is not a concern either way: 16 games a week against 60+ for the
  football competitions.

NFL weeks map onto gameweeks directly. The app's **per-fixture locking already
handles NFL timing** — a week runs Thursday night to Monday 1:15am UK and each
game locks at its own kickoff, which is exactly what that feature was for.

---

## 6. One warning worth having before starting

**Do not call it spread betting in the app.** Apple's Guideline 5.3 covers
gambling. A free prediction league with no stakes is fine, but an interface
full of "odds", "stakes" and "betting" invites a reviewer to look much harder
at whether real money is involved. Say margin, say points, and the same game
goes through unremarked.

---

## 7. The app you are working inside

Enough to be useful; the football Project has the full version.

| Thing | Detail |
|---|---|
| Repo | `C:\dev\aloto-prediction-pro` |
| Stack | React 18 + Vite + Tailwind, Supabase, Netlify (web), Capacitor 8 + Codemagic (iOS) |
| Branches | Work on `develop`, fast-forward merge to `main` to release |
| Version | 2.1 |
| Supabase | Two projects, Dev and Production (`sbtsifitvxjqaujyguqf`). Every migration runs on Dev first. |

**Scoring entry point:** `scoreOnePrediction(prediction, fixture, rules)` in
`src/lib/scoring.js`. Everything scores through it. `rules` comes from
`resolvePointRules()`, which does `select('*')` — so new `point_rules` columns
flow through with no change.

**Competitions and membership:** `participants` is the source of truth for who
is in a competition and who runs it. Write policies against the existing
`is_participant(competition_id)` and `is_competition_admin(competition_id)`
helpers, both security definer. A policy that reads another table directly runs
as the signed-in user and inherits that table's RLS and grants — that mistake
produced `permission denied for table competitions` during the chat work.

**Gameweeks link through `competition_gameweeks`**, not a foreign key on
`gameweeks`. And `gameweeks.number` is **TEXT**, so a database sort gives
`GW1, GW10, GW11, GW2` — right up to GW9 and wrong from GW10, which is why it
looked correct for a whole season. Everything that orders gameweeks goes
through `src/lib/gameweeks.js`.

**Line endings:** the repo is CRLF with `.gitattributes` `* text=auto`. Editing
files in Python must be done in binary with the existing ending detected, or a
one-word change becomes a whole-file diff.

**Release:**

```
git add -A
git commit -m "..."
git push
git checkout main
git merge --ff-only develop
git push
git checkout develop
```

Netlify deploys `main` automatically. iOS builds are started manually in
Codemagic on `main` — build `main`, never `develop`; a build from a stale
branch once produced a submission Apple rejected after a full compile.

---

## 8. How Lloyd wants to work

- SQL always as a **downloadable file**, never pasted into chat, and also saved
  into `supabase/migrations` — including read-only check scripts.
- **Never** a SQL file that has to be run in parts, and no placeholder values
  to fill in. One file, one action.
- Deployment steps **in the chat**, not as a document, stating which
  environment each step applies to. Show files in a table saying where each one
  goes — he copies them in himself, so no copy commands.
- One `git add -A` and **one** commit, not changes split across several.
- Don't send files or SQL for decisions that haven't been made yet. Build what
  was asked, or ask — don't deliver things just in case.
- Be explicit about what needs running and what doesn't.
