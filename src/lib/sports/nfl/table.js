// The NFL season table. Shared by NFL Standings and the NFL Dashboard so the
// two can never disagree.
//
// TOTAL POINTS come from gameweek_scores, written by the NFL scorer when a week
// is marked completed (so they include any full house bonus), plus any season
// question points.
//
// THE COUNTS behind them (Lloyd, 10 Nov 2026: "show how many of each scoring
// option you got") are worked out here from the same finished weeks: each pick
// is run through marginScore, and each line it paid is counted. Full houses
// come from the flags the scorer stores on gameweek_scores. Weeks won counts
// the weeks where a player had the most points (ties share the win).
//
// Ties on points split on exact scores, then correct winners.
import { latestGameweek } from '../../gameweeks'
import { fetchSeasonPoints } from '../../seasonScoring'
import { marginScore, nflPointRules, MARGIN_BANDS } from './scoring'

// Supabase returns at most 1,000 rows per request, and a season of picks is
// more than that, so read in pages.
async function fetchAll(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error || !data) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

const emptyRow = (uid, name) => ({
  user_id: uid, name, points: 0, exact: 0, winners: 0, teamScores: 0,
  bands: Object.fromEntries(MARGIN_BANDS.map(b => [b.band, 0])),
  fullHouses: 0, weeksWon: 0, weeks: 0, best: 0, lastWeek: null, season: 0,
})

export async function loadNflTable(supabase, competitionId) {
  const { data: scores } = await supabase.from('gameweek_scores')
    .select('*')
    .eq('competition_id', competitionId)
  const gwIds = [...new Set((scores || []).map(s => s.gameweek_id))]
  const { data: gws } = gwIds.length
    ? await supabase.from('gameweeks').select('id, number, status').in('id', gwIds)
    : { data: [] }
  const completedIds = (gws || []).filter(g => g.status === 'completed').map(g => g.id)
  const latest = latestGameweek((gws || []).filter(g => g.status === 'completed'))

  // Season question points go into the total, as they do for football.
  const seasonPts = await fetchSeasonPoints(competitionId)
  const rules = await nflPointRules(supabase, competitionId)

  // Every pick in the finished weeks, with its game.
  const [preds, fixtures] = completedIds.length
    ? await Promise.all([
        fetchAll(() => supabase.from('predictions').select('id, user_id, fixture_id, predicted_home, predicted_away').in('gameweek_id', completedIds).order('id')),
        fetchAll(() => supabase.from('fixtures').select('id, home_score, away_score, status').in('gameweek_id', completedIds).order('id')),
      ])
    : [[], []]

  const ids = [...new Set([...(scores || []).map(s => s.user_id), ...Object.keys(seasonPts)])]
  const { data: profs } = ids.length
    ? await supabase.from('profiles').select('id, display_name').in('id', ids)
    : { data: [] }
  const names = {}; (profs || []).forEach(p => { names[p.id] = p.display_name })

  const byUser = {}
  const row = uid => (byUser[uid] ||= emptyRow(uid, names[uid] || 'Player'))

  // Totals, weeks, full houses and week wins, from gameweek_scores.
  const weekTop = {}
  for (const s of (scores || [])) {
    const u = row(s.user_id)
    u.points += s.points || 0
    u.exact += s.exact_scores || 0
    u.winners += s.correct_results || 0
    u.weeks += 1
    u.best = Math.max(u.best, s.points || 0)
    u.fullHouses += (s.full_house_results ? 1 : 0) + (s.full_house_scores ? 1 : 0)
    if (latest && s.gameweek_id === latest.id) u.lastWeek = s.points || 0
    if (completedIds.includes(s.gameweek_id)) weekTop[s.gameweek_id] = Math.max(weekTop[s.gameweek_id] ?? 0, s.points || 0)
  }
  for (const s of (scores || [])) {
    const top = weekTop[s.gameweek_id]
    if (top > 0 && (s.points || 0) === top) row(s.user_id).weeksWon += 1
  }

  // Counts of each scoring line, from the picks themselves.
  const fx = {}; (fixtures || []).forEach(f => { fx[f.id] = f })
  for (const p of (preds || [])) {
    const f = fx[p.fixture_id]
    if (!f || f.status !== 'completed' || f.home_score == null || f.away_score == null) continue
    if (!byUser[p.user_id]) continue
    const sc = marginScore(p, f, rules)
    if (!sc.isCorrectResult) continue
    const u = byUser[p.user_id]
    u.teamScores += sc.teamsExact || 0
    const line = MARGIN_BANDS.find(b => sc.marginError <= b.max)
    if (line) u.bands[line.band] += 1
  }

  for (const [uid, pts] of Object.entries(seasonPts)) {
    const u = row(uid)
    u.season = pts
    u.points += pts
  }
  const hasSeason = Object.values(seasonPts).some(p => p > 0)
  const sorted = Object.values(byUser).sort((a, b) =>
    b.points - a.points || b.exact - a.exact || b.winners - a.winners || a.name.localeCompare(b.name))
  return { list: sorted, latestLabel: latest?.number, hasSeason, rules }
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
