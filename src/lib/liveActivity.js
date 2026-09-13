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
