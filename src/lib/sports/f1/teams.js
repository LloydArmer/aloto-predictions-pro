// F1 team colours, matched on the team's name from the feed (which changes
// with sponsors, so the match is loose). Only used for the stripe beside a
// driver; anything unmatched gets the app's purple.
const TEAMS = [
  [/mclaren/i,               '#FF8000'],
  [/ferrari/i,               '#E8002D'],
  [/racing bulls|rb f1|visa|alphatauri/i, '#6692FF'],
  [/red bull/i,              '#3671C6'],
  [/mercedes/i,              '#27F4D2'],
  [/aston/i,                 '#229971'],
  [/alpine/i,                '#0093CC'],
  [/williams/i,              '#64C4FF'],
  [/haas/i,                  '#B6BABD'],
  [/audi|sauber|kick/i,      '#FF2D2D'],
  [/cadillac/i,              '#C9A227'],
]

export function teamColour(name) {
  const hit = TEAMS.find(([re]) => re.test(name || ''))
  return hit ? hit[1] : 'var(--accent)'
}

// "Max Verstappen" -> "Verstappen"; keeps "Zhou Guanyu"-style names whole
// when there is no obvious surname.
export function surname(name) {
  const parts = String(name || '').trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || ''
}
