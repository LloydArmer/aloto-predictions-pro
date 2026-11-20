// supabase/functions/sync-lms/index.ts
//
// Last Man Standing: fixtures, results and league tables from API-Sports,
// settling each gameweek, and the notifications. See migration 126 for the
// rules. Works for any football league API-Sports covers and for the NFL.
//
// Modes, chosen by the `mode` field in the request body:
//
//   run       (default, every 10 minutes from pg_cron, see 127)
//             1. For each league a game is using, refreshes the fixtures and
//                results, and the league table, but only when it needs to.
//             2. Calls lms_settle(): at the deadline (first kick-off) any
//                entry with no pick is given the lowest-placed team; when
//                every game in a gameweek has finished, entries go through or
//                are out, and a game ends when one player is left (or none).
//             3. Sends "you're through / you're out / you've won", the
//                automatic-pick notice and the pick reminders (24 hours and
//                2 hours before the deadline).
//   fixtures  { sport: 'football' | 'nfl', league_id } Load a league's season
//             now, for an admin setting up a game. Admins of a Last Man
//             Standing only; a league is refreshed at most every 5 minutes.
//
// API COST: one request returns a whole season, one more the league table.
// The run only asks when a game is open or running in that league AND
//   - a game in the gameweek being played should have finished by now and
//     has no result yet (at most every 20 minutes), or
//   - the fixture list is more than 6 hours old (rearranged games), or
//   - the league table is more than 12 hours old.
// Football shares the API-Football daily quota (api_sync_log) with
// sync-football; the NFL shares the NFL quota (nfl_sync_log) with sync-nfl.
//
// Self-contained on purpose: the push code is copied from _shared/push.ts so
// this can be pasted into the Supabase dashboard editor as one file.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Sport = 'football' | 'nfl'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const FINISHED = ['FT', 'AET', 'PEN', 'AWD', 'WO', 'AOT']
const VOID = ['PST', 'CANC', 'ABD']
const RESERVE = 10
const NFL_LEAGUE = 1

const API = {
  football: {
    host: 'https://v3.football.api-sports.io',
    key: Deno.env.get('API_FOOTBALL_KEY') ?? '',
    keyName: 'API_FOOTBALL_KEY',
    dailyLimit: Number(Deno.env.get('API_FOOTBALL_DAILY_LIMIT') ?? '100'),
  },
  nfl: {
    host: 'https://v1.american-football.api-sports.io',
    key: Deno.env.get('API_NFL_KEY') ?? Deno.env.get('API_FOOTBALL_KEY') ?? '',
    keyName: 'API_NFL_KEY (or API_FOOTBALL_KEY)',
    dailyLimit: Number(Deno.env.get('API_NFL_DAILY_LIMIT') ?? '7500'),
  },
}

const APP_URL = Deno.env.get('APP_URL') || 'https://aloto-prediction-pro.netlify.app'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

/* ------------------------------------------------------------------ */
/* API-Sports                                                          */
/* ------------------------------------------------------------------ */

async function apiGet(sport: Sport, path: string, params: Record<string, string> = {}) {
  const api = API[sport]
  const url = new URL(api.host + path)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url, { headers: { 'x-apisports-key': api.key } })
  const body = await res.json()
  await logRequest(sport)
  const errors = body.errors
  if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)) {
    if (errors.plan) throw new Error(`API plan limit: ${errors.plan}`)
    if (errors.token || errors.key) throw new Error(`The API key was rejected. Check ${api.keyName} in Edge Function secrets.`)
    if (errors.requests) throw new Error(`Daily request limit reached: ${errors.requests}`)
    throw new Error(`API error: ${JSON.stringify(errors)}`)
  }
  return body.response ?? []
}

/** Counts the request against the right daily quota. */
async function logRequest(sport: Sport) {
  if (sport === 'nfl') await supabase.from('nfl_sync_log').insert({ kind: 'lms', requests_used: 1 })
  else await supabase.from('api_sync_log').insert({ kind: 'lms', requests_used: 1 })
}

async function logError(message: string) {
  await supabase.from('api_sync_log').insert({ kind: 'lms', requests_used: 0, error: message })
}

async function quotaRemaining(sport: Sport): Promise<number> {
  const { data } = await supabase.rpc(sport === 'nfl' ? 'nfl_requests_used_today' : 'api_requests_used_today')
  return API[sport].dailyLimit - RESERVE - (data ?? 0)
}

/** The season to load for a league that has no games yet. */
async function seasonToLoad(sport: Sport, leagueId: number): Promise<number> {
  const now = new Date()
  if (sport === 'nfl') {
    // Named for the year it starts: January and February belong to last year's.
    return now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  }
  const { data } = await supabase.from('api_leagues').select('current_season').eq('id', leagueId).maybeSingle()
  if (data?.current_season) return Number(data.current_season)
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

/** "Regular Season - 12" -> 12; NFL "Week 12" -> 12. Anything else is skipped. */
function footballRound(round: string | null | undefined): number | null {
  const m = String(round ?? '').match(/Regular Season\s*-\s*(\d+)/i)
  return m ? Number(m[1]) : null
}
function nflWeek(week: string | null | undefined): number | null {
  const m = String(week ?? '').match(/(\d+)/)
  return m ? Number(m[1]) : null
}

/** A whole season's fixtures in one request. */
async function refreshFixtures(sport: Sport, leagueId: number, season: number) {
  const stamp = new Date().toISOString()
  let rows: any[]

  if (sport === 'nfl') {
    const list = await apiGet('nfl', '/games', { league: String(leagueId), season: String(season) })
    rows = list
      .filter((g: any) => /regular/i.test(g.game?.stage ?? ''))
      .map((g: any) => ({
        sport, league_id: leagueId, season,
        api_fixture_id: g.game.id,
        round: nflWeek(g.game?.week),
        kickoff: new Date(Number(g.game.date.timestamp) * 1000).toISOString(),
        status: g.game.status?.short ?? 'NS',
        home_team_id: g.teams.home.id,
        home_team: g.teams.home.name,
        away_team_id: g.teams.away.id,
        away_team: g.teams.away.name,
        home_goals: g.scores?.home?.total ?? null,
        away_goals: g.scores?.away?.total ?? null,
        updated_at: stamp,
      }))
  } else {
    const list = await apiGet('football', '/fixtures', { league: String(leagueId), season: String(season) })
    rows = list.map((f: any) => ({
      sport, league_id: leagueId, season,
      api_fixture_id: f.fixture.id,
      round: footballRound(f.league?.round),
      kickoff: f.fixture.date,
      status: f.fixture.status?.short ?? 'NS',
      home_team_id: f.teams.home.id,
      home_team: f.teams.home.name,
      away_team_id: f.teams.away.id,
      away_team: f.teams.away.name,
      home_goals: f.goals?.home ?? null,
      away_goals: f.goals?.away ?? null,
      updated_at: stamp,
    }))
  }

  rows = rows.filter(r => r.round != null && r.home_team_id && r.away_team_id)
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('lms_fixtures').upsert(rows.slice(i, i + 200), { onConflict: 'sport,api_fixture_id' })
    if (error) throw new Error(`Saving fixtures failed: ${error.message}`)
  }
  await supabase.from('lms_sync_state').upsert(
    { sport, league_id: leagueId, season, fixtures_at: stamp }, { onConflict: 'sport,league_id,season' })
  return rows.length
}

/**
 * The league table, as positions 1 (top) to N (bottom). Football uses the
 * feed's rank (a league split into groups is ranked by points, then goal
 * difference). The NFL is ranked across the whole league by win percentage,
 * then points difference, so the "lowest-placed team" is the worst record.
 */
async function refreshStandings(sport: Sport, leagueId: number, season: number) {
  const stamp = new Date().toISOString()
  let table: Array<{ team_id: number; team_name: string; score: number[] }> = []

  if (sport === 'nfl') {
    const list = await apiGet('nfl', '/standings', { league: String(leagueId), season: String(season) })
    const seen = new Set<number>()
    for (const s of list) {
      if (!s.team?.id || seen.has(s.team.id)) continue
      seen.add(s.team.id)
      const w = Number(s.won ?? 0), l = Number(s.lost ?? 0), t = Number(s.ties ?? 0)
      const played = w + l + t
      table.push({
        team_id: s.team.id, team_name: s.team.name,
        score: [played ? (w + t / 2) / played : 0, Number(s.points?.for ?? 0) - Number(s.points?.against ?? 0)],
      })
    }
  } else {
    const list = await apiGet('football', '/standings', { league: String(leagueId), season: String(season) })
    const groups: any[][] = list?.[0]?.league?.standings ?? []
    const seen = new Set<number>()
    const single = groups.length === 1
    for (const group of groups) {
      for (const s of group) {
        if (!s.team?.id || seen.has(s.team.id)) continue
        seen.add(s.team.id)
        table.push({
          team_id: s.team.id, team_name: s.team.name,
          score: single ? [-Number(s.rank ?? 999), 0] : [Number(s.points ?? 0), Number(s.goalsDiff ?? 0)],
        })
      }
    }
  }

  if (!table.length) return 0
  table.sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1] || a.team_name.localeCompare(b.team_name))
  const rows = table.map((t, i) => ({
    sport, league_id: leagueId, season, team_id: t.team_id, team_name: t.team_name, position: i + 1, updated_at: stamp,
  }))
  const { error } = await supabase.from('lms_standings').upsert(rows, { onConflict: 'sport,league_id,season,team_id' })
  if (error) throw new Error(`Saving the league table failed: ${error.message}`)
  await supabase.from('lms_sync_state').upsert(
    { sport, league_id: leagueId, season, standings_at: stamp }, { onConflict: 'sport,league_id,season' })
  return rows.length
}

async function syncState(sport: Sport, leagueId: number, season: number) {
  const { data } = await supabase.from('lms_sync_state').select('fixtures_at, standings_at')
    .eq('sport', sport).eq('league_id', leagueId).eq('season', season).maybeSingle()
  return {
    fixturesAt: data?.fixtures_at ? +new Date(data.fixtures_at) : 0,
    standingsAt: data?.standings_at ? +new Date(data.standings_at) : 0,
  }
}

/** Why the fixtures need refreshing now, or null. */
async function fixturesNeeded(sport: Sport, leagueId: number, season: number, rounds: number[], fixturesAt: number) {
  const now = Date.now()
  if (!fixturesAt) return 'no fixtures yet'
  if (now - fixturesAt > 6 * HOUR) return 'list over 6 hours old'
  if (now - fixturesAt < 20 * MIN) return null

  // A game in a gameweek someone is playing that should be over by now
  // (football about 2 hours, NFL about 3.5 hours after kick-off).
  const length = sport === 'nfl' ? 210 * MIN : 110 * MIN
  const { data: waiting } = await supabase.from('lms_fixtures')
    .select('api_fixture_id, status')
    .eq('sport', sport).eq('league_id', leagueId).eq('season', season)
    .in('round', rounds)
    .lt('kickoff', new Date(now - length).toISOString())
    .gt('kickoff', new Date(now - 3 * 24 * HOUR).toISOString())
  const unfinished = (waiting ?? []).filter(f => !FINISHED.includes(f.status) && !VOID.includes(f.status))
  return unfinished.length ? `${unfinished.length} result(s) due` : null
}

/** Refreshes every league an open or running game is using, as needed. */
async function refreshLeagues() {
  const { data: games } = await supabase.from('lms_games')
    .select('sport, league_id, season, current_round').in('status', ['open', 'running'])
  const leagues = new Map<string, { sport: Sport; league_id: number; season: number; rounds: number[] }>()
  for (const g of games ?? []) {
    const k = `${g.sport}:${g.league_id}:${g.season}`
    if (!leagues.has(k)) leagues.set(k, { sport: g.sport, league_id: g.league_id, season: g.season, rounds: [] })
    leagues.get(k)!.rounds.push(g.current_round)
  }

  const done: unknown[] = []
  for (const l of leagues.values()) {
    try {
      const state = await syncState(l.sport, l.league_id, l.season)
      const why = await fixturesNeeded(l.sport, l.league_id, l.season, l.rounds, state.fixturesAt)
      const tableDue = Date.now() - state.standingsAt > 12 * HOUR
      if (!why && !tableDue) continue
      if (await quotaRemaining(l.sport) <= 0) { done.push({ ...l, skipped: 'Daily API quota reached' }); continue }
      const entry: Record<string, unknown> = { sport: l.sport, league_id: l.league_id }
      if (why) { entry.fixtures = await refreshFixtures(l.sport, l.league_id, l.season); entry.why = why }
      if (tableDue) entry.table = await refreshStandings(l.sport, l.league_id, l.season)
      done.push(entry)
    } catch (err) {
      // One league failing must not stop the others settling.
      const message = String(err instanceof Error ? err.message : err)
      await logError(`${l.sport} ${l.league_id}: ${message}`)
      done.push({ ...l, error: message })
    }
  }
  return done
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

type Note = { user_id: string; title: string; body: string; link: string; kind: string; tag: string }

function messageFor(e: any, sports: Map<string, Sport>): Note | null {
  const link = `${APP_URL}/?competition=${e.competition_id}`
  const word = sports.get(e.game_id) === 'nfl' ? 'Week ' : 'GW'
  const gw = `${word}${e.round}`
  const next = `${word}${e.next_round}`
  const entry = e.entry_no > 1 ? ` (entry ${e.entry_no})` : ''
  const tag = `lms:${e.game_id}:${e.round}:${e.kind}:${e.entry_no ?? ''}`

  switch (e.kind) {
    case 'through':
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `You're through! ✅ ${e.competition}`,
        body: e.void
          ? `${e.team}'s game was called off, so you go through${entry}. ${e.left} left. Pick for ${next} now.`
          : `${e.team} won in ${gw}${entry}. ${e.left} left. Pick your ${next} team now.`,
      }
    case 'out':
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `You're out ❌ ${e.competition}`,
        body: (e.reason === 'no_pick'
          ? `No team left to give you in ${gw}${entry}.`
          : `${e.team} ${e.reason === 'drew' ? 'drew' : 'lost'} in ${gw}${entry}.`)
          + (e.no_winner ? ` Nobody's left, so the ${e.pot} points carry over to the next game.` : ''),
      }
    case 'winner':
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `Last Man Standing! 🏆 ${e.competition}`,
        body: `You're the last one left and win ${e.pot} bragging points. Bragging rights are yours.`,
      }
    case 'autopick':
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `No pick, so you've got ${e.team} 🎲 ${e.competition}`,
        body: `You didn't pick for ${gw}, so you were given the lowest-placed team you hadn't used: ${e.team}. Good luck!`,
      }
    case 'remind_24h':
    case 'remind_2h': {
      const when = new Date(e.lock_at).toLocaleString('en-GB', {
        timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit',
      })
      const what = e.missing > 1 ? `${e.missing} of your entries need a team` : 'Pick your team'
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `${what} ⏳ ${e.competition}`,
        body: `${e.kind === 'remind_2h' ? 'Under 2 hours left' : 'Picks lock'} at ${when}. No pick and you get the lowest-placed team.`,
      }
    }
  }
  return null
}

async function sendAll(notes: Note[]) {
  if (!notes.length) return { sent: 0 }

  const userIds = [...new Set(notes.map(n => n.user_id))]
  const [{ data: profiles }, { data: tokens }] = await Promise.all([
    supabase.from('profiles').select('id, notify_push').in('id', userIds),
    supabase.from('push_tokens').select('id, user_id, token, platform').in('user_id', userIds),
  ])

  const muted = new Set((profiles ?? []).filter(p => p.notify_push === false).map(p => p.id))
  const byUser = new Map<string, Array<{ id: string; token: string; platform: string }>>()
  for (const t of tokens ?? []) {
    if (!byUser.has(t.user_id)) byUser.set(t.user_id, [])
    byUser.get(t.user_id)!.push({ id: t.id, token: t.token, platform: t.platform || 'web' })
  }

  const needsFcm = [...byUser.values()].some(ds => ds.some(d => d.platform !== 'ios'))
  let fcmToken = ''
  if (needsFcm) {
    try {
      fcmToken = await getAccessToken(Deno.env.get('FCM_CLIENT_EMAIL')!, Deno.env.get('FCM_PRIVATE_KEY')!)
    } catch (err) {
      console.warn('FCM auth failed:', String(err).slice(0, 160))
    }
  }
  const fcmProject = Deno.env.get('FCM_PROJECT_ID') ?? ''

  let sent = 0
  const stale: string[] = []
  for (const n of notes) {
    if (muted.has(n.user_id)) continue
    for (const d of byUser.get(n.user_id) ?? []) {
      let outcome: SendResult
      if (d.platform === 'ios') outcome = await sendApnsPush(d.token, n.title, n.body, n.link, n.kind)
      else if (fcmToken) outcome = await sendFcmPush(fcmProject, fcmToken, d.token, n.title, n.body, n.link, n.kind, n.tag)
      else outcome = 'failed'
      if (outcome === 'sent') sent++
      if (outcome === 'stale') stale.push(d.id)
    }
  }
  if (stale.length) await supabase.from('push_tokens').delete().in('id', stale)
  return { sent, stale: stale.length }
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

async function run() {
  const out: Record<string, unknown> = {}
  out.leagues = await refreshLeagues()

  const { data: events, error: settleError } = await supabase.rpc('lms_settle')
  if (settleError) throw new Error(`lms_settle failed: ${settleError.message}`)

  const { data: reminders, error: remindError } = await supabase.rpc('lms_due_reminders')
  if (remindError) throw new Error(`lms_due_reminders failed: ${remindError.message}`)

  const all = [...(events ?? []), ...(reminders ?? [])]
  const gameIds = [...new Set(all.map((e: any) => e.game_id))]
  const sports = new Map<string, Sport>()
  if (gameIds.length) {
    const { data: gs } = await supabase.from('lms_games').select('id, sport').in('id', gameIds)
    for (const g of gs ?? []) sports.set(g.id, g.sport)
  }

  const notes = all.map(e => messageFor(e, sports)).filter(Boolean) as Note[]
  out.events = (events ?? []).length
  out.reminders = (reminders ?? []).length
  out.push = await sendAll(notes)
  return out
}

/** Admin set-up: load a league's season now and say which gameweeks are ahead. */
async function loadLeague(sport: Sport, leagueId: number) {
  const season = await seasonToLoad(sport, leagueId)
  const state = await syncState(sport, leagueId, season)
  const out: Record<string, unknown> = { ok: true, sport, league_id: leagueId, season }

  if (Date.now() - state.fixturesAt > 5 * MIN) {
    if (await quotaRemaining(sport) <= 0) return { ok: false, error: 'Daily API request limit reached. Try again tomorrow.' }
    out.fixtures = await refreshFixtures(sport, leagueId, season)
    if (!out.fixtures) return { ok: false, error: `No ${season} regular-season fixtures found for this league.` }
  }
  if (Date.now() - state.standingsAt > 5 * MIN) {
    try { out.table = await refreshStandings(sport, leagueId, season) } catch (_) { /* table can follow later */ }
  }
  return out
}

async function callerId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data } = await supabase.auth.getUser(jwt)
  return data?.user?.id ?? null
}

async function runsALastManStanding(userId: string | null) {
  if (!userId) return false
  const { data } = await supabase.from('participants')
    .select('competition_id, competitions!inner(format)')
    .eq('user_id', userId).eq('role', 'admin')
    .eq('competitions.format', 'last_man_standing')
    .limit(1)
  return !!data?.length
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))

    if (body.mode === 'fixtures') {
      if (!await runsALastManStanding(await callerId(req))) {
        return json({ ok: false, error: 'Only the admin of a Last Man Standing can load fixtures.' })
      }
      const sport: Sport = body.sport === 'nfl' ? 'nfl' : 'football'
      const leagueId = sport === 'nfl' ? NFL_LEAGUE : Number(body.league_id)
      if (!leagueId) return json({ ok: false, error: 'Choose a league first.' })
      return json(await loadLeague(sport, leagueId))
    }

    return json({ ok: true, ...(await run()) })
  } catch (err) {
    await logError(String(err instanceof Error ? err.message : err))
    // 200 with ok:false, as sync-football: functions.invoke drops the body of
    // a non-2xx, and the admin needs to see the real reason.
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) })
  }
})

/* ------------------------------------------------------------------ */
/* Push sending, copied from _shared/push.ts (see the note at the top) */
/* ------------------------------------------------------------------ */

type SendResult = 'sent' | 'stale' | 'failed'

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const raw = atob(body)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf.buffer
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  const now = Math.floor(Date.now() / 1000)
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })}`
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`FCM auth failed: ${data.error_description || data.error || res.status}`)
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return data.access_token
}

async function sendFcmPush(
  projectId: string, accessToken: string, token: string,
  title: string, body: string, link: string, kind: string, tag?: string,
): Promise<SendResult> {
  // Data only: the service worker is the one place the notification is shown.
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: { token, data: { title, body, url: link, kind, tag: tag ?? kind }, webpush: { headers: { Urgency: 'high' } } },
    }),
  })
  if (res.ok) return 'sent'
  const err = await res.json().catch(() => ({}))
  const status = err?.error?.status
  if (res.status === 404 || status === 'NOT_FOUND' || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') return 'stale'
  return 'failed'
}

const APNS_KEY_ID  = Deno.env.get('APNS_KEY_ID') ?? ''
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') ?? ''
const APNS_KEY_P8  = Deno.env.get('APNS_KEY_P8') ?? ''
const APNS_BUNDLE  = Deno.env.get('APNS_BUNDLE_ID') ?? 'com.alotoprediction.app'
const APNS_HOST = (Deno.env.get('APNS_ENVIRONMENT') ?? 'production') === 'sandbox'
  ? 'https://api.sandbox.push.apple.com'
  : 'https://api.push.apple.com'

let apnsJwtCache: { token: string; madeAt: number } | null = null

async function apnsJwt(): Promise<string> {
  if (apnsJwtCache && Date.now() - apnsJwtCache.madeAt < 30 * 60 * 1000) return apnsJwtCache.token
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const unsigned = `${enc({ alg: 'ES256', kid: APNS_KEY_ID })}.${enc({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`
  const pem = APNS_KEY_P8
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const token = `${unsigned}.${sigB64}`
  apnsJwtCache = { token, madeAt: Date.now() }
  return token
}

async function sendApnsPush(deviceToken: string, title: string, body: string, link: string, kind: string): Promise<SendResult> {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_KEY_P8) return 'failed'
  try {
    const jwt = await apnsJwt()
    const res = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': APNS_BUNDLE,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, url: link, kind }),
    })
    if (res.ok) return 'sent'
    const reason = await res.text()
    if (res.status === 410 || reason.includes('BadDeviceToken') || reason.includes('Unregistered')) return 'stale'
    console.warn('APNs push failed:', res.status, reason.slice(0, 160))
    return 'failed'
  } catch (err) {
    console.warn('APNs push threw:', String(err).slice(0, 160))
    return 'failed'
  }
}
