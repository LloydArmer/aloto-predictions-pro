// supabase/functions/sync-lms/index.ts
//
// Last Man Standing: the Premier League fixture list, settling each gameweek,
// and the notifications. See migration 123 for the rules.
//
// Modes, chosen by the `mode` field in the request body:
//
//   run       (default, every 10 minutes from pg_cron, see 124)
//             1. Refreshes the Premier League fixtures and results from
//                API-Football, but only when it needs to (below).
//             2. Calls lms_settle(): when every game in a gameweek has
//                finished, players go through or are out, and a game ends
//                when one player is left (or none).
//             3. Sends "you're through / you're out / you've won" and the pick
//                reminders (24 hours and 2 hours before the deadline).
//   fixtures  Refresh the fixture list now. For an admin setting up a game
//             before the scheduled job has loaded the season. Admins of a Last
//             Man Standing only, at most once every 5 minutes.
//
// API COST: one request returns the whole season (380 fixtures), so a refresh
// is always one request. The run only makes one when a Last Man Standing game
// is open or running AND either
//   - a game in a gameweek being played should have finished by now (kicked
//     off over 1 hour 50 minutes ago) and has no result yet, at most every
//     20 minutes, or
//   - the list is more than 6 hours old (rearranged fixtures).
// It shares the football daily quota (api_sync_log) with sync-football.
//
// Self-contained on purpose: the push code is copied from _shared/push.ts so
// this can be pasted into the Supabase dashboard editor as one file.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API_HOST = 'https://v3.football.api-sports.io'
const PREMIER_LEAGUE = 39
const DAILY_LIMIT = Number(Deno.env.get('API_FOOTBALL_DAILY_LIMIT') ?? '100')
const RESERVE = 10

const MIN = 60 * 1000
const FINISHED = ['FT', 'AET', 'PEN', 'AWD', 'WO']
const VOID = ['PST', 'CANC', 'ABD']

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

const apiKey = Deno.env.get('API_FOOTBALL_KEY')!

/* ------------------------------------------------------------------ */
/* API-Football                                                        */
/* ------------------------------------------------------------------ */

async function apiGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(API_HOST + path)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } })
  const body = await res.json()
  const errors = body.errors
  if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)) {
    if (errors.plan) throw new Error(`API plan limit: ${errors.plan}`)
    if (errors.token || errors.key) throw new Error('The API key was rejected. Check API_FOOTBALL_KEY in Edge Function secrets.')
    if (errors.requests) throw new Error(`Daily request limit reached: ${errors.requests}`)
    throw new Error(`API error: ${JSON.stringify(errors)}`)
  }
  return body.response ?? []
}

async function logSync(entry: Record<string, unknown>) {
  await supabase.from('api_sync_log').insert({ kind: 'lms', requests_used: 0, ...entry })
}

async function quotaRemaining(): Promise<number> {
  const { data } = await supabase.rpc('api_requests_used_today')
  return DAILY_LIMIT - RESERVE - (data ?? 0)
}

async function lastRefresh(): Promise<number> {
  const { data } = await supabase.from('api_sync_log')
    .select('ran_at').eq('kind', 'lms').gt('requests_used', 0)
    .order('ran_at', { ascending: false }).limit(1)
  return data?.length ? +new Date(data[0].ran_at) : 0
}

async function currentSeason(): Promise<number> {
  const { data } = await supabase.rpc('lms_current_season')
  if (data) return Number(data)
  const now = new Date()
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

/** "Regular Season - 12" -> 12. Anything else (play-offs) is skipped. */
function roundNumber(round: string | null | undefined): number | null {
  const m = String(round ?? '').match(/Regular Season\s*-\s*(\d+)/i)
  return m ? Number(m[1]) : null
}

/** The whole Premier League season in one request. */
async function refreshFixtures(season: number) {
  const list = await apiGet('/fixtures', { league: String(PREMIER_LEAGUE), season: String(season) })

  const rows = list
    .map((f: any) => ({
      api_fixture_id: f.fixture.id,
      league_id: PREMIER_LEAGUE,
      season,
      round: roundNumber(f.league?.round),
      kickoff: f.fixture.date,
      status: f.fixture.status?.short ?? 'NS',
      home_team_id: f.teams.home.id,
      home_team: f.teams.home.name,
      away_team_id: f.teams.away.id,
      away_team: f.teams.away.name,
      home_goals: f.goals?.home ?? null,
      away_goals: f.goals?.away ?? null,
      updated_at: new Date().toISOString(),
    }))
    .filter((r: any) => r.round != null)

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('lms_fixtures').upsert(rows.slice(i, i + 200), { onConflict: 'api_fixture_id' })
    if (error) throw new Error(`Saving fixtures failed: ${error.message}`)
  }

  await logSync({ requests_used: 1, fixtures_seen: list.length, fixtures_updated: rows.length })
  return rows.length
}

/** Does the run need fresh data from the API? */
async function refreshNeeded(season: number): Promise<string | null> {
  const { data: games } = await supabase.from('lms_games')
    .select('id, current_round, season').in('status', ['open', 'running'])
  if (!games?.length) return null

  const last = await lastRefresh()
  const now = Date.now()

  const { count } = await supabase.from('lms_fixtures')
    .select('api_fixture_id', { count: 'exact', head: true }).eq('season', season)
  if (!count) return 'no fixtures yet'

  if (now - last > 6 * 60 * MIN) return 'list over 6 hours old'
  if (now - last < 20 * MIN) return null

  // A game in a gameweek someone is playing that should be over by now.
  const rounds = [...new Set(games.map(g => g.current_round))]
  const { data: waiting } = await supabase.from('lms_fixtures')
    .select('api_fixture_id, status')
    .eq('season', season)
    .in('round', rounds)
    .lt('kickoff', new Date(now - 110 * MIN).toISOString())
    .gt('kickoff', new Date(now - 3 * 24 * 60 * MIN).toISOString())
  const unfinished = (waiting ?? []).filter(f => !FINISHED.includes(f.status) && !VOID.includes(f.status))
  return unfinished.length ? `${unfinished.length} result(s) due` : null
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

type Note = { user_id: string; title: string; body: string; link: string; kind: string; tag: string }

function messageFor(e: any): Note | null {
  const link = `${APP_URL}/?competition=${e.competition_id}`
  const gw = `GW${e.round}`
  const tag = `lms:${e.game_id}:${e.round}:${e.kind}`

  switch (e.kind) {
    case 'through':
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `You're through! ✅ ${e.competition}`,
        body: e.void
          ? `${e.team}'s game was called off, so you go through. ${e.left} left. Pick for GW${e.next_round} now.`
          : `${e.team} won in ${gw}. ${e.left} left. Pick your GW${e.next_round} team now.`,
      }
    case 'out':
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `You're out ❌ ${e.competition}`,
        body: (e.reason === 'no_pick'
          ? `No pick for ${gw}.`
          : `${e.team} ${e.reason === 'drew' ? 'drew' : 'lost'} in ${gw}.`)
          + (e.no_winner ? ` Nobody's left, so the ${e.pot} points roll over to the next game.` : ''),
      }
    case 'winner':
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `Last Man Standing! 🏆 ${e.competition}`,
        body: `You're the last one left and win the pot: ${e.pot} points. Bragging rights are yours.`,
      }
    case 'remind_24h':
    case 'remind_2h': {
      const when = new Date(e.lock_at).toLocaleString('en-GB', {
        timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit',
      })
      return {
        user_id: e.user_id, link, tag, kind: 'lms',
        title: `Pick your team ⏳ ${e.competition}`,
        body: `${e.kind === 'remind_2h' ? 'Under 2 hours left' : 'Picks lock'} at ${when}. No pick means you're out.`,
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
  const season = await currentSeason()
  const out: Record<string, unknown> = {}

  const why = await refreshNeeded(season)
  if (why) {
    if (await quotaRemaining() > 0) {
      out.refreshed = await refreshFixtures(season)
      out.why = why
    } else {
      out.skipped = 'Daily API quota reached'
    }
  }

  const { data: events, error: settleError } = await supabase.rpc('lms_settle')
  if (settleError) throw new Error(`lms_settle failed: ${settleError.message}`)

  const { data: reminders, error: remindError } = await supabase.rpc('lms_due_reminders')
  if (remindError) throw new Error(`lms_due_reminders failed: ${remindError.message}`)

  const notes = [...(events ?? []), ...(reminders ?? [])].map(messageFor).filter(Boolean) as Note[]
  out.events = (events ?? []).length
  out.reminders = (reminders ?? []).length
  out.push = await sendAll(notes)
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
        return json({ ok: false, error: 'Only the admin of a Last Man Standing can refresh fixtures.' })
      }
      if (Date.now() - await lastRefresh() < 5 * MIN) return json({ ok: true, note: 'Refreshed in the last 5 minutes' })
      if (await quotaRemaining() <= 0) return json({ ok: false, error: 'Daily API request limit reached. Try again tomorrow.' })
      const season = await currentSeason()
      return json({ ok: true, fixtures: await refreshFixtures(season), season })
    }

    return json({ ok: true, ...(await run()) })
  } catch (err) {
    await logSync({ error: String(err instanceof Error ? err.message : err) })
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
