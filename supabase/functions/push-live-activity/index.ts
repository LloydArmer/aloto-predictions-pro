// supabase/functions/push-live-activity/index.ts
//
// Pushes provisional scores to running Live Activities.
//
// This is what makes the lock screen actually live. Without it an activity
// freezes the moment the app is closed — and someone watching their score on a
// Saturday afternoon has their phone in their pocket, not open in front of them.
//
// Runs off the back of the live score poller: when a fixture changes, everyone
// with an activity for that gameweek gets a push.
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

// Sandbox for TestFlight and development builds, production for App Store ones.
// Getting this wrong returns "BadDeviceToken" and nothing else — the single
// most common reason a Live Activity push appears to do nothing.
const APNS_HOST = (Deno.env.get('APNS_ENVIRONMENT') ?? 'sandbox') === 'production'
  ? 'https://api.push.apple.com'
  : 'https://api.sandbox.push.apple.com'

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

/* ------------------------------------------------------------------ */

/** One participant's provisional points for a gameweek. */
function pointsFor(fixtures: any[], predictions: any[], rules: any) {
  let points = 0
  let inPlay = 0

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

    if (fx.home_score == null && ['1H','HT','2H','ET','BT','P','LIVE'].includes(fx.live_status)) {
      inPlay++
    }
  }

  return { points, inPlay }
}

/** "3 matches in play" / "Full time" — composed here so the wording can change
 *  without shipping a new app build. */
function statusLine(inPlay: number, total: number) {
  if (inPlay === 0) return 'All matches finished'
  if (inPlay === 1) return '1 match in play'
  return `${inPlay} matches in play`
}

/* ------------------------------------------------------------------ */

async function pushAll() {
  const result = { pushed: 0, failed: 0, skipped: 0, errors: [] as string[] }

  // Tidy up anything abandoned before spending requests on it.
  await supabase.rpc('expire_stale_activities')

  const { data: activities } = await supabase.rpc('activities_needing_push')
  if (!activities?.length) return { ...result, note: 'Nothing in play' }

  const jwt = await apnsJwt()

  // Fixtures are fetched once per gameweek rather than once per activity —
  // twelve players in one competition share one set.
  const fixtureCache = new Map<string, any[]>()

  for (const act of activities) {
    try {
      let fixtures = fixtureCache.get(act.gameweek_id)
      if (!fixtures) {
        const { data } = await supabase.from('fixtures')
          .select('id, status, home_score, away_score, live_home_score, live_away_score, live_status')
          .eq('gameweek_id', act.gameweek_id)
        fixtures = data ?? []
        fixtureCache.set(act.gameweek_id, fixtures)
      }

      const [{ data: preds }, { data: gw }] = await Promise.all([
        supabase.from('predictions')
          .select('fixture_id, predicted_home, predicted_away')
          .eq('gameweek_id', act.gameweek_id).eq('user_id', act.user_id),
        supabase.from('gameweeks').select('competition_id').eq('id', act.gameweek_id).single(),
      ])

      const { data: rules } = await supabase.from('point_rules')
        .select('correct_result_points, exact_score_points')
        .eq('competition_id', gw?.competition_id).maybeSingle()

      const mine = pointsFor(fixtures, preds ?? [], rules ?? {})

      // The opponent, if there is a cup tie or group fixture this gameweek.
      const { data: opp } = await supabase.rpc('my_gameweek_opponent_for', {
        p_user_id: act.user_id,
        p_gameweek_id: act.gameweek_id,
      })

      const opponent = Array.isArray(opp) ? opp[0] : opp
      let opponentPoints: number | null = null

      if (opponent?.opponent_id) {
        const { data: oppPreds } = await supabase.from('predictions')
          .select('fixture_id, predicted_home, predicted_away')
          .eq('gameweek_id', act.gameweek_id).eq('user_id', opponent.opponent_id)

        opponentPoints = pointsFor(fixtures, oppPreds ?? [], rules ?? {}).points
      }

      const payload = {
        aps: {
          timestamp: Math.floor(Date.now() / 1000),
          event: 'update',
          'content-state': {
            myPoints: mine.points,
            opponentPoints,
            position: null,
            playerCount: null,
            matchesInPlay: mine.inPlay,
            statusLine: statusLine(mine.inPlay, fixtures.length),
          },
        },
      }

      const res = await fetch(`${APNS_HOST}/3/device/${act.token}`, {
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

      if (res.ok) {
        await supabase.from('live_activity_tokens')
          .update({ last_push_at: new Date().toISOString(), push_failures: 0 })
          .eq('activity_id', act.activity_id)
        result.pushed++
      } else {
        const reason = await res.text()

        // A dead token is ended rather than retried. Apple says so explicitly,
        // and continuing to push would waste a request every two minutes for
        // the rest of the afternoon.
        if (res.status === 410 || reason.includes('BadDeviceToken') || reason.includes('Unregistered')) {
          await supabase.from('live_activity_tokens')
            .update({ ended_at: new Date().toISOString() })
            .eq('activity_id', act.activity_id)
          result.skipped++
        } else {
          await supabase.rpc('increment_push_failure', { p_activity_id: act.activity_id })
            .then(() => {}, () => {})
          result.failed++
          result.errors.push(`${res.status}: ${reason.slice(0, 120)}`)
        }
      }
    } catch (err) {
      result.failed++
      result.errors.push(String(err).slice(0, 160))
    }
  }

  return result
}

Deno.serve(async (req) => {
  try {
    const result = await pushAll()
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
