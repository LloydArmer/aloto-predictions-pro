/**
 * Putting gameweeks in order.
 *
 * gameweeks.number is TEXT in the database, and it holds whatever an admin
 * typed — "GW1" in one competition, "1" in another. Asking the database to
 * sort by it gives an alphabetical order, which is identical to the right
 * answer up to GW9 and wrong from GW10 onwards:
 *
 *     alphabetical:  GW1, GW10, GW11, GW12, GW2, GW3 ... GW9
 *     what you want: GW1, GW2, GW3 ... GW9, GW10, GW11, GW12
 *
 * That is why the dashboard sat on GW9 while the group stage card correctly
 * said GW11: it asked for the highest and alphabetically "GW9" is the highest.
 * The bug could not appear until a tenth gameweek existed, which is why it
 * looked correct for an entire season.
 *
 * Every place that orders gameweeks goes through here, so there is one
 * definition of "later" rather than seven.
 */

/** The digits in a gameweek number, as a number. "GW11" and "11" both give 11. */
export function gameweekOrder(gw) {
  const digits = String(gw?.number ?? '').replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}

/**
 * A sorted copy — the original is left alone, because callers hand us arrays
 * that are already in state somewhere.
 *
 * Ties keep the order the database gave them. Two competitions can each have a
 * gameweek "1", and shuffling those against each other on every render would
 * make the admin's dropdown jump about.
 */
export function sortGameweeks(list, { descending = false } = {}) {
  return [...(list || [])].sort((a, b) =>
    descending ? gameweekOrder(b) - gameweekOrder(a)
               : gameweekOrder(a) - gameweekOrder(b))
}

/** The latest gameweek in a list, by number rather than by alphabet. */
export function latestGameweek(list) {
  return sortGameweeks(list, { descending: true })[0] || null
}
