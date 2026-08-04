export function getResult(h, a) {
  return h > a ? 'home' : a > h ? 'away' : 'draw'
}

export function scoreOnePrediction(prediction, fixture, rules) {
  const { predicted_home: ph, predicted_away: pa } = prediction
  const { home_score: ah, away_score: aa } = fixture
  if (ah === null || aa === null) return { points: 0, breakdown: [] }

  let points = 0; const breakdown = []
  const isExact         = ph === ah && pa === aa
  const isCorrectResult = getResult(ph, pa) === getResult(ah, aa)

  if (isExact) {
    points += rules.exact_score_points
    breakdown.push({ label: 'Exact score', pts: rules.exact_score_points })
  } else if (isCorrectResult) {
    points += rules.correct_result_points
    breakdown.push({ label: 'Correct result', pts: rules.correct_result_points })
  }
  if (rules.clean_sheet_bonus > 0) {
    if (aa === 0 && pa === 0) { points += rules.clean_sheet_bonus; breakdown.push({ label: 'Clean sheet (home)', pts: rules.clean_sheet_bonus }) }
    if (ah === 0 && ph === 0) { points += rules.clean_sheet_bonus; breakdown.push({ label: 'Clean sheet (away)', pts: rules.clean_sheet_bonus }) }
  }
  return { points, breakdown, isExact, isCorrectResult }
}

export function outcomeLabel(prediction, fixture) {
  if (!fixture || fixture.home_score === null) return 'upcoming'
  const { predicted_home: ph, predicted_away: pa } = prediction
  const { home_score: ah, away_score: aa } = fixture
  if (ph === ah && pa === aa) return 'exact'
  if (getResult(ph, pa) === getResult(ah, aa)) return 'result'
  return 'miss'
}

export function defaultRules() {
  return { exact_score_points: 5, correct_result_points: 2, clean_sheet_bonus: 1, correct_finalist_points: 5, correct_winner_points: 10 }
}

export async function recalculateGameweek(supabase, gameweekId, rules) {
  const { data: fixtures } = await supabase.from('fixtures').select('*').eq('gameweek_id', gameweekId).eq('status', 'completed')
  const { data: predictions } = await supabase.from('predictions').select('*').eq('gameweek_id', gameweekId)
  const fxMap = {}; (fixtures||[]).forEach(f => { fxMap[f.id] = f })
  const scores = {}
  for (const pred of (predictions||[])) {
    const fx = fxMap[pred.fixture_id]; if (!fx) continue
    const { points, isExact, isCorrectResult } = scoreOnePrediction(pred, fx, rules)
    const uid = pred.user_id
    if (!scores[uid]) scores[uid] = { user_id: uid, points: 0, exact_scores: 0, correct_results: 0 }
    scores[uid].points         += points
    if (isExact)         scores[uid].exact_scores++
    if (isCorrectResult) scores[uid].correct_results++
    await supabase.from('predictions').update({ points_earned: points }).eq('id', pred.id)
  }
  for (const s of Object.values(scores)) {
    await supabase.from('gameweek_scores').upsert({ gameweek_id: gameweekId, ...s }, { onConflict: 'gameweek_id,user_id' })
  }
  return scores
}
