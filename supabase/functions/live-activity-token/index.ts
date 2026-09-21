// supabase/functions/live-activity-token/index.ts
//
// Receives the update token of a Live Activity that the SERVER started.
//
// When push-live-activity starts an activity by push, iOS wakes the app for a
// few seconds in the background and hands it that activity's own update
// token. No web page is running then, so the app's Swift code posts the token
// here directly, along with the ref the server put in the activity when it
// started it. The ref is how this function knows whose activity it is.
//
// Deployed WITHOUT JWT verification (--no-verify-jwt): the phone has no
// signed-in session at that moment. What makes it safe is the ref — a random
// id that only exists inside that one activity, only matches a row the server
// created in the last 12 hours, and only fills in a token, nothing else.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX  = /^[0-9a-f]{16,512}$/i

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ ok: false, error: 'POST only' }, 405)

  try {
    const { ref, activityId, token } = await req.json().catch(() => ({}))

    if (typeof ref !== 'string' || !UUID.test(ref)) return reply({ ok: false, error: 'bad ref' }, 400)
    if (typeof token !== 'string' || !HEX.test(token)) return reply({ ok: false, error: 'bad token' }, 400)
    if (typeof activityId !== 'string' || !activityId || activityId.length > 200) {
      return reply({ ok: false, error: 'bad activityId' }, 400)
    }

    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

    // Tokens can be reissued during an activity's life, so this overwrites
    // rather than only filling in an empty one.
    const { data, error } = await supabase.from('live_activity_tokens')
      .update({ activity_id: activityId, token, push_failures: 0 })
      .eq('ref', ref)
      .is('ended_at', null)
      .gte('started_at', since)
      .select('id')

    if (error) return reply({ ok: false, error: error.message }, 500)
    return reply({ ok: true, matched: data?.length ?? 0 })
  } catch (err) {
    console.error('live-activity-token failed:', err)
    return reply({ ok: false, error: String(err) }, 500)
  }
})
