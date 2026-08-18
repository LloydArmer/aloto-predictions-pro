import { supabase } from './supabase'

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

// Resolves to a messaging instance, or null if this device can't do push.
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
    })().catch(() => null)
  }
  return messagingPromise
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

  return { ok: true, token }
}

/**
 * Stop notifications reaching this device.
 *
 * Deleting the FCM token as well as the row matters: leaving the token alive on
 * the device means a routine token refresh could silently re-register it.
 */
export async function disablePush(userId) {
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
  } catch { /* fall through to clearing everything for this user */ }
  await supabase.from('push_tokens').delete().eq('user_id', userId)
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
