import { supabase } from './supabase'

/**
 * Push notifications inside the native app.
 *
 * The web path (push.js) uses a service worker and the browser Push API. That
 * doesn't exist inside the Capacitor shell, which talks to APNs on iOS and FCM
 * on Android through a native plugin instead.
 *
 * Both paths end up writing the same thing: a row in push_tokens. The
 * send-reminders job doesn't know or care which produced it — that's why
 * push_tokens carried a `platform` column from the start.
 *
 * The practical win is on iPhone: a native app has no "add to Home Screen
 * first" requirement, which is the single biggest reason web push goes unused.
 */

/** Is this running inside the native shell rather than a browser? */
export function isNative() {
  return typeof window !== 'undefined'
    && window.Capacitor?.isNativePlatform?.() === true
}

export function nativePlatform() {
  return window.Capacitor?.getPlatform?.() || 'web'
}

/**
 * Ask for permission and register this device.
 *
 * Registration is asynchronous in a way the web path isn't: requestPermissions
 * resolves, then register() fires a 'registration' event carrying the token.
 * The promise below bridges that gap so callers get the same shape of result as
 * enablePush() on the web.
 */
export async function enableNativePush(userId) {
  if (!isNative()) return { ok: false, reason: 'not-native' }

  const { PushNotifications } = await import('@capacitor/push-notifications')

  const permission = await PushNotifications.requestPermissions()
  if (permission.receive !== 'granted') {
    return { ok: false, reason: permission.receive === 'denied' ? 'denied' : 'dismissed' }
  }

  // Whatever iOS says back, kept so the screen can show the real reason
  // instead of "could not register this device", which describes every
  // possible failure equally badly and is impossible to act on.
  const outcome = await new Promise((resolve) => {
    let settled = false
    const finish = (value) => { if (!settled) { settled = true; resolve(value) } }

    // The listeners are awaited BEFORE register() is called. addListener is
    // itself asynchronous: firing register() first leaves a window in which
    // the answer arrives before anything is listening for it, and the result
    // is an unexplained timeout.
    Promise.all([
      PushNotifications.addListener('registration', t => finish({ token: t.value })),
      PushNotifications.addListener('registrationError', e => finish({
        error: e?.error || e?.message || String(e ?? 'registration refused'),
      })),
    ])
      .then(() => PushNotifications.register())
      .catch(err => finish({ error: String(err?.message || err) }))

    // Neither event ever fires on a device with no network. Without this the
    // toggle would hang.
    setTimeout(() => finish({ error: 'timed-out' }), 20000)
  })

  await PushNotifications.removeAllListeners()

  if (!outcome?.token) {
    return { ok: false, reason: 'no-token', detail: outcome?.error || 'no reason given' }
  }
  const token = outcome.token

  const { error } = await supabase.from('push_tokens').upsert(
    {
      user_id: userId,
      token,
      platform: nativePlatform(),          // 'ios' or 'android'
      user_agent: `${nativePlatform()} app`,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'token' },
  )
  if (error) return { ok: false, reason: 'save-failed' }

  // Same reasoning as the web path: a reinstall or permission reset issues a
  // fresh token while the old row lives on, and the job sends to every row —
  // so the participant gets each reminder twice.
  await supabase.from('push_tokens').delete()
    .eq('user_id', userId)
    .eq('user_agent', `${nativePlatform()} app`)
    .neq('token', token)

  return { ok: true, token }
}

export async function disableNativePush(userId) {
  if (!isNative()) return
  const { PushNotifications } = await import('@capacitor/push-notifications')
  await PushNotifications.removeAllListeners().catch(() => {})
  await supabase.from('push_tokens').delete()
    .eq('user_id', userId)
    .eq('user_agent', `${nativePlatform()} app`)
}

/**
 * Handle a notification the participant taps.
 *
 * Navigation is handled in-app rather than by opening a URL: the shell is
 * already showing the app, so opening a link would launch a browser on top of
 * it. Call this once at startup.
 */
export async function initNativePushHandlers(navigate) {
  if (!isNative()) return
  const { PushNotifications } = await import('@capacitor/push-notifications')

  PushNotifications.addListener('pushNotificationActionPerformed', action => {
    const url = action.notification?.data?.url
    if (!url) { navigate('/predict'); return }
    // The job sends absolute URLs for the web. Strip the origin so this stays
    // an in-app route rather than a browser launch.
    try { navigate(new URL(url).pathname) } catch { navigate('/predict') }
  })

  // Android shows foreground notifications itself; iOS does not, and without a
  // listener a push arriving while the app is open is silently dropped.
  PushNotifications.addListener('pushNotificationReceived', () => {})
}
