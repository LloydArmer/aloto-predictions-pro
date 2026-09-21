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

/** Matches being played right now. Counted across the whole gameweek, not
 *  just the ones this person predicted. */
function inPlayCount(fixtures: any[]) {
  return fixtures.filter(fx =>
    fx.status !== 'void' && fx.home_score == null && IN_PLAY.includes(fx.live_status)
  ).length
}

/** True once every match has a confirmed or full-time score. */
function allFinished(fixtures: any[]) {
  const counted = fixtures.filter(fx => fx.status !== 'void')
  return counted.length > 0 && counted.every(fx =>
    fx.home_score != null || FINISHED.includes(fx.live_status)
  )
}

/** "3 matches in play" / "Full time" — composed here so the wording can change
 *  without shipping a new app build. */
function statusLine(inPlay: number, finished: boolean) {
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
      .select('id, number, competition_id, competitions(name)')
      .eq('id', gameweekId).single()
    gameweekCache.set(gameweekId, data)
  }
  return gameweekCache.get(gameweekId)
}

async function rulesFor(competitionId: string) {
  if (!rulesCache.has(competitionId)) {
    const { data } = await supabase.from('point_rules')
      .select('correct_result_points, exact_score_points')
      .eq('competition_id', competitionId).maybeSingle()
    rulesCache.set(competitionId, data ?? {})
  }
  return rulesCache.get(competitionId)
}

/** Everything the activity shows for one person, as of now. */
async function stateFor(userId: string, gameweekId: string) {
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
    opponentPoints = pointsFor(fixtures, oppPreds ?? [], rules)
  }

  const inPlay = inPlayCount(fixtures)
  const finished = allFinished(fixtures)

  return {
    gw, opponent, finished,
    contentState: {
      myPoints: pointsFor(fixtures, preds ?? [], rules),
      opponentPoints,
      position: null,
      playerCount: null,
      matchesInPlay: inPlay,
      statusLine: statusLine(inPlay, finished),
    },
  }
}

/* ---- START ---------------------------------------------------------- */

async function startNew(result: any) {
  // Gameweeks with a match in play right now, kicked off in the last 4 hours.
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: liveFx } = await supabase.from('fixtures')
    .select('gameweek_id')
    .in('live_status', IN_PLAY)
    .is('home_score', null)
    .gte('kickoff_time', since)

  const gameweekIds = [...new Set((liveFx ?? []).map(f => f.gameweek_id).filter(Boolean))]

  for (const gameweekId of gameweekIds) {
    const gw = await gameweekFor(gameweekId)
    if (!gw) continue

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
    const { data: predicted } = await supabase.from('predictions')
      .select('user_id').eq('gameweek_id', gameweekId).in('user_id', members)
    const players = [...new Set((predicted ?? []).map(p => p.user_id))]
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

    const label = String(gw.number ?? '')

    for (const st of startTokens) {
      const { opponent, contentState } = await stateFor(st.user_id, gameweekId)
      const me = profileById.get(st.user_id)
      const ref = crypto.randomUUID()

      // Recorded BEFORE the push, so the phone's reply always has a row to land on.
      const { error: insertError } = await supabase.from('live_activity_tokens')
        .insert({ user_id: st.user_id, gameweek_id: gameweekId, ref, started_at: new Date().toISOString() })
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
          alert: {
            title: `${label} is under way`,
            body: 'Your score will update here as the goals go in.',
          },
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
  const { data: activities, error } = await supabase.rpc('activities_needing_push')
  if (error) { result.errors.push(`activities: ${error.message}`); return }

  for (const act of activities ?? []) {
    try {
      const { finished, contentState } = await stateFor(act.user_id, act.gameweek_id)
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
  fixtureCache.clear(); gameweekCache.clear(); rulesCache.clear()
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
