import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken, sendFcmPush, sendApnsPush, type SendResult } from '../_shared/push.ts'

// Chat notifications.
//
// Only two things reach a phone: being @mentioned, and somebody replying to
// your message. Not every message.
//
// That restraint is the whole design. A league of twelve on a Saturday
// afternoon generates a notification a minute if every message is pushed, and
// the universal response to that is to mute the app — at which point the
// reminders that actually matter stop arriving too. A mention is someone
// addressing you by name, which is worth interrupting for; everything else is
// a conversation you can read when you choose to, and the unread badge is
// there to tell you it happened.
//
// Driven by a database webhook on chat_messages INSERT rather than pg_cron:
// a mention that arrives four minutes later has missed the moment.

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Same fallback as send-reminders, deliberately. If APP_URL is not set as a
// secret, a chat notification and a reminder must still open the same place —
// two functions disagreeing about where the app lives is the kind of thing
// nobody notices until a notification opens a dead domain.
const APP_URL           = Deno.env.get('APP_URL') || 'https://aloto-prediction-pro.netlify.app'

type MessageRow = {
  id: string
  competition_id: string
  user_id: string
  body: string
  reply_to_id: string | null
  mentions: string[] | null
  deleted_at: string | null
}

serve(async (req) => {
  // The webhook carries the service role key. Anything else is somebody
  // poking at the endpoint, and gets nothing — including no clue about why.
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('no', { status: 401 })
  }

  let record: MessageRow
  try {
    const payload = await req.json()
    record = payload.record
    if (!record?.id) return json({ skipped: 'no record' })
  } catch {
    return new Response('bad payload', { status: 400 })
  }

  // Removed between insert and this running. Unlikely, but a notification
  // pointing at a message that no longer exists is the worst version of this.
  if (record.deleted_at) return json({ skipped: 'deleted' })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ── Who should hear about this ──────────────────────────────────────────
  //
  // A mention and a reply are tracked separately so the notification can say
  // which it was, but somebody who is both only hears once — and hears about
  // the reply, which is the more specific of the two.
  const mentioned = new Set((record.mentions || []).filter(Boolean))
  const replied   = new Set<string>()

  if (record.reply_to_id) {
    const { data: parent } = await supabase
      .from('chat_messages')
      .select('user_id')
      .eq('id', record.reply_to_id)
      .maybeSingle()
    if (parent?.user_id) replied.add(parent.user_id)
  }

  // Never notify yourself — mentioning your own name in a sentence is normal.
  mentioned.delete(record.user_id)
  replied.delete(record.user_id)

  const candidates = [...new Set([...mentioned, ...replied])]
  if (candidates.length === 0) return json({ skipped: 'nobody to tell' })

  // ── Who is actually allowed and willing to hear it ──────────────────────
  //
  // Four filters, and each exists because the alternative is a complaint:
  //
  //   participant   — a mention cannot reach someone outside the league, even
  //                   if a crafted client puts their id in the array
  //   not banned    — somebody removed from the chat should stop hearing from it
  //   not blocking  — if you blocked this person, their message does not reach
  //                   you, and a notification is still their message reaching you
  //   notify_push   — the switch in Settings means this too, not only reminders
  const [{ data: parts }, { data: bans }, { data: blocks }, { data: profiles }] = await Promise.all([
    supabase.from('participants').select('user_id')
      .eq('competition_id', record.competition_id).in('user_id', candidates),
    supabase.from('chat_bans').select('user_id')
      .eq('competition_id', record.competition_id).in('user_id', candidates),
    supabase.from('chat_blocks').select('blocker_id')
      .eq('blocked_id', record.user_id).in('blocker_id', candidates),
    supabase.from('profiles').select('id, display_name, notify_push').in('id', candidates),
  ])

  const inLeague = new Set((parts   || []).map(r => r.user_id))
  const barred   = new Set((bans    || []).map(r => r.user_id))
  const blocking = new Set((blocks  || []).map(r => r.blocker_id))
  const wants    = new Map((profiles || []).map(p => [p.id, p.notify_push !== false]))

  const recipients = candidates.filter(id =>
    inLeague.has(id) && !barred.has(id) && !blocking.has(id) && wants.get(id) === true)

  if (recipients.length === 0) return json({ skipped: 'nobody eligible' })

  // ── What it says ────────────────────────────────────────────────────────
  const [{ data: sender }, { data: competition }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', record.user_id).maybeSingle(),
    supabase.from('competitions').select('name').eq('id', record.competition_id).maybeSingle(),
  ])

  const senderName = sender?.display_name || 'Someone'
  const title      = competition?.name || 'League chat'
  const excerpt    = trim(record.body, 120)
  const link       = `${APP_URL}/chat`

  // ── Send ────────────────────────────────────────────────────────────────
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('id, user_id, token, platform')
    .in('user_id', recipients)

  const byUser = new Map<string, Array<{ id: string; token: string; platform: string }>>()
  for (const t of tokens || []) {
    if (!byUser.has(t.user_id)) byUser.set(t.user_id, [])
    byUser.get(t.user_id)!.push({ id: t.id, token: t.token, platform: t.platform || 'web' })
  }

  // The FCM token is only worth fetching if a web device is actually listening.
  let fcmToken: string | null = null
  const needsFcm = [...byUser.values()].some(ds => ds.some(d => d.platform !== 'ios'))
  if (needsFcm) {
    try {
      fcmToken = await getAccessToken(
        Deno.env.get('FCM_CLIENT_EMAIL')!,
        Deno.env.get('FCM_PRIVATE_KEY')!,
      )
    } catch (err) {
      // An iPhone-only league should still get its notifications when the
      // Firebase credentials are missing or wrong.
      console.warn('FCM auth failed, web devices will be skipped:', String(err).slice(0, 160))
    }
  }
  const fcmProject = Deno.env.get('FCM_PROJECT_ID')!

  const stale: string[] = []
  let sent = 0

  for (const userId of recipients) {
    const devices = byUser.get(userId) || []
    if (devices.length === 0) continue

    const kind = replied.has(userId) ? 'chat_reply' : 'chat_mention'
    const body = replied.has(userId)
      ? `${senderName} replied: ${excerpt}`
      : `${senderName} mentioned you: ${excerpt}`

    // CLAIM FIRST, THEN SEND.
    //
    // The insert is the lock. If the webhook is retried while the first run is
    // still talking to Apple, the second insert conflicts and that run sends
    // nothing — whereas checking for a row and then inserting leaves a window
    // in which both runs look first, both see nothing, and both send.
    const { error: claimErr } = await supabase
      .from('chat_notification_log')
      .insert({ message_id: record.id, user_id: userId, kind })
    if (claimErr) continue   // 23505: already notified, by us or by a retry

    for (const device of devices) {
      let outcome: SendResult = 'failed'
      if (device.platform === 'ios') {
        outcome = await sendApnsPush(device.token, title, body, link, kind)
      } else if (fcmToken) {
        // Tagged per message, so being mentioned twice shows twice rather
        // than the second quietly replacing the first.
        outcome = await sendFcmPush(
          fcmProject, fcmToken, device.token, title, body, link, kind, `${kind}:${record.id}`)
      }
      if (outcome === 'sent')  sent++
      if (outcome === 'stale') stale.push(device.id)
    }
  }

  // A wiped device keeps failing forever. Drop it rather than retrying it on
  // every message for the rest of the season.
  if (stale.length) await supabase.from('push_tokens').delete().in('id', stale)

  return json({ recipients: recipients.length, sent, dropped: stale.length })
})

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Cuts on a word boundary where it can — a notification ending mid-word reads as broken. */
function trim(s: string, n: number): string {
  const one = (s || '').replace(/\s+/g, ' ').trim()
  if (one.length <= n) return one
  const cut = one.slice(0, n)
  const space = cut.lastIndexOf(' ')
  return (space > n * 0.6 ? cut.slice(0, space) : cut) + '…'
}
