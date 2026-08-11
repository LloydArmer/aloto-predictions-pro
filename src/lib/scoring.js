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

  // Correct result and exact score are additive: every correct result earns
  // its base points, and an exact score earns an ADDITIONAL bonus on top —
  // not a replacement total. (An exact score is always also a correct
  // result, so isCorrectResult is true whenever isExact is.)
  if (isCorrectResult) {
    points += rules.correct_result_points
    breakdown.push({ label: 'Correct result', pts: rules.correct_result_points })
  }
  if (isExact) {
    points += rules.exact_score_points
    breakdown.push({ label: 'Exact score bonus', pts: rules.exact_score_points })
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

export async function recalculateGameweek(supabase, competitionId, gameweekId, rules) {
  // Nothing is scored until the WHOLE gameweek is marked completed — not
  // as individual results trickle in. Partial scoring during the week
  // would let players see live, incomplete standings, which isn't the
  // intended behaviour.
  const { data: gw } = await supabase.from('gameweeks').select('status').eq('id', gameweekId).single()
  if (gw?.status !== 'completed') return { skipped: true, reason: 'Gameweek not marked completed yet' }

  const { data: fixtures } = await supabase.from('fixtures').select('*').eq('gameweek_id', gameweekId)
  const completedFixtures = (fixtures || []).filter(f => f.status === 'completed')
  const { data: predictions } = await supabase.from('predictions').select('*').eq('gameweek_id', gameweekId)
  const { data: tpPlays } = await supabase.from('triple_points_plays').select('user_id').eq('competition_id', competitionId).eq('gameweek_id', gameweekId)
  const tripleUsers = new Set((tpPlays || []).map(t => t.user_id))

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
    // Note: predictions.points_earned is shared across every competition a
    // gameweek is linked to, so if competitions have different point rules
    // this will reflect whichever competition was recalculated most
    // recently — a known limitation for shared gameweeks with differing
    // rules, not relevant for the common single-competition case.
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

  // Triple Points — multiplies everything this user earned this gameweek in
  // THIS competition (including full house bonuses), only ever set for
  // League-format competitions (enforced when the play was recorded).
  for (const s of Object.values(scores)) {
    if (tripleUsers.has(s.user_id)) {
      s.points *= 3
      s.triple_points = true
    }
  }

  for (const s of Object.values(scores)) {
    await supabase.from('gameweek_scores').upsert({ competition_id: competitionId, gameweek_id: gameweekId, ...s }, { onConflict: 'competition_id,gameweek_id,user_id' })
  }
  return scores
}

// A gameweek's fixtures/predictions are shared across every competition
// it's linked to (via competition_gameweeks), but each competition scores
// them separately with its own rules — so whenever a result changes, every
// linked competition needs its own recalculation, not just one.
export async function recalculateGameweekForAllLinkedCompetitions(supabase, gameweekId) {
  const { data: links } = await supabase.from('competition_gameweeks').select('competition_id').eq('gameweek_id', gameweekId)
  const competitionIds = [...new Set((links || []).map(l => l.competition_id))]
  for (const competitionId of competitionIds) {
    const { data: rules } = await supabase.from('point_rules').select('*').eq('competition_id', competitionId).maybeSingle()
    if (rules) await recalculateGameweek(supabase, competitionId, gameweekId, rules)
  }
  return competitionIds
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
  const roundGwIds = (roundGws || []).map(r => r.gameweek_id)

  const { data: matches } = await supabase.from('bracket_matches').select('*').eq('competition_id', competitionId).eq('round', round)
  const results = { resolved: 0, replaysScheduled: 0 }

  async function advance(match, winnerId) {
    if (match.feeds_into_match_id && match.feeds_into_side) {
      await supabase.from('bracket_matches').update({ [match.feeds_into_side + '_user_id']: winnerId }).eq('id', match.feeds_into_match_id)
    }
  }

  for (const m of (matches || [])) {
    if (m.status === 'completed') continue

    // Bye — only one side of the matchup is set
    if (m.home_user_id && !m.away_user_id) {
      await supabase.from('bracket_matches').update({ winner_user_id: m.home_user_id, status: 'completed' }).eq('id', m.id)
      await advance(m, m.home_user_id)
      results.resolved++; continue
    }
    if (m.away_user_id && !m.home_user_id) {
      await supabase.from('bracket_matches').update({ winner_user_id: m.away_user_id, status: 'completed' }).eq('id', m.id)
      await advance(m, m.away_user_id)
      results.resolved++; continue
    }
    // A match assigned its own gameweek (e.g. a replay) uses that one
    // specifically; otherwise it falls back to the round's shared mapping.
    const gwIds = m.gameweek_id ? [m.gameweek_id] : roundGwIds
    if (!m.home_user_id || !m.away_user_id || !gwIds.length) continue

    const { data: scores } = await supabase.from('gameweek_scores').select('user_id,points')
      .eq('competition_id', competitionId).in('gameweek_id', gwIds).in('user_id', [m.home_user_id, m.away_user_id])

    const totals = { [m.home_user_id]: 0, [m.away_user_id]: 0 }
    for (const s of (scores || [])) totals[s.user_id] += s.points || 0
    const h = totals[m.home_user_id], a = totals[m.away_user_id]

    if (h !== a) {
      const winner = h > a ? m.home_user_id : m.away_user_id
      await supabase.from('bracket_matches').update({
        winner_user_id: winner, home_points: h, away_points: a, status: 'completed',
      }).eq('id', m.id)
      await advance(m, winner)
      results.resolved++
    } else {
      // A genuine draw — automatically schedule a replay between the same
      // two participants, rather than requiring a manual winner pick. The
      // replay inherits this match's forward link (it's now the one that
      // decides who advances); the original match no longer carries one.
      await supabase.from('bracket_matches').update({
        home_points: h, away_points: a, status: 'replay_scheduled', feeds_into_match_id: null, feeds_into_side: null,
      }).eq('id', m.id)
      await supabase.from('bracket_matches').insert({
        competition_id: competitionId, round: m.round, round_order: m.round_order,
        home_user_id: m.home_user_id, away_user_id: m.away_user_id,
        feeds_into_match_id: m.feeds_into_match_id, feeds_into_side: m.feeds_into_side,
        is_replay: true,
      })
      results.replaysScheduled++
    }
  }

  return results
}
