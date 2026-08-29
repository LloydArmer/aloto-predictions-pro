// Standard "circle method" round-robin scheduler — produces N-1 rounds (or
// N rounds with one bye each, if the participant count is odd) where every
// pair meets exactly once per pass. Repeating the whole schedule for
// `timesEachPairPlays` passes, with home/away flipped on alternate passes,
// gives a fair, evenly-alternating multi-leg schedule.
function circleMethodRounds(participantUserIds) {
  let players = [...participantUserIds]
  if (players.length % 2 !== 0) players.push(null) // bye placeholder
  const n = players.length
  const fixed = players[0]
  let rotating = players.slice(1)
  const rounds = []
  for (let r = 0; r < n - 1; r++) {
    const roundPlayers = [fixed, ...rotating]
    const pairs = []
    for (let i = 0; i < n / 2; i++) {
      const a = roundPlayers[i], b = roundPlayers[n - 1 - i]
      if (a !== null && b !== null) pairs.push([a, b])
    }
    rounds.push(pairs)
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)]
  }
  return rounds
}

// Returns a flat list of { round_number, home_user_id, away_user_id }
// ready to insert into group_fixtures. Fixtures within the same
// round_number can share one assigned gameweek, since no participant
// appears twice in the same round.
export function generateRoundRobinFixtures(participantUserIds, timesEachPairPlays) {
  const baseRounds = circleMethodRounds(participantUserIds)
  const fixtures = []
  let roundCounter = 0
  for (let rep = 0; rep < timesEachPairPlays; rep++) {
    const flip = rep % 2 === 1
    for (const pairs of baseRounds) {
      roundCounter++
      for (const [a, b] of pairs) {
        fixtures.push({ round_number: roundCounter, home_user_id: flip ? b : a, away_user_id: flip ? a : b })
      }
    }
  }
  return fixtures
}

// Resolves every upcoming fixture in a round whose assigned gameweek has
// been fully played (gameweek marked completed) — compares each pair's
// prediction points for that gameweek (scoped to this competition, so
// Triple Points from a League competition never leaks in): higher wins
// 3 league points, 0 for the loser, 1 each if level.
// Resolving a round always recomputes fresh from current gameweek_scores,
// even for fixtures already marked completed — otherwise a fixture's
// result would freeze permanently the first time it's resolved, and
// never reflect a later change (e.g. switching which League's rules
// this competition uses, or a late correction to a real result).
export async function resolveGroupRound(supabase, competitionId, roundNumber) {
  const { data: fixtures } = await supabase.from('group_fixtures').select('*')
    .eq('competition_id', competitionId).eq('round_number', roundNumber)

  // notScored is tracked separately so the admin can be told to run Recalculate
  // rather than just "not ready", which leaves them guessing.
  let resolved = 0, notReady = 0, notScored = 0
  for (const fx of (fixtures || [])) {
    if (!fx.gameweek_id) { notReady++; continue }
    const { data: gw } = await supabase.from('gameweeks').select('status').eq('id', fx.gameweek_id).single()
    if (gw?.status !== 'completed') { notReady++; continue }

    const { data: scores } = await supabase.from('gameweek_scores').select('user_id, points')
      .eq('competition_id', competitionId).eq('gameweek_id', fx.gameweek_id).in('user_id', [fx.home_user_id, fx.away_user_id])
    // A gameweek marked 'completed' has NOT necessarily been scored. The status
    // is set by the admin; the scores come from Recalculate, and nothing forces
    // the second to follow the first.
    //
    // `?? 0` quietly turned "no score row" into a legitimate zero, so an
    // unscored gameweek resolved every fixture as a 0-0 draw. Absence of a row
    // means not yet scored — which is "not ready", not "drew nil-nil".
    const homeRow = scores?.find(s => s.user_id === fx.home_user_id)
    const awayRow = scores?.find(s => s.user_id === fx.away_user_id)
    if (!homeRow || !awayRow) { notReady++; notScored++; continue }

    const homePoints = homeRow.points || 0
    const awayPoints = awayRow.points || 0
    const result = homePoints > awayPoints ? 'home' : awayPoints > homePoints ? 'away' : 'draw'

    await supabase.from('group_fixtures').update({ home_points: homePoints, away_points: awayPoints, result, status: 'completed' }).eq('id', fx.id)
    resolved++
  }
  return { resolved, notReady, notScored }
}
