# ALOTO F1 predictions

F1 is the third sport in the app, next to football and NFL (Lloyd, 10 Nov 2026).
Built the same way as NFL: its own screens, tables and feed, so nothing in it
can change how football or NFL work.

## How it plays

Each race weekend is one round (a gameweek numbered `R21`). Players put the
whole field in order:

| Pick | Locks | Scored on | Default points |
|---|---|---|---|
| Sprint grid (sprint weekends) | Sprint qualifying starts | Sprint qualifying result | 5 per driver exactly right |
| Sprint (sprint weekends) | Sprint starts | Sprint finish | 8, 7, 6, 5, 4, 3, 2, 1 for P1 to P8 |
| Grid | Qualifying starts | Qualifying result (before grid penalties) | 5 per driver exactly right, all 22 |
| Race | Race starts | Race finish | 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 for P1 to P10, then 1 for P11 to P22 |

Every value is on the competition's `point_rules` row (`f1_grid_points`,
`f1_race_points[]`, `f1_sprint_points[]`) and the admin edits them in
Admin → Scoring.

Picks belong to the player and the race, like football predictions, so one
set counts in every F1 league they are in. A race added by two leagues is
shared (one gameweek, linked to both).

## Season predictions

`f1_season_configs`, one per league. Drivers' Champion is free. The full
drivers' table and constructors' table are Pro (trigger
`f1_season_tables_require_pro`: one of the league's admins needs Pro to switch
them on). 20 points each by default: the champion, and each table place exactly
right. Scored from `f1_championship` (kept by the feed) into `season_scores`,
"if it ended now" during the season, then settled.

## Free plan

One F1 league per admin (migration 118 counts leagues per sport), with the
Drivers' Champion question. F1 is league only, like NFL.

## Data

| Table | What |
|---|---|
| `f1_teams`, `f1_drivers` | The season's teams and drivers, from the feed |
| `f1_races` | One per race weekend, linked to its gameweek. Session times, live session and lap, which sessions are confirmed |
| `f1_results` | The order of each session (`sprint_grid`, `sprint`, `grid`, `race`). Provisional until confirmed |
| `f1_picks` | Each player's order for each session. Saved through `f1_save_picks` |
| `f1_race_scores` | Points per league, race and player, split by session. The total also goes to `gameweek_scores` |
| `f1_championship` | Drivers' and constructors' standings |
| `f1_sync_log` | What the feed did and how many API requests it used |

Scoring is in the database: `f1_score_race`, run by `f1_confirm_session`,
`f1_set_result` and `f1_unconfirm_session`.

## The feed: `sync-f1`

API-SPORTS Formula 1 (`v1.formula-1.api-sports.io`), the same API-SPORTS
account as football. Key: `API_F1_KEY`, or `API_FOOTBALL_KEY` if that is not
set. Daily limit `API_F1_DAILY_LIMIT` (default 7500).

Modes: `season` (calendar for the admin), `import` (add races), `drivers`,
`results` (fetch one race now), `standings`, and `live`, which pg_cron runs
every minute (migration 120). Live only calls the API while a session is
inside its window, so a normal week uses no requests; a race weekend uses
roughly 300 to 600.

Qualifying is put together from Q3, then the drivers out in Q2, then Q1. The
same for sprint qualifying.

## Migrations

| File | What |
|---|---|
| 119_f1.sql | Everything above. Adds the sport switched OFF |
| 120_f1_live_schedule.sql | Runs sync-f1 every minute (copies the football live job) |
| 121_f1_switch_on.sql | Shows F1 in the sport chooser. F1 ships in 2.2, so run it on Prod before submitting 2.2 for review |
| 122_app_review_demo_f1.sql | App Review Demo F1 league for both review accounts, with picks and scores. Prod, after the races are added; rerun if review slips |
