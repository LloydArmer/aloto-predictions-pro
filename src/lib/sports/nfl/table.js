// The NFL season table: every player's total from gameweek_scores (written
// by the NFL scorer when a week is marked completed) plus any season question
// points. Ties split on exact scores, then right winners. Shared by the NFL
// Standings and the NFL Dashboard so the two can never disagree.
import { latestGameweek } from '../../gameweeks'
import { fetchSeasonPoints } from '../../seasonScoring'

export async function loadNflTable(supabase, competitionId) {
  const { data: scores } = await supabase.from('gameweek_scores')
    .select('user_id, gameweek_id, points, exact_scores, correct_results')
    .eq('competition_id', competitionId)
  const { data: gws } = await supabase.from('gameweeks').select('id, number, status')
    .in('id', [...new Set((scores || []).map(s => s.gameweek_id))])
  const latest = latestGameweek((gws || []).filter(g => g.status === 'completed'))
  // Season question points go into the total, as they do for football.
  const seasonPts = await fetchSeasonPoints(competitionId)
  const ids = [...new Set([...(scores || []).map(s => s.user_id), ...Object.keys(seasonPts)])]
  const { data: profs } = ids.length
    ? await supabase.from('profiles').select('id, display_name').in('id', ids)
    : { data: [] }
  const names = {}; (profs || []).forEach(p => { names[p.id] = p.display_name })

  const byUser = {}
  for (const s of (scores || [])) {
    const u = byUser[s.user_id] ||= { user_id: s.user_id, name: names[s.user_id] || 'Player', points: 0, exact: 0, winners: 0, weeks: 0, best: 0, lastWeek: null }
    u.points += s.points || 0
    u.exact += s.exact_scores || 0
    u.winners += s.correct_results || 0
    u.weeks += 1
    u.best = Math.max(u.best, s.points || 0)
    if (latest && s.gameweek_id === latest.id) u.lastWeek = s.points || 0
  }
  for (const [uid, pts] of Object.entries(seasonPts)) {
    const u = byUser[uid] ||= { user_id: uid, name: names[uid] || 'Player', points: 0, exact: 0, winners: 0, weeks: 0, best: 0, lastWeek: null }
    u.season = pts
    u.points += pts
  }
  const hasSeason = Object.values(seasonPts).some(p => p > 0)
  const sorted = Object.values(byUser).sort((a, b) =>
    b.points - a.points || b.exact - a.exact || b.winners - a.winners || a.name.localeCompare(b.name))
  return { list: sorted, latestLabel: latest?.number, hasSeason }
}

// Rank for each row, with equal points sharing a rank.
export function withRanks(list) {
  let rank = 0, prev = null
  return list.map((r, i) => {
    if (prev === null || r.points !== prev) rank = i + 1
    prev = r.points
    return { ...r, rank }
  })
}
