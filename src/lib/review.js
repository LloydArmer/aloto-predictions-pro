import { registerPlugin, Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * Asking for an App Store rating, at a moment worth asking at.
 *
 * Apple's sheet appears over the app, so nobody has to leave it — which is
 * why this exists rather than a link. iOS allows at most three a year per
 * person and quietly ignores anything beyond that, so the sheet may well not
 * appear. Nothing here depends on it appearing.
 *
 * The bar below is deliberately higher than Apple's own limit would enforce.
 * A first-session prompt is the thing everybody hates, and someone who has
 * entered two gameweeks' worth of predictions has actually used the app and
 * has something to say about it.
 */

const Review = registerPlugin('Review')

const MOMENTS = 'aloto_review_moments'
const FIRST   = 'aloto_review_first_seen'
const ASKED   = 'aloto_review_asked_version'

/** Roughly two full gameweeks of predictions. */
const ENOUGH_MOMENTS = 10
const ENOUGH_DAYS = 2

// Private browsing, cleared site data and a few other cases make localStorage
// throw rather than return nothing, so every read and write is guarded. Losing
// the count means someone is asked again later, which is the harmless failure.
function read(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key, value) {
  try { localStorage.setItem(key, value) } catch { /* nothing to do */ }
}

/**
 * Call at a point where someone has just finished something successfully.
 *
 * Counts the moment, and asks for a rating once the bar is met — at most once
 * per released version, so an update never re-prompts someone who has already
 * been asked about it.
 *
 * Never throws and never returns anything worth acting on: a rating prompt
 * failing must not disturb whatever the person was actually doing.
 */
export async function noteGoodMoment() {
  if (!Capacitor.isNativePlatform()) return

  try {
    if (!read(FIRST)) write(FIRST, String(Date.now()))

    const moments = (Number(read(MOMENTS)) || 0) + 1
    write(MOMENTS, String(moments))
    if (moments < ENOUGH_MOMENTS) return

    // Long enough that they've seen a gameweek settle, not just filled a form
    // in twice on the same evening.
    const first = Number(read(FIRST)) || Date.now()
    const days = (Date.now() - first) / 86400000
    if (days < ENOUGH_DAYS) return

    const { version } = await App.getInfo()
    if (!version || read(ASKED) === version) return

    // Written BEFORE asking. If the call fails there is something wrong with
    // the plugin, and retrying it on every save afterwards would be worse than
    // missing one rating.
    write(ASKED, version)
    await Review.requestReview()
  } catch (err) {
    console.warn('Rating prompt skipped:', err?.message || err)
  }
}
