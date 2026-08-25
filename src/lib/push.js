import { supabase } from './supabase'

// Native (Capacitor) support is deliberately absent until the app is wrapped —
// importing nativePush.js before that file exists breaks the build, and its
// dynamic import of @capacitor/push-notifications can't resolve without the
// package installed. When the wrap happens, this becomes an import again and
// the three isNative() branches below come back.
const isNative = () => false

// Push notifications via Firebase Cloud Messaging.
//
// The firebase SDK is ~350kB and is only needed by someone actually turning
// reminders on, so every use of it below is behind a dynamic import. Loading it
// at module scope would put it in the main bundle and slow the first paint for
// every participant, including the ones who never open Settings.

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY

let messagingPromise = null

/** Drops the cached instance so the next call rebuilds against a fresh worker. */
function resetMessagingInstance() { messagingPromise = null }

// Resolves to a messaging instance, or null if this device can't do push.
//
// Only a SUCCESSFUL result is cached. Caching a failure was poisoning the whole
// page session: one transient hiccup on load — a slow chunk, a service worker
// still installing — left every later call returning null, so the Settings
// toggle stayed permanently greyed out until the user reloaded. Clearing the
// cache on failure means the next call genuinely retries.
function getMessagingInstance() {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      const [{ initializeApp, getApps }, messagingMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/messaging'),
      ])
      if (!(await messagingMod.isSupported().catch(() => false))) return null
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
      return { messaging: messagingMod.getMessaging(app), mod: messagingMod }
    })().catch(() => {
      messagingPromise = null
      return null
    })
  }
  return messagingPromise
}

// Marker for "this browser registered a token". Kept locally because there is no
// other way to tell one device apart from another: push_tokens holds a row per
// device, but nothing in it identifies WHICH device is currently looking.
const DEVICE_TOKEN_KEY = 'aloto.push.token'

export function rememberedDeviceToken() {
  try { return localStorage.getItem(DEVICE_TOKEN_KEY) } catch { return null }
}

function rememberDeviceToken(token) {
  try { token ? localStorage.setItem(DEVICE_TOKEN_KEY, token) : localStorage.removeItem(DEVICE_TOKEN_KEY) } catch { /* private browsing */ }
}

/** Is the app running as an installed PWA rather than in a browser tab? */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * What can this device actually do?
 *
 * The iOS case is the one that matters. Safari only exposes the Push API to a
 * web app added to the Home Screen — in an ordinary tab the API is absent, so
 * there's no prompt to show and no token to get. Telling the user to install
 * first is the only thing that helps, and the UI needs to know to say so rather
 * than offering a button that cannot work.
 */
export async function pushCapability() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    return { supported: false, reason: 'unsupported' }
  }
  if (isIOS() && !isStandalone()) {
    return { supported: false, reason: 'ios-needs-install' }
  }
  const instance = await getMessagingInstance()
  if (!instance) return { supported: false, reason: 'unsupported' }
  return { supported: true, permission: Notification.permission }
}

/**
 * Ask permission, get an FCM token, and store it against the signed-in user.
 * Safe to call repeatedly — the token is upserted on its unique column, so a
 * device that already registered simply refreshes its last_seen_at.
 */
export async function enablePush(userId) {
  const cap = await pushCapability()
  if (!cap.supported) return { ok: false, reason: cap.reason }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed' }

  const instance = await getMessagingInstance()
  if (!instance) return { ok: false, reason: 'unsupported' }

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  const token = await instance.mod.getToken(instance.messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  }).catch(() => null)
  if (!token) return { ok: false, reason: 'no-token' }

  const { error } = await supabase.from('push_tokens').upsert(
    { user_id: userId, token, platform: 'web', user_agent: navigator.userAgent, last_seen_at: new Date().toISOString() },
    { onConflict: 'token' },
  )
  if (error) return { ok: false, reason: 'save-failed' }

  // Drop any older token this same browser left behind.
  //
  // FCM rotates tokens — on reinstall, on a permission reset, sometimes on its
  // own schedule — and the previous one keeps working for a while. Both rows
  // then point at the same physical device, and the reminder job sends to every
  // row, so the participant gets the same notification twice. Matching on
  // user_agent is the only signal available for "same device", and it is a good
  // one: a second genuine device almost always reports a different string.
  await supabase.from('push_tokens').delete()
    .eq('user_id', userId)
    .eq('user_agent', navigator.userAgent)
    .neq('token', token)

  rememberDeviceToken(token)
  return { ok: true, token }
}

/**
 * Stop notifications reaching this device.
 *
 * Deleting the FCM token as well as the row matters: leaving the token alive on
 * the device means a routine token refresh could silently re-register it.
 */
export async function disablePush(userId) {
  rememberDeviceToken(null)
  try {
    const instance = await getMessagingInstance()
    if (instance) {
      const token = await instance.mod.getToken(instance.messaging, { vapidKey: VAPID_KEY }).catch(() => null)
      if (token) {
        await supabase.from('push_tokens').delete().eq('token', token)
        await instance.mod.deleteToken(instance.messaging).catch(() => {})
        return
      }
    }
  } catch { /* fall through */ }

  // Fall back to the token this browser recorded. Deleting every row for the
  // user would unsubscribe their OTHER devices too — switching reminders off on
  // a laptop should not silence the phone.
  const remembered = rememberedDeviceToken()
  if (remembered) await supabase.from('push_tokens').delete().eq('token', remembered)
}

/**
 * Foreground messages. A push arriving while the app is open does NOT go
 * through the service worker, so without this the participant sees nothing at
 * all while looking at the app.
 */
export async function onForegroundPush(handler) {
  const instance = await getMessagingInstance()
  if (!instance) return
  instance.mod.onMessage(instance.messaging, payload => {
    const { title, body } = payload.notification || {}
    handler({ title, body, url: payload.data?.url })
  })
}

/**
 * Clears everything about this account's push setup and registers afresh.
 *
 * For the case where the numbers stop making sense: someone shows two devices
 * but owns one, or reminders arrive erratically. That happens when two token
 * rows point at the same phone — one dead, one alive — which the automatic
 * dedupe misses because it matches on the user_agent string, and that string
 * changes after an iOS update or between Safari and the installed app.
 *
 * Deliberately heavy-handed, in this order:
 *
 *   1. every token row for the account, not just this device's — orphans from
 *      a changed user_agent are the whole problem, and they can't be matched
 *   2. the FCM token itself, so a refresh can't resurrect the old one
 *   3. the service worker registration — a stale one is its own cause of
 *      erratic delivery, and unregistering forces a clean copy
 *   4. the local marker
 *
 * Then it registers again from nothing. Other devices on the account will need
 * reminders switched back on, which is why the UI asks first.
 */
export async function resetPush(userId) {
  // 1. Clear the account's tokens.
  await supabase.from('push_tokens').delete().eq('user_id', userId)

  // 2. Delete the FCM token so a refresh can't resurrect the old one.
  rememberDeviceToken(null)
  try {
    const instance = await getMessagingInstance()
    if (instance) await instance.mod.deleteToken(instance.messaging).catch(() => {})
  } catch { /* nothing to delete */ }

  // 3. Unregister the service worker. A stale one is its own cause of erratic
  //    delivery, and it's why untick-and-retick often doesn't fix anything.
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      regs
        .filter(r => r.active?.scriptURL?.includes('firebase-messaging-sw'))
        .map(r => r.unregister()),
    )
  } catch { /* not supported, or already gone */ }

  // The messaging instance holds a reference to the worker just unregistered.
  resetMessagingInstance()

  // Clearing the last device sets notify_push false, which would leave them
  // muted after a reset they asked for.
  await supabase.from('profiles').update({ notify_push: true }).eq('id', userId)

  // 4. Register again from scratch.
  return enablePush(userId)
}
