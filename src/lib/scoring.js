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
  return { exact_score_points: 5, correct_result_points: 2, full_house_results_bonus: 0, full_house_scores_bonus: 0 }
}

export async function recalculateGameweek(supabase, gameweekId, rules) {
  const { data: fixtures } = await supabase.from('fixtures').select('*').eq('gameweek_id', gameweekId)
  const completedFixtures = (fixtures || []).filter(f => f.status === 'completed')
  const { data: predictions } = await supabase.from('predictions').select('*').eq('gameweek_id', gameweekId)
  const fxMap = {}; completedFixtures.forEach(f => { fxMap[f.id] = f })
  const scores = {}
  const byUser = {}
  for (const pred of (predictions||[])) {
    if (!byUser[pred.user_id]) byUser[pred.user_id] = []
    byUser[pred.user_id].push(pred)

    const fx = fxMap[pred.fixture_id]; if (!fx) continue
    const { points, isExact, isCorrectResult } = scoreOnePrediction(pred, fx, rules)
    const uid = pred.user_id
    if (!scores[uid]) scores[uid] = { user_id: uid, points: 0, exact_scores: 0, correct_results: 0, full_house_results: false, full_house_scores: false }
    scores[uid].points         += points
    if (isExact)         scores[uid].exact_scores++
    if (isCorrectResult) scores[uid].correct_results++
    await supabase.from('predictions').update({ points_earned: points }).eq('id', pred.id)
  }

  // Full house bonuses — did this user predict every completed fixture in the
  // gameweek, and were all of them at least correct results / all exact scores?
  if (completedFixtures.length > 0) {
    for (const [uid, userPreds] of Object.entries(byUser)) {
      const predMap = {}; userPreds.forEach(p => { predMap[p.fixture_id] = p })
      const coversAll = completedFixtures.every(f => predMap[f.id])
      if (!coversAll) continue
      const allCorrectResult = completedFixtures.every(f => {
        const p = predMap[f.id]
        return scoreOnePrediction(p, f, rules).isCorrectResult
      })
      const allExact = completedFixtures.every(f => {
        const p = predMap[f.id]
        return scoreOnePrediction(p, f, rules).isExact
      })
      if (!scores[uid]) scores[uid] = { user_id: uid, points: 0, exact_scores: 0, correct_results: 0, full_house_results: false, full_house_scores: false }
      if (allCorrectResult) { scores[uid].full_house_results = true; scores[uid].points += rules.full_house_results_bonus || 0 }
      if (allExact)         { scores[uid].full_house_scores  = true; scores[uid].points += rules.full_house_scores_bonus  || 0 }
    }
  }

  for (const s of Object.values(scores)) {
    await supabase.from('gameweek_scores').upsert({ gameweek_id: gameweekId, ...s }, { onConflict: 'gameweek_id,user_id' })
  }
  return scores
}

// Bracket scoring — participant vs participant.
//
// A "round" (e.g. 'sf', 'f') is mapped to one or more gameweeks via the
// bracket_round_gameweeks table, admin-assigned. To resolve a round,
// each match's two participants have their gameweek_scores points
// (across that round's assigned gameweeks) summed and compared:
//   1. Higher total points wins.
//   2. Tied on points → higher total exact_scores wins.
//   3. Still tied → higher total correct_results wins.
//   4. Still tied → left unresolved for the admin to pick manually.
// A match with only one participant set (a "bye") is auto-completed
// with that participant as the winner, no points comparison needed.
export async function resolveBracketRound(supabase, competitionId, round) {
  const { data: roundGws } = await supabase.from('bracket_round_gameweeks').select('gameweek_id').eq('competition_id', competitionId).eq('round', round)
  const gwIds = (roundGws || []).map(r => r.gameweek_id)

  const { data: matches } = await supabase.from('bracket_matches').select('*').eq('competition_id', competitionId).eq('round', round)
  const results = { resolved: 0, tied: [] }

  for (const m of (matches || [])) {
    if (m.status === 'completed') continue

    // Bye — only one side of the matchup is set
    if (m.home_user_id && !m.away_user_id) {
      await supabase.from('bracket_matches').update({ winner_user_id: m.home_user_id, status: 'completed' }).eq('id', m.id)
      results.resolved++; continue
    }
    if (m.away_user_id && !m.home_user_id) {
      await supabase.from('bracket_matches').update({ winner_user_id: m.away_user_id, status: 'completed' }).eq('id', m.id)
      results.resolved++; continue
    }
    if (!m.home_user_id || !m.away_user_id || !gwIds.length) continue

    const { data: scores } = await supabase.from('gameweek_scores').select('user_id,points,exact_scores,correct_results')
      .in('gameweek_id', gwIds).in('user_id', [m.home_user_id, m.away_user_id])

    const totals = { [m.home_user_id]: { points: 0, exact: 0, correct: 0 }, [m.away_user_id]: { points: 0, exact: 0, correct: 0 } }
    for (const s of (scores || [])) {
      totals[s.user_id].points  += s.points || 0
      totals[s.user_id].exact   += s.exact_scores || 0
      totals[s.user_id].correct += s.correct_results || 0
    }
    const h = totals[m.home_user_id], a = totals[m.away_user_id]

    let winner = null
    if (h.points !== a.points) winner = h.points > a.points ? m.home_user_id : m.away_user_id
    else if (h.exact !== a.exact) winner = h.exact > a.exact ? m.home_user_id : m.away_user_id
    else if (h.correct !== a.correct) winner = h.correct > a.correct ? m.home_user_id : m.away_user_id

    if (winner) {
      await supabase.from('bracket_matches').update({
        winner_user_id: winner, home_points: h.points, away_points: a.points, status: 'completed',
      }).eq('id', m.id)
      results.resolved++
    } else {
      await supabase.from('bracket_matches').update({ home_points: h.points, away_points: a.points }).eq('id', m.id)
      results.tied.push(m.id)
    }
  }

  return results
}
