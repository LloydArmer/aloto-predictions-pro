import { teamColour, surname } from '../../../lib/sports/f1/teams'

/** A driver as a row for F1OrderPicker. */
export const driverItem = d => ({
  id: d.id,
  tag: d.abbr || null,
  title: surname(d.name),
  subtitle: d.team?.name || '',
  colour: teamColour(d.team?.name),
})

/** A team as a row for F1OrderPicker. */
export const teamItem = t => ({ id: t.id, title: t.name, colour: teamColour(t.name) })

/** Put `all` in the order of `ids`, anything missing after, in its own order. */
export function inOrder(all, ids) {
  const byId = new Map(all.map(x => [x.id, x]))
  const first = ids.map(id => byId.get(id)).filter(Boolean)
  const seen = new Set(first.map(x => x.id))
  return [...first, ...all.filter(x => !seen.has(x.id))]
}
