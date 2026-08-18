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
  if (!prediction) return 'no_prediction'
  const { predicted_home: ph, predicted_away: pa } = prediction
  const { home_score: ah, away_score: aa } = fixture
  if (ph === ah && pa === aa) return 'exact'
  if (getResult(ph, pa) === getResult(ah, aa)) return 'result'
  return 'miss'
}

// A Knockout/Group+Knockout competition doesn't run its own separate
// scoring rules — it borrows whichever League competition's rules the
// admin has chosen, via competitions.rules_source_competition_id. This
// resolves the actual rules to use for a given competition, following
// that reference if one is set.
export async function resolvePointRules(supabase, competitionId) {
  const { data: comp } = await supabase.from('competitions').select('rules_source_competition_id').eq('id', competitionId).maybeSingle()
  const sourceId = comp?.rules_source_competition_id || competitionId
  const { data: rules } = await supabase.from('point_rules').select('*').eq('competition_id', sourceId).maybeSingle()
  return rules
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
  // A VOIDED fixture is out of the gameweek entirely — postponed, abandoned, or
  // called off. It scores nobody anything and, crucially, it does not stop a
  // full house: without this, one postponed match would deny the bonus to every
  // participant, since "every fixture completed" could never become true.
  const liveFixtures = (fixtures || []).filter(f => f.status !== 'void')
  const completedFixtures = liveFixtures.filter(f => f.status === 'completed')
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

  // Full house bonuses. Two conditions, both required:
  //
  //  1. EVERY fixture in the gameweek has been completed. Judging a full house
  //     on the subset that happens to have finished would award the bonus to
  //     someone whose remaining fixture then goes on to break the run.
  //  2. The participant predicted EVERY fixture in the gameweek. Missing one
  //     voids both bonuses outright, however good the predictions they did
  //     make were — a full house means the whole gameweek, not the part of it
  //     they turned up for.
  //
  // Both conditions are measured against the LIVE fixtures — voided ones are
  // excluded from the count and nobody is penalised for not having predicted
  // them.
  const everyFixtureCompleted = liveFixtures.length > 0 && completedFixtures.length === liveFixtures.length
  if (everyFixtureCompleted) {
    for (const [uid, userPreds] of Object.entries(byUser)) {
      const predMap = {}; userPreds.forEach(p => { predMap[p.fixture_id] = p })
      const coversAll = liveFixtures.every(f => predMap[f.id])
      if (!coversAll) continue
      const allCorrectResult = liveFixtures.every(f => scoreOnePrediction(predMap[f.id], f, rules).isCorrectResult)
      const allExact         = liveFixtures.every(f => scoreOnePrediction(predMap[f.id], f, rules).isExact)
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
    const rules = await resolvePointRules(supabase, competitionId)
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
  const all = matches || []
  const results = { resolved: 0, replaysScheduled: 0, notReady: 0, surplusRemoved: 0 }

  const samePair = (x, y) =>
    (x.home_user_id === y.home_user_id && x.away_user_id === y.away_user_id) ||
    (x.home_user_id === y.away_user_id && x.away_user_id === y.home_user_id)

  // A matchup is a CHAIN: the original, then replay 1, then replay 2, and so on,
  // in creation order. Both helpers below reason about that chain rather than
  // about a single match in isolation.
  const laterLegs = m => all.filter(r =>
    r.is_replay && r.id !== m.id && samePair(r, m) &&
    new Date(r.created_at) > new Date(m.created_at))

  // Only the LAST leg of a chain can spawn a replay. Checking merely for an
  // *unsettled* replay wasn't enough: once a replay was completed it stopped
  // counting, so the original — still drawn, still not completed — scheduled a
  // fresh replay on every resolve run, forever.
  const hasLaterLeg = m => laterLegs(m).length > 0

  // The leg that actually settled this matchup, if a later one has been decided.
  const deciderFor = m => laterLegs(m).find(r => r.status === 'completed' && r.winner_user_id)

  // A leg created AFTER the matchup was already won. A healthy chain never
  // produces one — an earlier leg is only followed by another if it was DRAWN,
  // never if it was won — so these are leftovers from the runaway-replay bug.
  const followsADecidedLeg = m => all.some(r =>
    r.id !== m.id && samePair(r, m) &&
    new Date(r.created_at) < new Date(m.created_at) &&
    r.status === 'completed' && r.winner_user_id)

  for (const m of all) {
    if (m.status === 'completed') continue

    // Clear out those leftovers. Only ones that were never played are removed,
    // so nothing with a real result is discarded. Left in place they sat
    // permanently unresolved and held the whole round open.
    if (m.is_replay && !m.gameweek_id && followsADecidedLeg(m)) {
      await supabase.from('bracket_matches').delete().eq('id', m.id)
      results.surplusRemoved++
      continue
    }

    // Settled by a later leg. The winner of the replay is the winner of the
    // matchup, so record it here and close this leg off. Left sitting at
    // 'replay_scheduled', the original kept the round permanently "in progress"
    // — which is what stopped the next round from being resolvable — and, being
    // still drawn on its own gameweek, kept generating further replays.
    const decider = deciderFor(m)
    if (decider) {
      await supabase.from('bracket_matches').update({
        winner_user_id: decider.winner_user_id, status: 'completed',
      }).eq('id', m.id)
      results.resolved++
      continue
    }

    // Bye — only one side of the matchup is set
    if (m.home_user_id && !m.away_user_id) {
      await supabase.from('bracket_matches').update({ winner_user_id: m.home_user_id, status: 'completed' }).eq('id', m.id)
      results.resolved++; continue
    }
    if (m.away_user_id && !m.home_user_id) {
      await supabase.from('bracket_matches').update({ winner_user_id: m.away_user_id, status: 'completed' }).eq('id', m.id)
      results.resolved++; continue
    }
    if (!m.home_user_id || !m.away_user_id) continue

    // Which gameweeks decide this match? A REPLAY must have its own
    // admin-assigned gameweek. It deliberately does NOT fall back to the
    // round's shared gameweeks: replaying the same gameweek recomputes the
    // exact totals that caused the draw, draws again, and schedules yet
    // another replay — forever. An unassigned replay is simply not ready.
    const gwIds = m.gameweek_id ? [m.gameweek_id] : (m.is_replay ? [] : roundGwIds)
    if (!gwIds.length) { results.notReady++; continue }

    // Nothing is decided until every gameweek feeding this match is marked
    // completed. Resolving early gives both participants 0, which looks like
    // a draw and schedules a replay for a match nobody has played yet.
    const { data: gws } = await supabase.from('gameweeks').select('id, status').in('id', gwIds)
    const allComplete = (gws || []).length === gwIds.length && (gws || []).every(g => g.status === 'completed')
    if (!allComplete) { results.notReady++; continue }

    const { data: scores } = await supabase.from('gameweek_scores').select('user_id, gameweek_id, points')
      .in('gameweek_id', gwIds).in('user_id', [m.home_user_id, m.away_user_id])

    const totals = { [m.home_user_id]: 0, [m.away_user_id]: 0 }
    // Keep max points per user+gameweek (same score may exist under
    // multiple competition_ids), then sum across gameweeks.
    const bestPerGw = {}
    for (const s of (scores || [])) {
      const key = `${s.user_id}:${s.gameweek_id}`
      bestPerGw[key] = Math.max(bestPerGw[key] ?? -Infinity, s.points || 0)
    }
    for (const [key, p] of Object.entries(bestPerGw)) {
      const uid = key.split(':')[0]
      if (totals[uid] !== undefined) totals[uid] += p
    }
    const h = totals[m.home_user_id], a = totals[m.away_user_id]

    if (h !== a) {
      const winner = h > a ? m.home_user_id : m.away_user_id
      await supabase.from('bracket_matches').update({
        winner_user_id: winner, home_points: h, away_points: a, status: 'completed',
      }).eq('id', m.id)
      results.resolved++
    } else if (hasLaterLeg(m)) {
      // Genuinely drawn, and the chain already continues past this leg.
      // Record the scoreline and leave the replay that follows it alone.
      await supabase.from('bracket_matches').update({
        home_points: h, away_points: a, status: 'replay_scheduled',
      }).eq('id', m.id)
      results.notReady++
    } else {
      // A genuine draw with no replay pending — schedule one. The replay copies
      // this match's forward link, and the original KEEPS its own copy. Clearing
      // the original used to destroy the link outright: a second replay created
      // on a later run inherited the already-nulled value, so its winner had
      // nowhere to advance to. The original stays 'replay_scheduled', so the
      // advance pass below never promotes it — only the replay that settles it.
      // The replay starts with no gameweek_id: an admin must assign the
      // gameweek it will be decided on.
      await supabase.from('bracket_matches').update({
        home_points: h, away_points: a, status: 'replay_scheduled',
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

  // ---- Advance pass -------------------------------------------------------
  // Promotion runs as a separate sweep over EVERY completed match in the round
  // rather than only the ones settled on this run. A winner decided on an
  // earlier run whose forward link was missing at that moment is picked up here
  // as soon as the link is available again, instead of being stranded forever.
  // Writing the same winner into the same slot twice is a no-op, so this is
  // safe to run repeatedly.
  const { data: settled } = await supabase.from('bracket_matches').select('*').eq('competition_id', competitionId).eq('round', round)
  for (const m of (settled || [])) {
    if (m.status !== 'completed' || !m.winner_user_id) continue

    // The whole matchup — the original plus every replay of it. They all feed
    // the same slot, so any one of them that still carries the link can supply
    // it for the rest.
    const group = (settled || []).filter(x => x.id === m.id || samePair(x, m))
    const linked = group.find(x => x.feeds_into_match_id && x.feeds_into_side)
    if (!linked) continue

    await supabase.from('bracket_matches')
      .update({ [linked.feeds_into_side + '_user_id']: m.winner_user_id })
      .eq('id', linked.feeds_into_match_id)
  }

  return results
}
