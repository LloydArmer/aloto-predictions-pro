// supabase/functions/revenuecat-webhook/index.ts
//
// Receives subscription events from RevenueCat and keeps pro_entitlements in
// step with what Apple says.
//
// Why a webhook rather than trusting the app: a client that could write its own
// entitlement could grant itself Pro for nothing, and anyone reading the app's
// JavaScript would find out how. RevenueCat validates the receipt with Apple
// and tells this endpoint what actually happened, server to server.
//
// It must also handle everything that happens WITHOUT the app being open —
// renewals each August, cancellations, billing failures, refunds. None of those
// generate a launch, so none would ever be noticed by client-side checks.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Set in RevenueCat's webhook settings and here. Without it anyone who found
// the URL could grant themselves Pro with a forged POST.
const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')!

/**
 * Events that mean the person currently HAS Pro.
 *
 * CANCELLATION is deliberately in this list. Cancelling stops the renewal; it
 * does not end the subscription they have already paid for. Treating it as an
 * immediate loss would take Pro away from someone who paid until August, which
 * is both wrong and a refund request.
 */
const GRANTING = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'CANCELLATION',        // keeps access until expiry — see above
  'SUBSCRIPTION_EXTENDED',
])

/**
 * Events that end access immediately, whatever the expiry date says.
 *
 * EXPIRATION is the ordinary end of a lapsed subscription. The other two are
 * money returned — someone who has been refunded should not keep what they
 * were refunded for.
 */
const REVOKING = new Set([
  'EXPIRATION',
  'REFUND',
  'SUBSCRIPTION_PAUSED',
])

Deno.serve(async (req) => {
  try {
    // RevenueCat sends the shared secret as an Authorization header.
    const auth = req.headers.get('Authorization') ?? ''
    if (!WEBHOOK_SECRET || auth !== WEBHOOK_SECRET) {
      // 401 rather than a silent 200: a misconfigured secret should be visible
      // in RevenueCat's delivery log, not quietly swallowed.
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await req.json()
    const ev = body?.event
    if (!ev) return new Response('No event', { status: 400 })

    const type = ev.type as string

    // app_user_id is set by the client to the Supabase user id, so an event can
    // be attributed to a person. An anonymous id means the app called
    // RevenueCat before knowing who was signed in.
    const userId = ev.app_user_id as string | undefined

    if (!userId || userId.startsWith('$RCAnonymousID')) {
      // 200, not an error: retrying will not make an anonymous purchase
      // identifiable, and a failure here would have RevenueCat retry forever.
      console.warn('Event with no usable app_user_id:', type, ev.app_user_id)
      return new Response(JSON.stringify({ ok: true, skipped: 'anonymous user' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Milliseconds since the epoch, per RevenueCat.
    const expiresAt = ev.expiration_at_ms
      ? new Date(Number(ev.expiration_at_ms)).toISOString()
      : null

    if (GRANTING.has(type)) {
      await supabase.rpc('apply_pro_entitlement', {
        p_user_id:     userId,
        p_expires_at:  expiresAt,
        p_store:       ev.store ?? 'APP_STORE',
        p_product_id:  ev.product_id ?? null,
        p_rc_user_id:  ev.app_user_id ?? null,
        p_period_type: ev.period_type ?? null,
        // A cancellation still grants access, but it will not renew — which is
        // what the app needs to know to say "Pro until 12 August".
        p_will_renew:  type !== 'CANCELLATION',
        p_event_type:  type,
      })
    } else if (REVOKING.has(type)) {
      // Expired at this moment rather than deleted, so the history of what they
      // had and when it ended survives. Deleting the row would make a support
      // question unanswerable.
      await supabase.from('pro_entitlements')
        .update({
          expires_at: new Date().toISOString(),
          will_renew: false,
          last_event_at: new Date().toISOString(),
          last_event_type: type,
        })
        .eq('user_id', userId)
        .eq('source', 'purchase')      // never touches a permanent grant
    } else {
      // BILLING_ISSUE, SUBSCRIBER_ALIAS, TRANSFER and anything RevenueCat adds
      // later. Logged rather than acted on — a billing issue is not yet a
      // lapse, and Apple retries for days before giving up.
      console.log('Event noted, no entitlement change:', type)
    }

    return new Response(JSON.stringify({ ok: true, type }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // 500 on purpose: RevenueCat retries failed deliveries, and a dropped
    // renewal would silently cost someone the Pro they paid for.
    console.error('Webhook failed:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
