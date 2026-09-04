import { scoreOnePrediction } from './scoring'

/**
 * Provisional points from live scores.
 *
 * Deliberately computed in the browser and never written to gameweek_scores.
 * That separation is the whole point:
 *
 *   - a goal in the 89th minute changes the provisional table instantly
 *   - a disallowed goal, a delayed feed or an abandoned match changes it back
 *     just as instantly
 *   - nobody's ACTUAL points move until an admin confirms the result
 *
 * So the live table can be wrong for ten seconds with no lasting consequence.
 * If live data wrote to scores instead, a bad feed would corrupt the standings
 * and someone would have to unpick it by hand.
 */

/** Has this fixture got a usable live or confirmed score? */
export function hasScore(fixture) {
  const confirmed = fixture.home_score != null && fixture.away_score != null
  const live = fixture.live_home_score != null && fixture.live_away_score != null
  return confirmed || live
}

/**
 * The score to use, and where it came from.
 *
 * A confirmed result always wins over live data. Once an admin has entered
 * 2-1, a feed still reporting 2-0 must not override it — the admin was
 * watching, and the feed may be behind or simply wrong.
 */
export function effectiveScore(fixture) {
  if (fixture.home_score != null && fixture.away_score != null) {
    return { home: fixture.home_score, away: fixture.away_score, source: 'confirmed' }
  }
  if (fixture.live_home_score != null && fixture.live_away_score != null) {
    return { home: fixture.live_home_score, away: fixture.live_away_score, source: 'live' }
  }
  return null
}

/** Is this fixture being played right now? */
export function isInPlay(fixture) {
  // API-Football's own short codes. 'HT' is half time — still in play, just
  // paused, and treating it as finished would freeze the table for 15 minutes.
  return ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(fixture.live_status)
}

/** Has it finished, according to the feed rather than the admin? */
export function isFinished(fixture) {
  return ['FT', 'AET', 'PEN'].includes(fixture.live_status)
}

/**
 * A short label for the fixture's state — "67'", "HT", "FT", or null when it
 * hasn't kicked off.
 */
export function liveLabel(fixture) {
  if (!fixture.live_status) return null
  switch (fixture.live_status) {
    case 'HT':   return 'HT'
    case 'FT':   return 'FT'
    case 'AET':  return 'AET'
    case 'PEN':  return 'PENS'
    case 'PST':  return 'POSTPONED'
    case 'CANC': return 'CANCELLED'
    case 'SUSP': return 'SUSPENDED'
    case 'ABD':  return 'ABANDONED'
    case 'NS':   return null
    default:     return fixture.live_minute ? `${fixture.live_minute}'` : 'LIVE'
  }
}

/**
 * Provisional points for one participant across a gameweek.
 *
 * Returns the running total plus how much of it is provisional, so the UI can
 * say "14 pts, 6 of them still in play" rather than presenting a number that
 * might drop.
 */
export function livePointsFor(fixtures, predictionsByFixture, rules) {
  let total = 0
  let provisional = 0
  let settled = 0
  let inPlayCount = 0
  let correctResults = 0
  let exactScores = 0

  for (const fx of fixtures) {
    // A voided fixture scores nothing for anyone, live or otherwise.
    if (fx.is_void) continue

    const score = effectiveScore(fx)
    if (!score) continue

    const pred = predictionsByFixture[fx.id]
    if (!pred) continue

    const result = scoreOnePrediction(
      { predicted_home: pred.predicted_home, predicted_away: pred.predicted_away },
      { home_score: score.home, away_score: score.away },
      rules,
    )

    total += result.points
    if (result.isExact) exactScores++
    else if (result.isCorrectResult) correctResults++

    if (score.source === 'live' && !isFinished(fx)) {
      provisional += result.points
      inPlayCount++
    } else {
      settled += result.points
    }
  }

  return { total, provisional, settled, inPlayCount, correctResults, exactScores }
}

/**
 * Provisional standings for a whole gameweek.
 *
 * Full house bonuses are deliberately NOT applied. They need every fixture
 * completed, and awarding one from live data would show a player 45 points up
 * on a bonus a single late goal could remove. Bonuses appear when the admin
 * confirms the results — which is also when they become real.
 */
export function liveStandings(participants, fixtures, predictions, rules) {
  const byUser = {}
  for (const p of predictions) {
    if (!byUser[p.user_id]) byUser[p.user_id] = {}
    byUser[p.user_id][p.fixture_id] = p
  }

  const rows = participants.map(p => ({
    user_id: p.user_id,
    display_name: p.display_name ?? p.profiles?.display_name,
    ...livePointsFor(fixtures, byUser[p.user_id] ?? {}, rules),
  }))

  // Sorted by total, then by exact scores — the same tiebreak the settled
  // table uses, so the live order doesn't reshuffle when results are confirmed.
  rows.sort((a, b) => b.total - a.total || b.exactScores - a.exactScores)
  return rows
}

/** Are any of this gameweek's fixtures in play right now? */
export function anyInPlay(fixtures) {
  return fixtures.some(fx => isInPlay(fx))
}
