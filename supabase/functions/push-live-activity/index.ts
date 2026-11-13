// supabase/functions/push-live-activity/index.ts
//
// Drives the gameweek Live Activity from the server, so the lock screen works
// with the app closed. Runs every two minutes (cron job aloto-live-activity-push).
//
// Three jobs, in this order each run:
//
//   START   When a gameweek's first match kicks off, start an activity on the
//           phone of everyone who predicted in it, using the phone's
//           push-to-start token (iOS 17.2+). Nobody has to open the app.
//
//   UPDATE  Push the provisional points to every running activity.
//
//   END     Once every match in the gameweek has finished, send the final
//           score and end the activity, so it doesn't sit on the lock screen
//           for hours after full time.
//
// THREE SPORTS (12 Nov 2026). The lock screen card is the same for every sport:
// your points, your place and a status line. What feeds it differs:
//   football  fixtures + API-Football statuses, exact score / result points.
//             Exactly as before.
//   nfl       fixtures + API-SPORTS American Football statuses (Q1..Q4, OT),
//             scored on the NFL margin rules (src/lib/sports/nfl/scoring.js).
//             Before this, NFL games used the football codes, so an NFL card
//             could start at halftime showing 0 points.
//   f1        f1_races / f1_results / f1_picks. Starts when the RACE goes
//             live, shows the lap, and your weekend's points "if it finished
//             now" (src/lib/sports/f1/scoring.js). Qualifying and sprints show
//             live in the app only, so a weekend has one card, not four.
//
// APNs for Live Activities differs from ordinary notifications in three ways,
// each of which silently fails if wrong:
//   - the topic gains a ".push-type.liveactivity" suffix
//   - the apns-push-type header must be "liveactivity"
//   - the payload wraps the state in aps.content-state, not aps.alert

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// The same APNs key used for ordinary push. Live Activities do not need a
// separate one.
const APNS_KEY_ID   = Deno.env.get('APNS_KEY_ID')!
const APNS_TEAM_ID  = Deno.env.get('APNS_TEAM_ID')!
const APNS_KEY_P8   = Deno.env.get('APNS_KEY_P8')!        // contents of the .p8
const BUNDLE_ID     = Deno.env.get('APNS_BUNDLE_ID') ?? 'com.alotoprediction.app'

// Apple's LIVE servers for TestFlight and App Store builds; the test (sandbox)
// servers only for builds run straight from Xcode.
//
// This used to default to sandbox, with a comment saying TestFlight used it.
// It doesn't. Every push to a real build was rejected with BadDeviceToken and
// the activity was then marked ended — so updates only ever appeared while the
// app was open. Production is now the default; set APNS_ENVIRONMENT=sandbox
// only when testing an Xcode build.
const APNS_HOST = (Deno.env.get('APNS_ENVIRONMENT') ?? 'production') === 'sandbox'
  ? 'https://api.sandbox.push.apple.com'
  : 'https://api.push.apple.com'

// API-Football statuses.
const IN_PLAY  = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE']
const FINISHED = ['FT', 'AET', 'PEN']

// API-SPORTS American Football statuses (sync-nfl). Final includes overtime.
const NFL_IN_PLAY  = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'HT', 'BT']
const NFL_FINISHED = ['FT', 'AOT']

type Sport = 'football' | 'nfl' | 'f1'
const inPlayCodes  = (sport: Sport) => sport === 'nfl' ? NFL_IN_PLAY : IN_PLAY
const finishedCodes = (sport: Sport) => sport === 'nfl' ? NFL_FINISHED : FINISHED

/* ------------------------------------------------------------------ */

/**
 * A signed JWT for APNs.
 *
 * Cached because Apple rejects tokens refreshed more often than once every 20
 * minutes, and this function runs every couple of minutes during a match.
 */
let cachedJwt: { token: string; madeAt: number } | null = null

async function apnsJwt(): Promise<string> {
  const THIRTY_MINUTES = 30 * 60 * 1000
  if (cachedJwt && Date.now() - cachedJwt.madeAt < THIRTY_MINUTES) {
    return cachedJwt.token
  }

  const header = { alg: 'ES256', kid: APNS_KEY_ID }
  const claims = { iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }

  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const unsigned = `${b64(header)}.${b64(claims)}`

  // The .p8 arrives as PEM text; Deno's crypto wants the raw DER bytes.
  const pem = APNS_KEY_P8
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  )

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  )

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const token = `${unsigned}.${sigB64}`
  cachedJwt = { token, madeAt: Date.now() }
  return token
}

/** Sends one Live Activity push. Never throws. */
async function sendApns(deviceToken: string, payload: unknown) {
  try {
    const jwt = await apnsJwt()
    const res = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        // The suffix is mandatory for Live Activities. Without it Apple
        // returns TopicDisallowed and nothing reaches the phone.
        'apns-topic': `${BUNDLE_ID}.push-type.liveactivity`,
        'apns-push-type': 'liveactivity',
        // 10 = deliver immediately. A goal is not worth throttling.
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const reason = res.ok ? '' : await res.text()
    const dead = res.status === 410 || reason.includes('BadDeviceToken') || reason.includes('Unregistered')
    return { ok: res.ok, status: res.status, reason, dead }
  } catch (err) {
    return { ok: false, status: 0, reason: String(err), dead: false }
  }
}

/* ------------------------------------------------------------------ */

/** One participant's provisional points, plus where the gameweek stands. */
function pointsFor(fixtures: any[], predictions: any[], rules: any) {
  let points = 0

  for (const fx of fixtures) {
    if (fx.status === 'void') continue

    // A confirmed result always wins over live data — the admin was watching,
    // and the feed can be behind or wrong.
    const home = fx.home_score ?? fx.live_home_score
    const away = fx.away_score ?? fx.live_away_score
    if (home == null || away == null) continue

    const p = predictions.find(x => x.fixture_id === fx.id)
    if (!p) continue

    const exact = p.predicted_home === home && p.predicted_away === away
    const result = Math.sign(p.predicted_home - p.predicted_away) === Math.sign(home - away)

    if (result) points += rules.correct_result_points ?? 2
    if (exact)  points += rules.exact_score_points ?? 3
  }

  return points
}

/**
 * NFL points, the same rules as src/lib/sports/nfl/scoring.js marginScore:
 * correct winner, + per exact team score, + ONE margin line. Wrong winner 0.
 * Keep the two in step.
 */
const NFL_DEFAULTS: Record<string, number> = {
  winner_only_points: 2, team_score_points: 5,
  margin_exact_points: 12, margin_within_2_points: 10, margin_within_4_points: 8,
  margin_within_7_points: 6, margin_within_10_points: 4, margin_within_14_points: 2,
}
const NFL_BANDS: [number, string][] = [
  [0, 'margin_exact_points'], [2, 'margin_within_2_points'], [4, 'margin_within_4_points'],
  [7, 'margin_within_7_points'], [10, 'margin_within_10_points'], [14, 'margin_within_14_points'],
]
function nflPointsFor(fixtures: any[], predictions: any[], rules: any) {
  const r = (k: string) => Number(rules?.[k] ?? NFL_DEFAULTS[k]) || 0
  let points = 0
  for (const fx of fixtures) {
    if (fx.status === 'void') continue
    const home = fx.home_score ?? fx.live_home_score
    const away = fx.away_score ?? fx.live_away_score
    if (home == null || away == null) continue
    const p = predictions.find(x => x.fixture_id === fx.id)
    if (!p) continue
    if (Math.sign(p.predicted_home - p.predicted_away) !== Math.sign(home - away)) continue
    points += r('winner_only_points')
    points += ((p.predicted_home === home ? 1 : 0) + (p.predicted_away === away ? 1 : 0)) * r('team_score_points')
    const error = Math.abs((p.predicted_home - p.predicted_away) - (home - away))
    const line = NFL_BANDS.find(([max]) => error <= max)
    if (line) points += r(line[1])
  }
  return points
}

const pointsForSport = (sport: Sport, fixtures: any[], predictions: any[], rules: any) =>
  sport === 'nfl' ? nflPointsFor(fixtures, predictions, rules) : pointsFor(fixtures, predictions, rules)

/** Matches being played right now. Counted across the whole gameweek, not
 *  just the ones this person predicted. */
function inPlayCount(fixtures: any[], sport: Sport = 'football') {
  const codes = inPlayCodes(sport)
  return fixtures.filter(fx =>
    fx.status !== 'void' && fx.home_score == null && codes.includes(fx.live_status)
  ).length
}

/** True once every match has a confirmed or full-time score. */
function allFinished(fixtures: any[], sport: Sport = 'football') {
  const codes = finishedCodes(sport)
  const counted = fixtures.filter(fx => fx.status !== 'void')
  return counted.length > 0 && counted.every(fx =>
    fx.home_score != null || codes.includes(fx.live_status)
  )
}

/** "3 matches in play" / "Full time" — composed here so the wording can change
 *  without shipping a new app build. */
function statusLine(inPlay: number, finished: boolean, sport: Sport = 'football') {
  if (sport === 'nfl') {
    if (finished) return 'Final'
    if (inPlay === 0) return 'Waiting for the next kickoff'
    if (inPlay === 1) return '1 game in play'
    return `${inPlay} games in play`
  }
  if (finished) return 'Full time'
  if (inPlay === 0) return 'Waiting for the next kick-off'
  if (inPlay === 1) return '1 match in play'
  return `${inPlay} matches in play`
}

/* ------------------------------------------------------------------ */

// Per-run caches. Twelve players in one competition share one gameweek.
const fixtureCache = new Map<string, any[]>()
const gameweekCache = new Map<string, any>()
const rulesCache = new Map<string, any>()
const sportCache = new Map<string, Sport>()
const f1RaceCache = new Map<string, any>()

async function fixturesFor(gameweekId: string) {
  if (!fixtureCache.has(gameweekId)) {
    const { data } = await supabase.from('fixtures')
      .select('id, status, home_score, away_score, live_home_score, live_away_score, live_status')
      .eq('gameweek_id', gameweekId)
    fixtureCache.set(gameweekId, data ?? [])
  }
  return fixtureCache.get(gameweekId)!
}

async function gameweekFor(gameweekId: string) {
  if (!gameweekCache.has(gameweekId)) {
    const { data } = await supabase.from('gameweeks')
      .select('id, number, competition_id, competitions(name, sport)')
      .eq('id', gameweekId).single()
    gameweekCache.set(gameweekId, data)
  }
  return gameweekCache.get(gameweekId)
}

async function rulesFor(competitionId: string) {
  if (!rulesCache.has(competitionId)) {
    // Every column: football reads two, NFL the margin lines, F1 its arrays.
    const { data } = await supabase.from('point_rules')
      .select('*')
      .eq('competition_id', competitionId).maybeSingle()
    rulesCache.set(competitionId, data ?? {})
  }
  return rulesCache.get(competitionId)
}

/** Which sport a gameweek belongs to. Defaults to football, as before. */
async function sportFor(gameweekId: string): Promise<Sport> {
  if (sportCache.has(gameweekId)) return sportCache.get(gameweekId)!
  const gw = await gameweekFor(gameweekId)
  let sport = gw?.competitions?.sport as string | undefined
  if (!sport) {
    const { data: links } = await supabase.from('competition_gameweeks')
      .select('competitions(sport)').eq('gameweek_id', gameweekId).limit(1)
    sport = (links?.[0] as any)?.competitions?.sport
  }
  const s: Sport = sport === 'nfl' || sport === 'f1' ? sport : 'football'
  sportCache.set(gameweekId, s)
  return s
}

const standingsCache = new Map<string, Map<string, number>>()

/**
 * Where everyone stands in this gameweek, as a map of user id to position.
 *
 * Worked out ONCE per gameweek and reused for every player in it. Twelve
 * people in one competition would otherwise mean twelve passes over the same
 * predictions, every minute, for the whole of a Saturday.
 *
 * Position is by this gameweek's points among everyone in the competition that
 * owns the gameweek — the same rule the dashboard uses, so the two can never
 * disagree. People level on points SHARE a place: two on 14 are both 3rd, and
 * nobody is 4th. Ranking them arbitrarily would make the arrow on the lock
 * screen move when nothing had actually happened.
 */
async function standingsFor(gameweekId: string, competitionId: string) {
  const key = `${gameweekId}:${competitionId}`
  if (standingsCache.has(key)) return standingsCache.get(key)!

  const [fixtures, rules, sport] = await Promise.all([
    fixturesFor(gameweekId),
    rulesFor(competitionId),
    sportFor(gameweekId),
  ])

  const { data: parts } = await supabase.from('participants')
    .select('user_id').eq('competition_id', competitionId)
  const members = [...new Set((parts ?? []).map(p => p.user_id))]

  const positions = new Map<string, number>()
  if (!members.length) { standingsCache.set(key, positions); return positions }

  // One query for the whole competition rather than one per person.
  const { data: preds } = await supabase.from('predictions')
    .select('user_id, fixture_id, predicted_home, predicted_away')
    .eq('gameweek_id', gameweekId).in('user_id', members)

  const byUser = new Map<string, any[]>()
  for (const p of (preds ?? [])) {
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, [])
    byUser.get(p.user_id)!.push(p)
  }

  const totals = members.map(id => ({
    id,
    points: pointsForSport(sport, fixtures, byUser.get(id) ?? [], rules),
  }))

  for (const t of totals) {
    positions.set(t.id, totals.filter(o => o.points > t.points).length + 1)
  }

  standingsCache.set(key, positions)
  return positions
}

/** Everything the activity shows for one person, as of now. */
async function stateFor(userId: string, gameweekId: string) {
  const sport = await sportFor(gameweekId)
  if (sport === 'f1') return f1StateFor(userId, gameweekId)

  const [fixtures, gw] = await Promise.all([fixturesFor(gameweekId), gameweekFor(gameweekId)])
  const rules = await rulesFor(gw?.competition_id)

  const { data: preds } = await supabase.from('predictions')
    .select('fixture_id, predicted_home, predicted_away')
    .eq('gameweek_id', gameweekId).eq('user_id', userId)

  // The opponent, if there is a cup tie or group fixture this gameweek.
  const { data: opp } = await supabase.rpc('my_gameweek_opponent_for', {
    p_user_id: userId,
    p_gameweek_id: gameweekId,
  })
  const opponent = Array.isArray(opp) ? opp[0] : opp

  let opponentPoints: number | null = null
  if (opponent?.opponent_id) {
    const { data: oppPreds } = await supabase.from('predictions')
      .select('fixture_id, predicted_home, predicted_away')
      .eq('gameweek_id', gameweekId).eq('user_id', opponent.opponent_id)
    opponentPoints = pointsForSport(sport, fixtures, oppPreds ?? [], rules)
  }

  const inPlay = inPlayCount(fixtures, sport)
  const finished = allFinished(fixtures, sport)

  // Where they stand, alongside the tie rather than instead of it. How you are
  // doing against your opponent and how you are doing in the table are
  // different questions, and both move as goals go in.
  const positions = await standingsFor(gameweekId, gw?.competition_id)
  const position = positions.get(userId) ?? null
  const playerCount = positions.size || null

  return {
    gw, opponent, finished, position, playerCount,
    contentState: {
      myPoints: pointsForSport(sport, fixtures, preds ?? [], rules),
      opponentPoints,
      position,
      playerCount,
      // Filled in by the caller, which is the only place that knows where
      // this person stood at the last push.
      positionDelta: null as number | null,
      matchesInPlay: inPlay,
      statusLine: statusLine(inPlay, finished, sport),
    },
  }
}

/* ---- F1 ------------------------------------------------------------- */
// Mirrors src/lib/sports/f1/scoring.js (f1Rules, pointsForPlace). Keep in step.

const F1_RACE_DEFAULT = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
const F1_SPRINT_DEFAULT = [8, 7, 6, 5, 4, 3, 2, 1]

function f1PointsForPlace(session: string, position: number, row: any) {
  const arr = (a: any, d: number[]) => (Array.isArray(a) && a.length ? a : d).map((n: any) => Number(n) || 0)
  if (session === 'grid' || session === 'sprint_grid') {
    return position <= Number(row?.f1_grid_positions ?? 22) ? Number(row?.f1_grid_points ?? 5) : 0
  }
  if (position > Number(row?.f1_race_positions ?? 22)) return 0
  const table = session === 'sprint' ? arr(row?.f1_sprint_points, F1_SPRINT_DEFAULT) : arr(row?.f1_race_points, F1_RACE_DEFAULT)
  return table[position - 1] || 0
}

/** The race behind an F1 gameweek, with its results and every pick, once per run. */
async function f1RaceFor(gameweekId: string) {
  if (!f1RaceCache.has(gameweekId)) {
    const { data: race } = await supabase.from('f1_races').select('*').eq('gameweek_id', gameweekId).maybeSingle()
    let results: any[] = [], picks: any[] = []
    if (race) {
      const [{ data: res }, { data: pk }] = await Promise.all([
        supabase.from('f1_results').select('session, position, driver_id').eq('race_id', race.id),
        supabase.from('f1_picks').select('session, position, driver_id, user_id').eq('race_id', race.id),
      ])
      results = res ?? []; picks = pk ?? []
    }
    f1RaceCache.set(gameweekId, { race, results, picks })
  }
  return f1RaceCache.get(gameweekId)!
}

/** One player's points for the whole weekend so far, live results included. */
function f1PointsFor(userId: string, results: any[], picks: any[], rules: any) {
  const at = new Map(results.filter(r => r.position).map(r => [`${r.session}:${r.position}`, r.driver_id]))
  let points = 0
  for (const p of picks) {
    if (p.user_id !== userId) continue
    if (at.get(`${p.session}:${p.position}`) === p.driver_id) points += f1PointsForPlace(p.session, p.position, rules)
  }
  return points
}

function f1Finished(race: any, results: any[]) {
  if (!race) return true
  if (race.status === 'cancelled') return true
  if (race.live_session === 'race') return false
  const hasRace = results.some(r => r.session === 'race' && r.position)
  return Date.now() > +new Date(race.race_at) + 30 * 60 * 1000 && (race.race_confirmed || hasRace)
}

function f1StatusLine(race: any, finished: boolean) {
  if (finished) return 'Chequered flag'
  if (race?.live_session === 'race' && race.live_lap) {
    return race.total_laps ? `Lap ${race.live_lap} of ${race.total_laps}` : `Lap ${race.live_lap}`
  }
  return race?.live_session === 'race' ? 'Race under way' : 'Waiting for the start'
}

async function f1StateFor(userId: string, gameweekId: string) {
  const gw = await gameweekFor(gameweekId)
  const rules = await rulesFor(gw?.competition_id)
  const { race, results, picks } = await f1RaceFor(gameweekId)

  // Places by weekend points among everyone in the league, ties shared: the
  // same rule as football.
  const key = `${gameweekId}:${gw?.competition_id}`
  if (!standingsCache.has(key)) {
    const { data: parts } = await supabase.from('participants')
      .select('user_id').eq('competition_id', gw?.competition_id)
    const members = [...new Set((parts ?? []).map(p => p.user_id))]
    const totals = members.map(id => ({ id, points: f1PointsFor(id, results, picks, rules) }))
    const positions = new Map<string, number>()
    for (const t of totals) positions.set(t.id, totals.filter(o => o.points > t.points).length + 1)
    standingsCache.set(key, positions)
  }
  const positions = standingsCache.get(key)!
  const position = positions.get(userId) ?? null
  const playerCount = positions.size || null
  const finished = f1Finished(race, results)

  return {
    gw, opponent: null as any, finished, position, playerCount,
    contentState: {
      myPoints: f1PointsFor(userId, results, picks, rules),
      opponentPoints: null as number | null,
      position,
      playerCount,
      positionDelta: null as number | null,
      matchesInPlay: race?.live_session === 'race' ? 1 : 0,
      statusLine: f1StatusLine(race, finished),
    },
  }
}

/** "Las Vegas Grand Prix" -> "Las Vegas", so it fits on one line in the card. */
const shortRaceName = (name: string) => name.replace(/\s*Grand Prix$/i, '').trim()

/* ---- START ---------------------------------------------------------- */

async function startNew(result: any) {
  // Gameweeks with a match in play right now, kicked off in the last 4 hours.
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: liveFx } = await supabase.from('fixtures')
    .select('gameweek_id')
    .in('live_status', [...IN_PLAY, ...NFL_IN_PLAY])
    .is('home_score', null)
    .gte('kickoff_time', since)

  const gameweekIds = [...new Set((liveFx ?? []).map(f => f.gameweek_id).filter(Boolean))]

  // F1: the race itself is live (qualifying and sprints show in the app only).
  const { data: liveRaces } = await supabase.from('f1_races')
    .select('gameweek_id').eq('live_session', 'race').gte('race_at', since)
  for (const r of (liveRaces ?? [])) if (r.gameweek_id && !gameweekIds.includes(r.gameweek_id)) gameweekIds.push(r.gameweek_id)

  for (const gameweekId of gameweekIds) {
    const gw = await gameweekFor(gameweekId)
    if (!gw) continue
    const sport = await sportFor(gameweekId)
    // Each sport only on its own codes: an NFL game at halftime must not start
    // a football card, and vice versa.
    if (sport !== 'f1' && inPlayCount(await fixturesFor(gameweekId), sport) === 0) continue

    // Everyone in any competition that uses this gameweek.
    const { data: links } = await supabase.from('competition_gameweeks')
      .select('competition_id').eq('gameweek_id', gameweekId)
    const compIds = [...new Set([gw.competition_id, ...(links ?? []).map(l => l.competition_id)])]

    const { data: parts } = await supabase.from('participants')
      .select('user_id').in('competition_id', compIds)
    const members = [...new Set((parts ?? []).map(p => p.user_id))]
    if (!members.length) continue

    // Only people actually playing this gameweek — someone who hasn't
    // predicted has nothing to watch.
    let players: string[]
    if (sport === 'f1') {
      const { picks } = await f1RaceFor(gameweekId)
      const memberSet = new Set(members)
      players = [...new Set(picks.map((p: any) => p.user_id).filter((u: string) => memberSet.has(u)))]
    } else {
      const { data: predicted } = await supabase.from('predictions')
        .select('user_id').eq('gameweek_id', gameweekId).in('user_id', members)
      players = [...new Set((predicted ?? []).map(p => p.user_id))]
    }
    if (!players.length) continue

    // Skip anyone who already has one for this gameweek — started by the
    // server earlier, or by the app because they had it open. That includes
    // one they've swiped away: starting it again would be nagging.
    const { data: existing } = await supabase.from('live_activity_tokens')
      .select('user_id').eq('gameweek_id', gameweekId).in('user_id', players)
    const covered = new Set((existing ?? []).map(e => e.user_id))
    const toStart = players.filter(u => !covered.has(u))
    if (!toStart.length) continue

    const { data: startTokens } = await supabase.from('live_activity_start_tokens')
      .select('token, user_id').in('user_id', toStart)
    if (!startTokens?.length) continue

    const { data: profiles } = await supabase.from('profiles')
      .select('id, display_name, badge_kit').in('id', toStart)
    const profileById = new Map((profiles ?? []).map(p => [p.id, p]))

    const f1Race = sport === 'f1' ? (await f1RaceFor(gameweekId)).race : null
    const label = f1Race?.name ? shortRaceName(f1Race.name) : String(gw.number ?? '')
    const alert = sport === 'f1'
      ? { title: `${label} is under way`, body: 'Your points and place will update here, lap by lap.' }
      : sport === 'nfl'
        ? { title: `${label} is under way`, body: 'Your points will update here as the scores come in.' }
        : { title: `${label} is under way`, body: 'Your score will update here as the goals go in.' }

    for (const st of startTokens) {
      const { opponent, contentState, position } = await stateFor(st.user_id, gameweekId)
      const me = profileById.get(st.user_id)
      const ref = crypto.randomUUID()

      // Recorded BEFORE the push, so the phone's reply always has a row to land on.
      const { error: insertError } = await supabase.from('live_activity_tokens')
        .insert({
          user_id: st.user_id, gameweek_id: gameweekId, ref,
          started_at: new Date().toISOString(),
          last_position: position ?? null,
        })
      if (insertError) { result.errors.push(`record: ${insertError.message}`); continue }

      const payload = {
        aps: {
          timestamp: Math.floor(Date.now() / 1000),
          event: 'start',
          'content-state': contentState,
          'attributes-type': 'GameweekActivityAttributes',
          // These keys must match GameweekActivityAttributes.swift exactly.
          attributes: {
            competitionName: opponent?.competition_name || gw.competitions?.name || '',
            gameweekLabel: label,
            myName: me?.display_name ?? '',
            myKit: me?.badge_kit ?? null,
            opponentName: opponent?.opponent_name ?? null,
            opponentKit: opponent?.opponent_kit ?? null,
            roundLabel: opponent?.round_label ?? null,
            ref,
          },
          alert,
        },
      }

      const sent = await sendApns(st.token, payload)
      if (sent.ok) {
        result.started++
      } else {
        // Nothing reached the phone, so the record goes too — otherwise the
        // next run would think this person already has one.
        await supabase.from('live_activity_tokens').delete().eq('ref', ref)
        if (sent.dead) {
          await supabase.from('live_activity_start_tokens').delete().eq('token', st.token)
        }
        result.failed++
        result.errors.push(`start ${sent.status}: ${sent.reason.slice(0, 120)}`)
      }
    }
  }
}

/* ---- UPDATE and END ------------------------------------------------- */

async function updateRunning(result: any) {
  const { data: rpcActivities, error } = await supabase.rpc('activities_needing_push')
  if (error) { result.errors.push(`activities: ${error.message}`); return }

  // NFL and F1 cards are read straight from the table as well, in case
  // activities_needing_push only looks at football fixtures. Football is
  // left to the function exactly as before.
  const activities: any[] = [...(rpcActivities ?? [])]
  const seen = new Set(activities.map((a: any) => a.activity_id))
  const { data: open } = await supabase.from('live_activity_tokens')
    .select('activity_id, user_id, gameweek_id, token')
    .is('ended_at', null).not('activity_id', 'is', null).not('token', 'is', null)
    .gte('started_at', new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString())
  for (const a of (open ?? [])) {
    if (seen.has(a.activity_id)) continue
    if ((await sportFor(a.gameweek_id)) === 'football') continue
    activities.push(a); seen.add(a.activity_id)
  }

  // Where everyone stood at the last push, in one query. This is what makes
  // the arrow on the lock screen possible: the phone has no memory of the
  // previous push, so the movement has to be worked out here and sent.
  const ids = (activities ?? []).map((a: any) => a.activity_id).filter(Boolean)
  const lastPositions = new Map<string, number>()
  if (ids.length) {
    const { data: rows } = await supabase.from('live_activity_tokens')
      .select('activity_id, last_position').in('activity_id', ids)
    for (const r of (rows ?? [])) {
      if (r.last_position != null) lastPositions.set(r.activity_id, r.last_position)
    }
  }

  for (const act of activities ?? []) {
    try {
      const { finished, contentState, position } = await stateFor(act.user_id, act.gameweek_id)

      // Places GAINED, so positive is up. Lower numbers are better positions,
      // which makes the subtraction read backwards unless you say so.
      const previous = lastPositions.get(act.activity_id)
      contentState.positionDelta =
        position != null && previous != null ? previous - position : null
      const now = Math.floor(Date.now() / 1000)

      const payload = finished
        ? {
            aps: {
              timestamp: now,
              event: 'end',
              'content-state': contentState,
              // Left up for 15 minutes so the final score can be seen, then
              // cleared. Without this iOS keeps it for up to four hours.
              'dismissal-date': now + 15 * 60,
            },
          }
        : {
            aps: {
              timestamp: now,
              event: 'update',
              'content-state': contentState,
            },
          }

      const sent = await sendApns(act.token, payload)

      if (sent.ok) {
        await supabase.from('live_activity_tokens')
          .update({
            last_push_at: new Date().toISOString(),
            push_failures: 0,
            // Only after a successful push: if it never arrived, the phone is
            // still showing the old position and the next delta must be
            // measured from that, not from one nobody saw.
            last_position: position ?? null,
            ...(finished ? { ended_at: new Date().toISOString() } : {}),
          })
          .eq('activity_id', act.activity_id)
        if (finished) result.ended++
        else result.pushed++
      } else if (sent.dead) {
        // A dead token is ended rather than retried. Apple says so explicitly.
        await supabase.from('live_activity_tokens')
          .update({ ended_at: new Date().toISOString() })
          .eq('activity_id', act.activity_id)
        result.skipped++
      } else {
        await supabase.rpc('increment_push_failure', { p_activity_id: act.activity_id })
        result.failed++
        result.errors.push(`${sent.status}: ${sent.reason.slice(0, 120)}`)
      }
    } catch (err) {
      result.failed++
      result.errors.push(String(err).slice(0, 160))
    }
  }
}

async function run() {
  fixtureCache.clear(); gameweekCache.clear(); rulesCache.clear(); standingsCache.clear()
  sportCache.clear(); f1RaceCache.clear()
  const result = { started: 0, pushed: 0, ended: 0, failed: 0, skipped: 0, errors: [] as string[] }

  // Tidy up anything abandoned before spending requests on it.
  await supabase.rpc('expire_stale_activities')

  await startNew(result)
  await updateRunning(result)
  return result
}

Deno.serve(async (_req) => {
  try {
    const result = await run()
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('push-live-activity failed:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
