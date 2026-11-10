// F1 scoring. The database scores confirmed sessions (f1_score_race, 119);
// this mirrors it in the app so a running session can show what your picks
// would be worth "if it finished now", and so the Scoring tab and the guides
// show the same defaults.

// Race: the F1 points for 1st to 10th, then 1 point for 11th to 22nd (Lloyd,
// 10 Nov 2026: there are 22 drivers now). Sprint: the sprint points, 8 to 1.
export const F1_DEFAULT_RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
export const F1_DEFAULT_SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

// Every session a race weekend can have, in the order they run. Sprint
// weekends have all four; the rest only grid and race.
export const F1_SESSIONS = [
  { key: 'sprint_grid', label: 'Sprint grid', name: 'Sprint qualifying', sprint: true },
  { key: 'sprint',      label: 'Sprint',      name: 'Sprint',            sprint: true },
  { key: 'grid',        label: 'Grid',        name: 'Qualifying' },
  { key: 'race',        label: 'Race',        name: 'Race' },
]
export const sessionsFor = race => F1_SESSIONS.filter(s => !s.sprint || race?.sprint_at)
export const confirmedField = s => ({ sprint_grid: 'sprint_grid_confirmed', sprint: 'sprint_confirmed', grid: 'grid_confirmed', race: 'race_confirmed' })[s]
export const isQualiSession = s => s === 'grid' || s === 'sprint_grid'

export function f1Rules(row) {
  const race = Array.isArray(row?.f1_race_points) && row.f1_race_points.length ? row.f1_race_points : F1_DEFAULT_RACE_POINTS
  const sprint = Array.isArray(row?.f1_sprint_points) && row.f1_sprint_points.length ? row.f1_sprint_points : F1_DEFAULT_SPRINT_POINTS
  return {
    gridPoints: Number(row?.f1_grid_points ?? 5),
    gridPositions: Number(row?.f1_grid_positions ?? 22),
    racePoints: race.map(n => Number(n) || 0),
    sprintPoints: sprint.map(n => Number(n) || 0),
    racePositions: Number(row?.f1_race_positions ?? 22),
  }
}

/** The rules a competition scores by, following rules_source_competition_id. */
export async function loadF1Rules(supabase, competitionId) {
  const { data: comp } = await supabase.from('competitions')
    .select('rules_source_competition_id').eq('id', competitionId).maybeSingle()
  const sourceId = comp?.rules_source_competition_id || competitionId
  const { data } = await supabase.from('point_rules').select('*').eq('competition_id', sourceId).maybeSingle()
  return f1Rules(data)
}

/** Points one placed driver is worth if exactly right. */
export function pointsForPlace(session, position, rules) {
  if (isQualiSession(session)) return position <= rules.gridPositions ? rules.gridPoints : 0
  if (position > rules.racePositions) return 0
  return (session === 'sprint' ? rules.sprintPoints : rules.racePoints)[position - 1] || 0
}

/**
 * Score a set of picks against a result.
 *   picks:  [{ position, driver_id }]
 *   result: [{ position, driver_id }]
 * Returns { points, correct, hits: Set(position) }.
 */
export function scorePicks(session, picks, result, rules) {
  const at = new Map((result || []).filter(r => r.position).map(r => [r.position, r.driver_id]))
  let points = 0, correct = 0
  const hits = new Set()
  for (const p of picks || []) {
    if (at.get(p.position) === p.driver_id) {
      const pts = pointsForPlace(session, p.position, rules)
      points += pts; correct++; hits.add(p.position)
    }
  }
  return { points, correct, hits }
}

/** How many places the pick is out by, for the little +/- beside a driver. */
export function placesOut(pickPosition, driverId, result) {
  const r = (result || []).find(x => x.driver_id === driverId)
  return r?.position ? r.position - pickPosition : null
}
