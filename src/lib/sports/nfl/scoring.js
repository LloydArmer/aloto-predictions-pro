// NFL scoring. Kept entirely apart from src/lib/scoring.js so nothing here can
// change how football scores. Each sport gets its own folder under src/lib/sports.

export function getResult(h, a) {
  return h > a ? 'home' : a > h ? 'away' : 'draw'
}

// The NFL rule set, mirroring the defaults migration 111 seeds for an NFL
// competition. Used when a competition has no rules row to read.
export function nflDefaultRules() {
  return {
    scoring_mode: 'margin',
    exact_score_points: 20, correct_result_points: 0,
    full_house_results_bonus: 0, full_house_scores_bonus: 0,
    margin_exact_points: 12, margin_within_3_points: 9, margin_within_7_points: 6,
    margin_within_14_points: 3, winner_only_points: 1,
  }
}

// How far out a prediction's MARGIN was, in points. Signed: the margin is home
// minus away on both sides, so calling the home side by 3 when the away side
// wins by 3 is out by 6 — a touchdown — not level. Using the absolute margin
// would score a backed winner and a backed loser the same whenever the game was
// close, which is exactly backwards. Null until the fixture has a score.
export function marginError(prediction, fixture) {
  const { predicted_home: ph, predicted_away: pa } = prediction
  const { home_score: ah, away_score: aa } = fixture
  if (ah === null || aa === null || ah === undefined || aa === undefined) return null
  return Math.abs((ph - pa) - (ah - aa))
}

// Margin scoring. Exactly ONE band pays — the best one the prediction reaches —
// never a stack of them:
//
//   exact score        exact_score_points        (20 by default for NFL)
//   exact margin       margin_exact_points       (12)
//   out by 1 to 3      margin_within_3_points    (9)  a field goal
//   out by 4 to 7      margin_within_7_points    (6)  a touchdown
//   out by 8 to 14     margin_within_14_points   (3)  two scores
//   further out, right winner   winner_only_points   (1)
//   anything else      0
//
// correct_result_points is not used here at all: calling the winner is what
// winner_only_points pays, and NFL rules carry correct_result_points = 0.
//
// isExact and isCorrectResult mean what they mean in football (exact score;
// right winner, or a tie called as a tie), so gameweek_scores counts and the
// full house bonuses keep working unchanged. band names which line paid.
export function marginScore(prediction, fixture, rules) {
  const error = marginError(prediction, fixture)
  if (error === null) return { points: 0, breakdown: [] }

  const d = nflDefaultRules()
  const r = key => rules?.[key] ?? d[key]
  const { predicted_home: ph, predicted_away: pa } = prediction
  const { home_score: ah, away_score: aa } = fixture
  const isExact         = ph === ah && pa === aa
  const isCorrectResult = getResult(ph, pa) === getResult(ah, aa)

  let band, label, points
  if (isExact)               { band = 'exact_score';  label = 'Exact score';        points = r('exact_score_points') }
  else if (error === 0)      { band = 'exact_margin'; label = 'Exact margin';       points = r('margin_exact_points') }
  else if (error <= 3)       { band = 'within_3';     label = 'Margin within 3';    points = r('margin_within_3_points') }
  else if (error <= 7)       { band = 'within_7';     label = 'Margin within 7';    points = r('margin_within_7_points') }
  else if (error <= 14)      { band = 'within_14';    label = 'Margin within 14';   points = r('margin_within_14_points') }
  else if (isCorrectResult)  { band = 'winner_only';  label = 'Right winner';       points = r('winner_only_points') }
  else                       { band = 'miss';         label = null;                 points = 0 }

  const breakdown = label ? [{ label, pts: points }] : []
  return { points, breakdown, isExact, isCorrectResult, band, marginError: error }
}

// The NFL points an admin can edit, in the order the Scoring tab shows them.
// Kept here, beside the scorer that reads them, so the two cannot drift.
export const NFL_RULE_FIELDS = [
  { key: 'exact_score_points',      label: 'Exact score' },
  { key: 'margin_exact_points',     label: 'Exact margin' },
  { key: 'margin_within_3_points',  label: 'Margin within 3 (a field goal)' },
  { key: 'margin_within_7_points',  label: 'Margin within 7 (a touchdown)' },
  { key: 'margin_within_14_points', label: 'Margin within 14 (two scores)' },
  { key: 'winner_only_points',      label: 'Right winner, nothing else' },
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
