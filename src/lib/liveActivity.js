import { registerPlugin } from '@capacitor/core'
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * The gameweek Live Activity — your provisional score on the lock screen.
 *
 * Only exists in the native app. On the website every call is a no-op, so
 * nothing here needs guarding at the call site.
 *
 * The activity's push token is sent straight to the server, because that token
 * is what lets the score keep updating while the app is closed — which is the
 * whole point of a lock screen widget. Without it the activity would freeze the
 * moment someone put their phone down.
 */

const LiveActivity = registerPlugin('LiveActivity')

export function isNative() {
  return Capacitor.isNativePlatform()
}

/** Supported by the OS, and switched on for this app? */
export async function liveActivityStatus() {
  if (!isNative()) return { supported: false, enabled: false }
  try {
    return await LiveActivity.isSupported()
  } catch {
    return { supported: false, enabled: false }
  }
}

/**
 * Start an activity for a gameweek.
 *
 * The token arrives asynchronously — iOS does not have it when the activity is
 * created — so a listener stores it whenever it turns up, including when it is
 * reissued mid-activity.
 */
export async function startGameweekActivity(userId, payload) {
  if (!isNative()) return null

  const status = await liveActivityStatus()
  if (!status.supported || !status.enabled) return null

  try {
    // Registered before starting: the token can arrive almost immediately, and
    // a listener added afterwards would miss it.
    await LiveActivity.addListener('pushTokenReceived', async ({ activityId, token }) => {
      await supabase.from('live_activity_tokens').upsert({
        user_id: userId,
        gameweek_id: payload.gameweekId,
        activity_id: activityId,
        token,
        started_at: new Date().toISOString(),
        ended_at: null,
      }, { onConflict: 'activity_id' })
    })

    const { activityId } = await LiveActivity.start(payload)
    return activityId
  } catch (err) {
    // Never thrown upwards. A lock screen extra failing should not break the
    // page that asked for it.
    console.warn('Could not start Live Activity:', err?.message || err)
    return null
  }
}

/** Update from inside the app, when it has fresher data than the last push. */
export async function updateGameweekActivity(activityId, state) {
  if (!isNative() || !activityId) return
  try {
    await LiveActivity.update({ activityId, ...state })
  } catch (err) {
    console.warn('Could not update Live Activity:', err?.message || err)
  }
}

/**
 * End an activity, and mark its token dead so the server stops pushing to it.
 *
 * Marked rather than deleted: a token that has just been used is worth keeping
 * briefly, so a failed push can be traced to an activity that had already
 * finished rather than looking like a fault.
 */
export async function endGameweekActivity(activityId) {
  if (!isNative()) return
  try {
    await LiveActivity.end(activityId ? { activityId } : {})

    if (activityId) {
      await supabase.from('live_activity_tokens')
        .update({ ended_at: new Date().toISOString() })
        .eq('activity_id', activityId)
    }
  } catch (err) {
    console.warn('Could not end Live Activity:', err?.message || err)
  }
}

/**
 * Lets the SERVER start an activity while the app is closed (iOS 17.2+).
 *
 * Two things happen here, once per signed-in account per app launch:
 *
 *   The Swift side is told where to send the update token of an activity the
 *   server starts. It has to do that itself — the server starting an activity
 *   only wakes the app for a few seconds in the background, with no page
 *   running to do it from here.
 *
 *   The device's push-to-start token is saved against this account, so the
 *   server knows which phones to start an activity on when a gameweek kicks
 *   off. Saved through a database function rather than a plain insert, so a
 *   phone that changes hands moves its token to the new account.
 *
 * Safe on an older app build that has no configure(): the call fails, is
 * caught, and nothing else is affected.
 */
let startTokenRegisteredFor = null

export async function registerLiveActivityStartToken(userId) {
  if (!isNative() || !userId || startTokenRegisteredFor === userId) return
  startTokenRegisteredFor = userId

  try {
    const url = supabase.supabaseUrl || import.meta.env.VITE_SUPABASE_URL
    const key = supabase.supabaseKey || import.meta.env.VITE_SUPABASE_ANON_KEY
    if (url && key) {
      await LiveActivity.configure({
        endpoint: `${url}/functions/v1/live-activity-token`,
        apiKey: key,
      })
    }

    const save = async ({ token }) => {
      if (!token) return
      const { error } = await supabase.rpc('register_live_activity_start_token', { p_token: token })
      if (error) console.warn('Could not save push-to-start token:', error.message)
    }

    // Registered before asking, so a token issued in between isn't missed.
    await LiveActivity.addListener('pushToStartTokenReceived', save)

    const { token } = await LiveActivity.getPushToStartToken()
    await save({ token })
  } catch (err) {
    // Allowed to try again next launch.
    startTokenRegisteredFor = null
    console.warn('Push-to-start not available:', err?.message || err)
  }
}

/** What is already running, so a second activity isn't started for a gameweek
 *  that already has one. */
export async function activeActivities() {
  if (!isNative()) return []
  try {
    const { activities } = await LiveActivity.listActive()
    return activities || []
  } catch {
    return []
  }
}
