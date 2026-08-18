import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Prediction reminders, sent as push notifications.
//
// Three triggers, all keyed to the GAMEWEEK rather than to individual fixtures:
//   gameweek_open — the admin has made a gameweek active and it has fixtures
//   deadline_24h  — within 24h of the FIRST kickoff, and predictions incomplete
//   deadline_1h   — within 1h of the first kickoff, and predictions incomplete
//
// The two deadline reminders only ever go to someone who still has unpredicted
// fixtures. Anyone who has finished is left alone.
//
// Runs every 15 minutes from pg_cron (see migration 035). Repeat sends are
// prevented by the unique constraint on notification_log, so running often is
// safe — each reminder fires on the first run inside its window and never again.

// ---------------------------------------------------------------------------
// Firebase Cloud Messaging
//
// FCM's HTTP v1 API needs an OAuth token signed with the service account key.
// Doing that here with Web Crypto avoids pulling in a Node-oriented library
// that won't run cleanly under Deno.
// ---------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Supabase secrets store newlines escaped, so restore them before parsing.
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
  // Tokens last an hour; reuse across warm invocations.
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
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`FCM auth failed: ${data.error_description || data.error || res.status}`)

  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return data.access_token
}

type SendResult = 'sent' | 'stale' | 'failed'

async function sendPush(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  link: string,
): Promise<SendResult> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        webpush: {
          notification: { icon: '/icons/android-icon-512x512.png', badge: '/icons/favicon.ico' },
          fcmOptions: { link },
        },
        data: { url: link },
      },
    }),
  })
  if (res.ok) return 'sent'

  // A device that has been wiped, or whose permission was revoked, keeps
  // returning errors forever. Report it so the token can be dropped rather than
  // retried every 15 minutes for the rest of the season.
  const err = await res.json().catch(() => ({}))
  const status = err?.error?.status
  if (res.status === 404 || status === 'NOT_FOUND' || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') return 'stale'
  return 'failed'
}

// ---------------------------------------------------------------------------

// Only push is wired up today. WhatsApp is planned, and notification_log is
// keyed by channel so it can be added alongside rather than replacing this.
const CHANNEL = 'push'

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' })

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const PROJECT_ID   = Deno.env.get('FCM_PROJECT_ID')!
    const CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL')!
    const PRIVATE_KEY  = Deno.env.get('FCM_PRIVATE_KEY')!
    const APP_URL      = Deno.env.get('APP_URL') || 'https://aloto-prediction-pro.netlify.app'

    const now = Date.now()
    const results = { sent: 0, skipped: 0, staleTokensRemoved: 0, errors: [] as string[] }
    const done = (note: string) =>
      new Response(JSON.stringify({ success: true, ...results, note }), { headers: { 'Content-Type': 'application/json' } })

    // ---- Which gameweeks are in play? ------------------------------------
    const { data: gameweeks } = await supabase
      .from('gameweeks').select('id, number, status').eq('status', 'active')
    if (!gameweeks?.length) return done('no active gameweeks')

    const gwIds = gameweeks.map((g: any) => g.id)

    // Voided fixtures are excluded everywhere below: they can't be predicted, so
    // chasing them would tell participants they're behind when they aren't, and
    // a voided first fixture would set the deadline to a match nobody is playing.
    const { data: allFixtures } = await supabase
      .from('fixtures').select('id, gameweek_id, home_team, away_team, kickoff_time, home_score, status')
      .in('gameweek_id', gwIds).neq('status', 'void').order('kickoff_time')

    // A gameweek reaches participants only through the join table — the
    // gameweek row itself doesn't know who should be reminded about it.
    const { data: links } = await supabase
      .from('competition_gameweeks').select('competition_id, gameweek_id').in('gameweek_id', gwIds)

    const compIds = [...new Set((links || []).map((l: any) => l.competition_id))]
    if (!compIds.length) return done('no competitions linked to the active gameweeks')

    const { data: participants } = await supabase
      .from('participants').select('user_id, competition_id').in('competition_id', compIds)

    const userIds = [...new Set((participants || []).map((p: any) => p.user_id))]
    if (!userIds.length) return done('no participants')

    // Muted participants are filtered here rather than at send time, so someone
    // who has switched reminders off costs nothing beyond this one query.
    const { data: profiles } = await supabase
      .from('profiles').select('id, display_name, notify_push').in('id', userIds)
    const wantsPush = new Map((profiles || []).map((p: any) => [p.id, p.notify_push !== false]))

    const { data: tokens } = await supabase
      .from('push_tokens').select('id, user_id, token').in('user_id', userIds)
    const tokensByUser = new Map<string, Array<{ id: string; token: string }>>()
    for (const t of (tokens || [])) {
      if (!tokensByUser.has(t.user_id)) tokensByUser.set(t.user_id, [])
      tokensByUser.get(t.user_id)!.push({ id: t.id, token: t.token })
    }

    // Scoped to this channel. WhatsApp, when it's added, keeps its own send
    // history — a participant who got the push shouldn't be silently skipped on
    // the other channel, or vice versa.
    const { data: alreadySent } = await supabase
      .from('notification_log').select('user_id, gameweek_id, kind')
      .eq('channel', CHANNEL).in('gameweek_id', gwIds)
    const sentKey = new Set((alreadySent || []).map((r: any) => `${r.user_id}:${r.gameweek_id}:${r.kind}`))

    const { data: predictions } = await supabase
      .from('predictions').select('user_id, fixture_id, gameweek_id').in('gameweek_id', gwIds)

    // ---- Work out what each participant is owed ---------------------------
    type Job = { userId: string; gwId: string; kind: string; title: string; body: string }
    const jobs: Job[] = []

    for (const gw of gameweeks) {
      const fixtures = (allFixtures || []).filter((f: any) => f.gameweek_id === gw.id)
      if (!fixtures.length) continue

      const first = fixtures[0]
      const minutesToDeadline = (new Date(first.kickoff_time).getTime() - now) / 60000

      const gwCompIds = (links || []).filter((l: any) => l.gameweek_id === gw.id).map((l: any) => l.competition_id)
      const gwUserIds = [...new Set((participants || [])
        .filter((p: any) => gwCompIds.includes(p.competition_id)).map((p: any) => p.user_id))]

      for (const userId of gwUserIds) {
        if (!wantsPush.get(userId)) { results.skipped++; continue }
        if (!tokensByUser.has(userId)) { results.skipped++; continue }

        // Fixtures this participant still hasn't predicted. Ones that have
        // already kicked off are excluded — chasing a locked fixture is noise,
        // since there is nothing they can do about it.
        const mine = new Set((predictions || [])
          .filter((p: any) => p.user_id === userId && p.gameweek_id === gw.id).map((p: any) => p.fixture_id))
        const outstanding = fixtures.filter((f: any) =>
          !mine.has(f.id) && f.home_score === null && new Date(f.kickoff_time).getTime() > now)

        const push = (kind: string, title: string, body: string) => {
          if (sentKey.has(`${userId}:${gw.id}:${kind}`)) return
          jobs.push({ userId, gwId: gw.id, kind, title, body })
        }

        // 1. The gameweek is open. Goes to everyone — this one is an
        //    announcement, not a chase.
        push(
          'gameweek_open',
          `${gw.number} is open`,
          `${fixtures.length} fixture${fixtures.length !== 1 ? 's' : ''} to predict. Each locks at its own kickoff — the first is ${fmtDay(first.kickoff_time)} at ${fmtTime(first.kickoff_time)}.`,
        )

        // 2 and 3. Deadline chases — only when something is still outstanding.
        if (outstanding.length > 0) {
          if (minutesToDeadline <= 24 * 60 && minutesToDeadline > 60) {
            push(
              'deadline_24h',
              `24 hours left — ${gw.number}`,
              `${outstanding.length} prediction${outstanding.length !== 1 ? 's' : ''} outstanding. First fixture locks ${fmtDay(first.kickoff_time)} at ${fmtTime(first.kickoff_time)}; each later one locks at its own kickoff.`,
            )
          }
          if (minutesToDeadline <= 60 && minutesToDeadline > 0) {
            // Wording matters here. This is the LAST reminder, but it is not a
            // deadline for the whole gameweek — only the first fixture locks at
            // this kickoff. Every other fixture stays open until its own. Saying
            // "last chance" would be wrong, and would push people into rushing
            // predictions they still have days to make.
            push(
              'deadline_1h',
              `Final reminder — ${gw.number}`,
              `${first.home_team} v ${first.away_team} kicks off at ${fmtTime(first.kickoff_time)} and locks then. ${outstanding.length} prediction${outstanding.length !== 1 ? 's' : ''} outstanding — later fixtures stay open until their own kickoff. This is the last reminder for this gameweek.`,
            )
          }
        }
      }
    }

    if (!jobs.length) return done('nothing due')

    // ---- Send -------------------------------------------------------------
    const accessToken = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY)
    const staleTokenIds: string[] = []

    for (const job of jobs) {
      const devices = tokensByUser.get(job.userId) || []
      let deliveredToAny = false

      for (const device of devices) {
        try {
          const outcome = await sendPush(
            PROJECT_ID, accessToken, device.token, job.title, job.body, `${APP_URL}/predict`,
          )
          if (outcome === 'sent') deliveredToAny = true
          if (outcome === 'stale') staleTokenIds.push(device.id)
        } catch (e) {
          results.errors.push(`${job.userId} ${job.kind}: ${(e as Error).message}`)
        }
      }

      // Only log a reminder that actually reached a device. Logging on failure
      // would permanently suppress the retry, and the participant would silently
      // never be reminded about that gameweek again.
      if (deliveredToAny) {
        const { error } = await supabase.from('notification_log')
          .insert({ user_id: job.userId, gameweek_id: job.gwId, kind: job.kind, channel: CHANNEL })
        if (!error) results.sent++
      }
    }

    if (staleTokenIds.length) {
      await supabase.from('push_tokens').delete().in('id', staleTokenIds)
      results.staleTokensRemoved = staleTokenIds.length
    }

    return new Response(JSON.stringify({ success: true, ...results }),
      { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
