// NFL scoring. Kept entirely apart from src/lib/scoring.js so nothing here can
// change how football scores. Each sport gets its own folder under src/lib/sports.

export function getResult(h, a) {
  return h > a ? 'home' : a > h ? 'away' : 'draw'
}

// The NFL rule set, mirroring the defaults migration 117 seeds for an NFL
// competition. Used when a competition has no rules row to read.
export function nflDefaultRules() {
  return {
    scoring_mode: 'margin',
    exact_score_points: 0, correct_result_points: 0,
    full_house_results_bonus: 0, full_house_scores_bonus: 0,
    winner_only_points: 2, team_score_points: 5,
    margin_exact_points: 12, margin_within_2_points: 10, margin_within_4_points: 8,
    margin_within_7_points: 6, margin_within_10_points: 4, margin_within_14_points: 2,
  }
}

// How far out a prediction's MARGIN was, in points. Signed: the margin is home
// minus away on both sides, so calling the home side by 3 when the away side
// wins by 3 is out by 6, not level. Using the absolute margin would score a
// backed winner and a backed loser the same whenever the game was close, which
// is exactly backwards. Null until the fixture has a score.
export function marginError(prediction, fixture) {
  const { predicted_home: ph, predicted_away: pa } = prediction
  const { home_score: ah, away_score: aa } = fixture
  if (ah === null || aa === null || ah === undefined || aa === undefined) return null
  return Math.abs((ph - pa) - (ah - aa))
}

// The margin ladder, closest first. Exactly ONE line pays: the first one the
// prediction's margin error fits.
export const MARGIN_BANDS = [
  { band: 'exact_margin', max: 0,  key: 'margin_exact_points',     label: 'Exact margin' },
  { band: 'within_2',     max: 2,  key: 'margin_within_2_points',  label: 'Margin within 2' },
  { band: 'within_4',     max: 4,  key: 'margin_within_4_points',  label: 'Margin within 4' },
  { band: 'within_7',     max: 7,  key: 'margin_within_7_points',  label: 'Margin within 7' },
  { band: 'within_10',    max: 10, key: 'margin_within_10_points', label: 'Margin within 10' },
  { band: 'within_14',    max: 14, key: 'margin_within_14_points', label: 'Margin within 14' },
]

// NFL scoring (Lloyd, 8 Nov 2026). Three parts that ADD together, and only
// when the winner is right (a tie called as a tie counts):
//
//   1. Right winner                        winner_only_points       2
//   2. Each team's score exactly right     team_score_points        +5 per team
//   3. The margin, one line only:
//        exact                             margin_exact_points      +12
//        out by 1 to 2                     margin_within_2_points   +10
//        out by 3 to 4                     margin_within_4_points   +8
//        out by 5 to 7                     margin_within_7_points   +6
//        out by 8 to 10                    margin_within_10_points  +4
//        out by 11 to 14                   margin_within_14_points  +2
//        out by 15 or more                                          0
//
// So an exact score is 2 + 5 + 5 + 12 = 24. A wrong winner scores 0, however
// close the margin or the team scores (Lloyd, 6 Nov 2026).
//
// exact_score_points and margin_within_3_points are no longer read for NFL;
// the columns stay because football and old rows carry them.
//
// isExact and isCorrectResult mean what they mean in football (exact score;
// right winner), so gameweek_scores counts keep working. band names the margin
// line that paid ('exact_score' when both scores were exact).
export function marginScore(prediction, fixture, rules) {
  const error = marginError(prediction, fixture)
  if (error === null) return { points: 0, breakdown: [] }

  const d = nflDefaultRules()
  const r = key => Number(rules?.[key] ?? d[key]) || 0
  const { predicted_home: ph, predicted_away: pa } = prediction
  const { home_score: ah, away_score: aa } = fixture
  const isExact         = ph === ah && pa === aa
  const isCorrectResult = getResult(ph, pa) === getResult(ah, aa)

  if (!isCorrectResult) {
    return { points: 0, breakdown: [], label: null, isExact, isCorrectResult, band: 'miss', marginError: error, teamsExact: 0 }
  }

  const teamsExact = (ph === ah ? 1 : 0) + (pa === aa ? 1 : 0)
  const line = MARGIN_BANDS.find(b => error <= b.max)

  const breakdown = [{ label: 'Right winner', pts: r('winner_only_points') }]
  if (teamsExact) breakdown.push({ label: teamsExact === 2 ? 'Both team scores' : 'One team score', pts: teamsExact * r('team_score_points') })
  if (line) breakdown.push({ label: line.label, pts: r(line.key) })
  const points = breakdown.reduce((sum, b) => sum + b.pts, 0)

  const band = isExact ? 'exact_score' : line ? line.band : 'winner_only'

  // One short line for the screens, e.g. "Exact score", "Winner + 1 score +
  // within 4", "Winner + within 7", "Right winner".
  const parts = ['Winner']
  if (teamsExact === 1) parts.push('1 score')
  if (line) parts.push(line.band === 'exact_margin' ? 'exact margin' : `within ${line.max}`)
  const label = isExact ? 'Exact score' : parts.length > 1 ? parts.join(' + ') : 'Right winner'

  return { points, breakdown, label, isExact, isCorrectResult, band, marginError: error, teamsExact }
}

// The NFL points an admin can edit, in the order the Scoring tab shows them.
// Kept here, beside the scorer that reads them, so the two cannot drift.
export const NFL_RULE_FIELDS = [
  { key: 'winner_only_points',      label: 'Right winner (needed for any points)' },
  { key: 'team_score_points',       label: "Each team's score exact (per team)" },
  ...MARGIN_BANDS.map(b => ({ key: b.key, label: b.band === 'exact_margin' ? 'Exact margin' : `Margin out by ${({ within_2: '1 to 2', within_4: '3 to 4', within_7: '5 to 7', within_10: '8 to 10', within_14: '11 to 14' })[b.band]}` })),
]

// The rules an NFL competition scores by. Follows rules_source_competition_id
// the same way football does, so an NFL cup can take its points from an NFL
// league. Falls back to the NFL defaults if there is no rules row.
export async function nflPointRules(supabase, competitionId) {
  const { data: comp } = await supabase.from('competitions')
    .select('rules_source_competition_id').eq('id', competitionId).maybeSingle()
  const sourceId = comp?.rules_source_competition_id || competitionId
  const { data: rules } = await supabase.from('point_rules')
    .select('*').eq('competition_id', sourceId).maybeSingle()
  return rules || nflDefaultRules()
}

/**
 * Score one NFL gameweek for one competition.
 *
 * The NFL counterpart of football's recalculateGameweek, and deliberately
 * simpler: each game pays its one margin band and the week's score is the sum.
 * Triple Points and the full house bonuses are NOT applied — whether NFL has
 * them is still to be decided, and they are added here if it does.
 *
 * Same ground rules as football: nothing is scored until the whole gameweek is
 * marked completed, and voided games score nobody anything.
 *
 * exact_scores and correct_results are still filled in (exact score; right
 * winner), so standings that sort on them keep working.
 */
export async function recalculateNflGameweek(supabase, competitionId, gameweekId, rules) {
  const { data: gw } = await supabase.from('gameweeks').select('status').eq('id', gameweekId).single()
  if (gw?.status !== 'completed') return { skipped: true, reason: 'Gameweek not marked completed yet' }

  const { data: fixtures } = await supabase.from('fixtures').select('*').eq('gameweek_id', gameweekId)
  const fxMap = {}
  ;(fixtures || []).filter(f => f.status === 'completed').forEach(f => { fxMap[f.id] = f })

  const { data: predictions } = await supabase.from('predictions').select('*').eq('gameweek_id', gameweekId)

  const scores = {}
  for (const pred of (predictions || [])) {
    const fx = fxMap[pred.fixture_id]; if (!fx) continue
    const { points, isExact, isCorrectResult } = marginScore(pred, fx, rules)
    const uid = pred.user_id
    if (!scores[uid]) scores[uid] = { user_id: uid, points: 0, exact_scores: 0, correct_results: 0, full_house_results: false, full_house_scores: false }
    scores[uid].points += points
    if (isExact)         scores[uid].exact_scores++
    if (isCorrectResult) scores[uid].correct_results++
    await supabase.from('predictions').update({ points_earned: points }).eq('id', pred.id)
  }

  for (const s of Object.values(scores)) {
    await supabase.from('gameweek_scores').upsert(
      { competition_id: competitionId, gameweek_id: gameweekId, ...s },
      { onConflict: 'competition_id,gameweek_id,user_id' })
  }
  return scores
}

// How each result reads on screen. Green for the closest margin lines, amber
// for the middle ones, muted for the rest and a miss.
export function bandStyle(band) {
  if (band === 'exact_score' || band === 'exact_margin' || band === 'within_2') return { bg: 'var(--green-dim)', color: 'var(--green)' }
  if (band === 'within_4' || band === 'within_7') return { bg: 'rgba(245,166,35,0.14)', color: 'var(--amber)' }
  return { bg: 'var(--bg-elevated)', color: 'var(--txt-muted)' }
}

// "Philadelphia by 7", or "Tie", for a pair of scores. Null until both are in.
export function marginText(homeTeam, awayTeam, home, away) {
  if (home === '' || away === '' || home == null || away == null) return null
  const h = Number(home), a = Number(away)
  if (h === a) return 'Tie'
  return h > a ? `${homeTeam} by ${h - a}` : `${awayTeam} by ${a - h}`
}
