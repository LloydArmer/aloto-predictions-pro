import { sortGameweeks } from '../../gameweeks'

/**
 * The races of an F1 competition, oldest first, each with its gameweek.
 * Cancelled races are kept (so the round numbers make sense) and flagged.
 */
export async function loadF1Races(supabase, competitionId) {
  const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', competitionId)
  const ids = (links || []).map(l => l.gameweek_id)
  if (!ids.length) return []
  const [{ data: gws }, { data: races }] = await Promise.all([
    supabase.from('gameweeks').select('*').in('id', ids),
    supabase.from('f1_races').select('*').in('gameweek_id', ids),
  ])
  const byGw = new Map((races || []).map(r => [r.gameweek_id, r]))
  return sortGameweeks(gws || [])
    .map(gw => byGw.get(gw.id) ? { ...byGw.get(gw.id), gameweek: gw } : null)
    .filter(Boolean)
    .sort((a, b) => new Date(a.race_at) - new Date(b.race_at))
}

/** The next race that has not finished, else the last one. */
export function currentRace(races) {
  const live = races.filter(r => r.status !== 'cancelled')
  return live.find(r => !r.race_confirmed && r.status !== 'completed') || live[live.length - 1] || null
}

/** Drivers of a season, with their team, in championship order. */
export async function loadF1Drivers(supabase, season) {
  const [{ data: drivers }, { data: teams }] = await Promise.all([
    supabase.from('f1_drivers').select('*').eq('season', season).eq('active', true).order('sort_order'),
    supabase.from('f1_teams').select('*').eq('season', season).order('sort_order'),
  ])
  const teamById = new Map((teams || []).map(t => [t.id, t]))
  return {
    drivers: (drivers || []).map(d => ({ ...d, team: teamById.get(d.team_id) || null })),
    teams: teams || [],
  }
}

export async function loadF1Results(supabase, raceId) {
  const { data } = await supabase.from('f1_results').select('*').eq('race_id', raceId).order('position')
  const out = { sprint_grid: [], sprint: [], grid: [], race: [] }
  ;(data || []).forEach(r => out[r.session]?.push(r))
  return out
}

/** Your picks for one race: { grid: [...], race: [...] } ordered by position. */
export async function loadF1Picks(supabase, raceId, userId) {
  const { data } = await supabase.from('f1_picks').select('*').eq('race_id', raceId).eq('user_id', userId).order('position')
  const out = { sprint_grid: [], sprint: [], grid: [], race: [] }
  ;(data || []).forEach(p => out[p.session]?.push(p))
  return out
}

/** When a session locks. */
export const lockTime = (race, session) => new Date(
  session === 'sprint_grid' ? (race.sprint_qualifying_at || race.sprint_at)
  : session === 'sprint' ? race.sprint_at
  : session === 'grid' ? (race.qualifying_at || race.race_at)
  : race.race_at)

export const isLocked = (race, session) => Date.now() >= +lockTime(race, session)

/**
 * The F1 league table: each player's grid, race and season points.
 * Season points come from season_scores (settled, or "if it ended now").
 */
export async function loadF1Table(supabase, competitionId) {
  const [{ data: parts }, { data: scores }, { data: season }] = await Promise.all([
    supabase.from('participants').select('user_id, profiles:user_id(display_name)').eq('competition_id', competitionId),
    supabase.from('f1_race_scores').select('*').eq('competition_id', competitionId),
    supabase.from('season_scores').select('*').eq('competition_id', competitionId),
  ])
  const rows = new Map()
  ;(parts || []).forEach(p => rows.set(p.user_id, {
    user_id: p.user_id, name: p.profiles?.display_name || 'Player',
    grid: 0, gridCorrect: 0, race: 0, raceCorrect: 0, sprint: 0, sprintCorrect: 0, season: 0, races: 0, points: 0, byRace: {},
  }))
  ;(scores || []).forEach(s => {
    const r = rows.get(s.user_id); if (!r) return
    // Grid = both qualifying picks (grid and sprint grid); Sprint = the sprint finish.
    r.grid += s.grid_points + (s.sprint_grid_points || 0); r.gridCorrect += s.grid_correct + (s.sprint_grid_correct || 0)
    r.race += s.race_points; r.raceCorrect += s.race_correct
    r.sprint += s.sprint_points || 0; r.sprintCorrect += s.sprint_correct || 0
    r.races++
    r.byRace[s.race_id] = s.grid_points + s.race_points + (s.sprint_grid_points || 0) + (s.sprint_points || 0)
  })
  ;(season || []).forEach(s => {
    const r = rows.get(s.user_id); if (r) r.season = (s.table_points || 0) + (s.picks_points || 0)
  })
  const list = [...rows.values()].map(r => ({ ...r, points: r.grid + r.race + r.sprint + r.season }))
  list.sort((a, b) => b.points - a.points || b.race - a.race || b.grid - a.grid || a.name.localeCompare(b.name))
  let rank = 0, prev = null
  list.forEach((r, i) => { if (r.points !== prev) { rank = i + 1; prev = r.points } r.rank = rank })
  return list
}
