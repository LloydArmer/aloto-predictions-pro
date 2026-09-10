import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor'
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * Pro subscriptions, through RevenueCat.
 *
 * The client NEVER writes an entitlement. It asks RevenueCat to make a
 * purchase; RevenueCat validates the receipt with Apple and calls our webhook,
 * which writes to pro_entitlements using the service role. If the app could
 * write its own entitlement, anyone reading this file would work out how to
 * grant themselves Pro for nothing.
 *
 * So what the app reads is always the database, never RevenueCat's local cache.
 */

// Must match the entitlement identifier in RevenueCat EXACTLY. Theirs reads
// aloto_prediction_pro_premium; identifiers generally can't be renamed after
// creation, so the code matches the dashboard rather than the other way round.
//
// If this string and RevenueCat's ever diverge, a purchase completes, Apple
// takes the money, and the app decides the person isn't entitled — the worst
// failure this file can have.
const ENTITLEMENT = 'aloto_prediction_pro_premium'

let configured = false

/** In-app purchases only exist in the native app, not the website. */
export function canPurchase() {
  return Capacitor.isNativePlatform()
}

/**
 * Must be called with a signed-in user, and again whenever the user changes.
 *
 * appUserID is set to the Supabase user id so RevenueCat's webhook can tell us
 * WHO bought. Left to generate its own anonymous id, a purchase arrives
 * attributed to nobody and cannot be applied to an account.
 */
export async function initPurchases(userId) {
  if (!canPurchase() || !userId) return false

  const apiKey = import.meta.env.VITE_REVENUECAT_APPLE_KEY
  if (!apiKey) {
    console.warn('No RevenueCat key configured — purchases disabled')
    return false
  }

  try {
    if (!configured) {
      await Purchases.setLogLevel({ level: LOG_LEVEL.ERROR })
      await Purchases.configure({ apiKey, appUserID: userId })
      configured = true
    } else {
      // Someone signed out and back in as someone else. Without this the
      // purchase would be attributed to the previous account.
      await Purchases.logIn({ appUserID: userId })
    }
    return true
  } catch (err) {
    console.error('RevenueCat configure failed:', err)
    return false
  }
}

/** The annual package, or null if offerings aren't reachable. */
export async function getProPackage() {
  if (!canPurchase()) return null
  try {
    const { current } = await Purchases.getOfferings()
    return current?.availablePackages?.[0] ?? null
  } catch (err) {
    console.error('Could not load offerings:', err)
    return null
  }
}

/**
 * Buy Pro.
 *
 * Returns { ok, reason }. A cancellation is NOT an error — someone changing
 * their mind at the Apple sheet is ordinary, and showing them a failure message
 * for it reads as a fault.
 */
export async function purchasePro(pkg) {
  if (!canPurchase()) return { ok: false, reason: 'not-native' }
  if (!pkg) return { ok: false, reason: 'no-package' }

  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg })
    const active = !!customerInfo?.entitlements?.active?.[ENTITLEMENT]
    return active ? { ok: true } : { ok: false, reason: 'not-entitled' }
  } catch (err) {
    if (err?.code === '1' || /cancel/i.test(String(err?.message))) {
      return { ok: false, reason: 'cancelled' }
    }
    console.error('Purchase failed:', err)
    return { ok: false, reason: 'failed', message: String(err?.message || err) }
  }
}

/**
 * Restore a previous purchase.
 *
 * Apple REQUIRES this in any app selling a subscription, and rejects apps
 * without it. It is also genuinely needed: a new phone, a reinstall, or signing
 * in on a second device all leave someone who has paid with no entitlement
 * until they restore.
 */
export async function restorePurchases() {
  if (!canPurchase()) return { ok: false, reason: 'not-native' }
  try {
    const { customerInfo } = await Purchases.restorePurchases()
    const active = !!customerInfo?.entitlements?.active?.[ENTITLEMENT]
    return active ? { ok: true } : { ok: false, reason: 'nothing-to-restore' }
  } catch (err) {
    console.error('Restore failed:', err)
    return { ok: false, reason: 'failed', message: String(err?.message || err) }
  }
}

/**
 * Pro status, read from OUR database rather than RevenueCat.
 *
 * The database is what the triggers enforce against, so it is the only answer
 * that matters. RevenueCat's local cache can be stale, and on the website there
 * is no RevenueCat at all — but a Pro subscriber should still see their status
 * when they open the app in a browser.
 */
export async function getProStatus() {
  const { data, error } = await supabase.rpc('my_pro_status')
  if (error) {
    console.error('Could not read Pro status:', error)
    return { isPro: false, expiresAt: null, willRenew: false, daysLeft: null, source: null }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { isPro: false, expiresAt: null, willRenew: false, daysLeft: null, source: null }

  return {
    isPro: !!row.is_pro,
    expiresAt: row.expires_at,
    willRenew: !!row.will_renew,
    daysLeft: row.days_left,
    source: row.source,
  }
}

/**
 * Wait for the webhook to catch up after a purchase.
 *
 * The purchase completes on the device before RevenueCat has called our
 * webhook, so reading the database immediately still says "not Pro" — and the
 * person who has just paid £29.99 sees an unchanged screen. Usually a second or
 * two; polled rather than assumed so a slow round trip doesn't look like a
 * failed payment.
 */
export async function waitForEntitlement({ tries = 10, gap = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const status = await getProStatus()
    if (status.isPro) return status
    await new Promise(r => setTimeout(r, gap))
  }
  return null
}
