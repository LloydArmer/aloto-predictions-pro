# ALOTO Prediction Pro — football

Everything needed to pick up the football app cold. Current as of 5 November 2026.

NFL has its own Project; this one covers the app as it stands.

---

## 1. What it is

A private football prediction league app. People join a competition with a
six-character code, predict scores for each fixture, and are scored against the
real results. Invite-only: there is no public content and nothing to browse.

**Owner:** Lloyd Armer. He runs the leagues and is the only developer.

---

## 2. Stack and where things live

| Thing | Detail |
|---|---|
| Repo | `C:\dev\aloto-prediction-pro` |
| Front end | React 18 + Vite + Tailwind |
| Backend | Supabase (Postgres, RLS, Edge Functions, pg_cron, Realtime) |
| Web host | Netlify, builds from `main` |
| iOS | Capacitor 8 wrapped, built in Codemagic, on the App Store |
| Android | Capacitor, same codebase |
| Branches | Work on `develop`, fast-forward merge to `main` to release |
| Current version | **2.1** (`codemagic.yaml` → `MARKETING_VERSION`) |

**Two Supabase projects: Dev and Production.** Production is
`sbtsifitvxjqaujyguqf` ("Prediction Pro"). Every migration runs on Dev first,
then Production.

### Source layout

```
src/
  lib/           scoring.js, gameweeks.js, push.js, nativePush.js, pro.js,
                 liveActivity.js, livePoints.js, seasonScoring.js, time.js
  hooks/         useAuth, useCompetitions, useSelectedCompetition, useChat,
                 useFixtures, useLeaderboard, useLiveActivity
  components/
    layout/      AppLayout.jsx (top nav, tab bar, chat icon)
    ui/          index.jsx (Button, Card, Badge, Input, Select, EmptyState…),
                 Shirt.jsx (kit drawing + PlayerMark, PlayerCell)
    features/    admin/ chat/ dashboard/ predict/ standings/ table/ season/
                 settings/ legal/ auth/ bracket/ competitions/ help/
supabase/
  migrations/    001 … 111
  functions/     sync-football, send-reminders, push-live-activity,
                 live-activity-token, notify-chat, revenuecat-webhook,
                 send-invite, _shared/push.ts
ios/App/         Xcode project, ALOTOWidget (Live Activity)
```

`Admin.jsx` is ~139KB and holds most admin tabs inline; `SeasonTab.jsx` and
`ChatModerationTab.jsx` are split out. New admin tabs should be their own file.

---

## 3. Data model — the parts that matter

**`competitions`** — `name`, `emoji`, `format` (`league` | `knockout` |
`group_knockout`), `status`, `join_code`, `created_by`, `auto_finalise_scores`,
`triple_points_blocked`, `rules_source_competition_id`, `chat_enabled`,
`sport` (added in 111).

**`participants`** — `competition_id`, `user_id`, `role` (`player` | `admin`).
This is the membership table and the source of truth for who can do what.

**`profiles`** — mirrors `auth.users`, created by a trigger on signup.
`display_name`, `role` (global admin flag), `badge_kit`, `notify_push`,
`chat_rules_accepted_at`.

**`gameweeks`** — linked to competitions through the **`competition_gameweeks`**
join table, so one gameweek can serve several competitions (a league and its
cup over the same fixtures). `number` is **TEXT** and holds whatever the admin
typed (`GW1`, `1`, `R16`).

**`fixtures`**, **`predictions`**, **`gameweek_scores`**, **`point_rules`**,
plus season predictions (`season_table_configs`, `season_picks`…) and the cup
bracket (`bracket_matches`, `bracket_predictions`).

### Helper functions used by every policy

```sql
is_participant(competition_id)        -- security definer
is_competition_admin(competition_id)  -- accepts a global profiles.role='admin' too
has_pro(user_id)
```

Write new policies against these rather than querying `participants` inline.
A policy that reads another table directly runs as the signed-in user and
inherits that table's RLS and grants — that mistake produced
`permission denied for table competitions` during the chat work.

---

## 4. Scoring

Set per competition in `point_rules`, resolved through
`resolvePointRules()` (which follows `rules_source_competition_id` so several
competitions can share one set of rules).

**Football (`scoring_mode = 'exact_score'`)** — additive:
correct result (default 2) **plus** an exact score bonus (default 5), so an
exact score is worth 7. Clean sheet bonus. Full-house bonuses for getting
every result or every score in a gameweek. **Triple Points**: a chip that
triples one gameweek, two per season, only if every fixture was predicted.
`triplePointsBonus()` works out what the chip *added* (15 → 10) because the
stored figure is the tripled total.

**NFL (`scoring_mode = 'margin'`, added in 111)** — scored on how far out the
margin was:

| Outcome | Default |
|---|---|
| Exact score | 20 |
| Exact margin | 12 |
| Within 3 (a field goal) | 9 |
| Within 7 (a touchdown) | 6 |
| Within 14 (two scores) | 3 |
| Right winner only | 1 |

Margin is **signed**, so predicting the home team by 3 when the away team wins
by 3 is an error of six, not zero.

Everything scores through `scoreOnePrediction(prediction, fixture, rules)` in
`src/lib/scoring.js`.

---

## 5. Edge functions and scheduled work

| Function | What it does |
|---|---|
| `sync-football` | Pulls fixtures and live scores from API-Football. Also auto-finalises full-time scores where the competition allows it. |
| `send-reminders` | Gameweek-open, 24h and 1h prediction reminders. Runs on pg_cron. Holds its own copy of the push-sending code. |
| `push-live-activity` | Drives the iOS lock-screen Live Activity: live score, league position and movement. |
| `live-activity-token` | Stores the ActivityKit push tokens. |
| `notify-chat` | Mention and reply notifications. Fired by a trigger on `chat_messages` insert. |
| `revenuecat-webhook` | Pro entitlements. |
| `_shared/push.ts` | FCM (web) and APNs (iOS) sending, used by `notify-chat`. **`send-reminders` still holds a duplicate copy** — worth unifying, but it sends every reminder in the app so it should be changed on its own with its own test. |

**Push routing:** iPhones get APNs directly, web goes through FCM. A Capacitor
iOS device token is an *Apple* token and FCM rejects it — then the app deletes
it as stale, which is how an iPhone ends up never receiving anything however
correctly it registered.

**API-Football:** direct pricing is Free / Pro $19 / Ultra $29 / Mega $39,
prepaid with no auto-renewal. The free plan's date window, not the request
quota, is what silently breaks fixture syncing when a subscription lapses.

---

## 6. League chat (shipped in 2.0, migrations 096–106)

One room per competition, **off by default** — the admin switches it on per
competition. Chat lives behind a speech-bubble icon in the **top bar**, not the
tab bar: four tabs was a deliberate choice because five truncate at 390px.

| Table | Purpose |
|---|---|
| `chat_messages` | competition, author, body, `reply_to_id`, `mentions uuid[]`, soft-delete columns |
| `chat_reads` | last-read per player per competition; drives the unread badge |
| `chat_reports` | reports, with `message_snapshot` taken server-side so evidence survives removal |
| `chat_blocks` | account-wide, one-directional, invisible to the blocked party |
| `chat_bans` | removed from one league's chat; does **not** affect predictions or standings |
| `chat_blocked_terms` | the filter word list — a table so it can change without an App Store release |
| `chat_notification_log` | duplicate guard; the insert *is* the lock |

**Apple Guideline 1.2** governs this, and all four requirements are
implemented: a filter that rejects at insert, a report queue with a 24-hour
commitment (Admin → Chat), account-wide blocking, and published contact
details. The filter tolerates repeated letters, single separators and digit
swaps (`fuuuck`, `f.u.c.k`, `sh1t`) while still letting Scunthorpe, Arsenal and
Hancock through — there are tests for both halves in `104`.

**Age rating is 13+**, set as a manual override. Chat and user-generated
content do *not* raise the rating by themselves; only a "social media
capability" forces 13+. The privacy policy already states the app is not aimed
at under-13s, which the override matches.

**App Review test accounts** (competition "App Review Demo", chat on, seeded
conversation — see `107`):
`appreview.admin@alotopredictionpro.co.uk` and
`appreview.player@alotopredictionpro.co.uk`.

**Contact addresses:** `support@alotopredictionpro.co.uk` for support and chat
reports, `admin@alotopredictionpro.co.uk` for privacy and account deletion.
Both defined once in `Privacy.jsx`.

---

## 7. Bugs that bit, and the lesson from each

Worth reading before changing related code — several of these were found twice.

**Gameweek numbers sort alphabetically.** `gameweeks.number` is text, so a
database sort gives `GW1, GW10, GW11, GW2` — correct up to GW9 and wrong from
GW10, which is why it looked fine for an entire season. Everything that orders
gameweeks must go through `src/lib/gameweeks.js` (`gameweekOrder`,
`sortGameweeks`, `latestGameweek`).

**A renamed variable left behind.** `Predict.jsx` read `data?.find(...)` in a
function whose query result was `rawGws`, so the gameweek selection was always
`null` while the dropdown *displayed* GW1 — "No fixtures this gameweek" eleven
weeks into the season. Check for stale identifiers after a rename.

**The iOS app never consulted `Main.storyboard`.** `SceneDelegate.swift` builds
the window and root view controller in code, so plugin registration through the
storyboard did nothing. From Capacitor 6 onward, app-target plugins are not
auto-discovered — they need `bridge?.registerPluginInstance()` inside
`capacitorDidLoad()` on a `CAPBridgeViewController` subclass
(`MainViewController.swift`). Three wrong root causes were declared before this
one; trace the path from launch to the failing call rather than fixing the
first real defect you find.

**Kit drawing used two coordinate spaces.** `KitShape.swift` shrank the shirt's
box from 48 to 40 units when shorts were added, moving its centre and dragging
hoops, quarters and the sash four units up — but only on kits with shorts, and
not on stripes, which is why it looked like one player's problem. The SVG in
`Shirt.jsx` is the reference: one space, shorts at `translate(0,41)`.

**Line endings.** The repo is CRLF with `.gitattributes` `* text=auto`. Editing
files in Python must be done in binary with the existing ending detected, or a
one-word change becomes a whole-file diff.

**Xcode object IDs must be unique.** A duplicated ID in `project.pbxproj` fails
in Codemagic at "Apply the profiles to the Xcode project", nowhere near the
cause.

**Default competition ordering.** `useCompetitions` ordered newest-first, so
creating a cup made it the default view of the whole app. Now leagues first,
then cups, each oldest first.

---

## 8. Build and release

```
git add -A
git commit -m "..."
git push
git checkout main
git merge --ff-only develop
git push
git checkout develop
```

Netlify deploys `main` automatically. For iOS, start the build manually in
Codemagic on `main` — there is no `triggering:` block. `codemagic.yaml` carries
`MARKETING_VERSION` and a guard that aborts if agvtool fails to apply it;
`App/Info.plist` uses `$(MARKETING_VERSION)`.

**Build `main`, not `develop`.** A build from a stale branch produced a 2.0
submission that Apple rejected with "the train version 1.8 is closed", after a
full compile.

---

## 9. NFL predictions — a separate Project

NFL is being added as a competition type in **this same codebase**
(`competitions.sport = 'nfl'`, `point_rules.scoring_mode = 'margin'`), but the
work is tracked in its own Claude Project with its own brief.

What that means here: expect `sport` and `scoring_mode` columns to appear, and
expect `scoreOnePrediction()` to branch on the mode. Football scoring is
untouched — both columns default to the existing behaviour.

## 10. How Lloyd wants to work

- SQL always as a **downloadable file**, never pasted into chat, and also
  saved into `supabase/migrations` — including read-only check scripts.
- **Never** a SQL file that has to be run in parts, and no placeholder values
  to fill in. One file, one action.
- Deployment steps **in the chat**, not as a document, stating which
  environment each step applies to. Show files in a table saying where each
  one goes — he copies them in himself, so no copy commands.
- One `git add -A` and **one** commit, not changes split across several.
- Don't send files or SQL for decisions that haven't been made yet. Build what
  was asked, or ask — don't deliver things just in case.
- Be explicit about what needs running and what doesn't.
- He has a permanent granted Pro entitlement (`source: granted`,
  `expires_at: null`) and must never be asked to pay.
