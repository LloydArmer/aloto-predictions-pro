/**
 * Shortening display names for narrow columns.
 *
 * A grid column on a phone is around 100px. "Matt Haworth" doesn't fit, and
 * letting CSS truncate it gives "Matt Hawor…" — which spends the whole column
 * on a surname nobody can read anyway. "Matt H." says more in less space.
 *
 * Only used where the column is genuinely too narrow. Anywhere with room shows
 * the full name.
 */

/**
 * "Matt Haworth" -> "Matt H."
 * "Mickefc2103"  -> "Mickefc2103"   (one word, nothing to shorten)
 * "Lloyd Armer"  -> "Lloyd A."
 *
 * Single-word names are returned untouched: chopping "Mickefc2103" to
 * "Mickefc…" loses the only thing identifying them.
 */
export function shortName(name) {
  if (!name) return ''
  const parts = String(name).trim().split(/\s+/)
  if (parts.length === 1) return parts[0]

  const first = parts[0]
  const lastInitial = parts[parts.length - 1][0]
  return `${first} ${lastInitial.toUpperCase()}.`
}

/**
 * The same, but only shortens when the full name is longer than the column can
 * take. Below the threshold the full name is kept — "Joe" and "Carl" shouldn't
 * be touched, and neither should "Lewis Armer" where it fits.
 *
 * The default suits a name cell of roughly 40% of screen width. Narrower
 * columns should pass a lower number: the predictions grid uses 10, because 13
 * still let "Mark Haworth" overflow it.
 */
export function fitName(name, maxChars = 13) {
  if (!name) return ''
  return name.length <= maxChars ? name : shortName(name)
}
