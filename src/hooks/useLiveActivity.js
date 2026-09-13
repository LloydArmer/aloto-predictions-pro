import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  isNative, liveActivityStatus, startGameweekActivity,
  endGameweekActivity, activeActivities,
} from '../lib/liveActivity'
import { effectiveScore, isInPlay } from '../lib/livePoints'
import { resolvePointRules, defaultRules, scoreOnePrediction } from '../lib/scoring'

/**
 * Starts a Live Activity when a gameweek goes live, and ends it at full time.
 *
 * Deliberately automatic rather than a button. Someone watching football does
 * not open the app to ask for a lock screen widget — the value is in it being
 * there already when they put their phone down.
 *
 * Does nothing at all on the web, so it can be mounted unconditionally.
 */
export function useLiveActivity(competitionId, userId) {
  // Which activity this session started, so it can be ended without touching
  // one belonging to another competition.
  const startedRef = useRef(null)

  useEffect(() => {
    if (!isNative() || !competitionId || !userId) return

    let cancelled = false
    let timer

    async function check() {
      try {
        const status = await liveActivityStatus()
        if (!status.supported || !status.enabled) return

        // The active gameweek, via the join table — a cup runs on another
        // competition's gameweeks.
        const { data: links } = await supabase.from('competition_gameweeks')
          .select('gameweek_id').eq('competition_id', competitionId)

        const gwIds = (links || []).map(l => l.gameweek_id)
        if (!gwIds.length) return

        const { data: gws } = await supabase.from('gameweeks')
          .select('id, number').in('id', gwIds).eq('status', 'active').limit(1)

        const gw = gws?.[0]
        if (!gw) return

        const { data: fixtures } = await supabase.from('fixtures')
          .select('id, status, home_score, away_score, live_home_score, live_away_score, live_status')
          .eq('gameweek_id', gw.id)

        const anyLive = (fixtures || []).some(isInPlay)
        const running = await activeActivities()
        const already = running.find(a => a.gameweekLabel === gw.number)

        // ---- Nothing in play: end anything running ----
        if (!anyLive) {
          if (already) {
            await endGameweekActivity(already.activityId)
            startedRef.current = null
          }
          return
        }

        // ---- In play, and one already running: leave it alone ----
        // The server keeps it updated by push; starting a second would put two
        // cards on the lock screen showing the same thing.
        if (already) { startedRef.current = already.activityId; return }

        // ---- In play, nothing running: start one ----
        const [{ data: profile }, rules] = await Promise.all([
          supabase.from('profiles').select('display_name, badge_kit').eq('id', userId).single(),
          resolvePointRules(supabase, competitionId),
        ])

        const activeRules = rules || defaultRules()

        const { data: comp } = await supabase.from('competitions')
          .select('name').eq('id', competitionId).single()

        const { data: preds } = await supabase.from('predictions')
          .select('fixture_id, predicted_home, predicted_away')
          .eq('gameweek_id', gw.id).eq('user_id', userId)

        // Opponent, if there's a cup tie or group fixture this gameweek.
        const { data: oppRows } = await supabase.rpc('my_gameweek_opponent', {
          p_gameweek_id: gw.id,
        })
        const opponent = Array.isArray(oppRows) ? oppRows[0] : oppRows

        const myPoints = totalFor(fixtures, preds || [], activeRules)

        let opponentPoints = null
        if (opponent?.opponent_id) {
          const { data: oppPreds } = await supabase.from('predictions')
            .select('fixture_id, predicted_home, predicted_away')
            .eq('gameweek_id', gw.id).eq('user_id', opponent.opponent_id)
          opponentPoints = totalFor(fixtures, oppPreds || [], activeRules)
        }

        const inPlayCount = (fixtures || []).filter(isInPlay).length

        if (cancelled) return

        const id = await startGameweekActivity(userId, {
          gameweekId: gw.id,
          competitionName: comp?.name ?? '',
          gameweekLabel: gw.number,
          myName: profile?.display_name ?? '',
          myKit: profile?.badge_kit ?? null,
          opponentName: opponent?.opponent_name ?? null,
          opponentKit: opponent?.opponent_kit ?? null,
          roundLabel: opponent?.round_label ?? null,
          myPoints,
          opponentPoints,
          matchesInPlay: inPlayCount,
          statusLine: inPlayCount === 1 ? '1 match in play' : `${inPlayCount} matches in play`,
        })

        startedRef.current = id
      } catch (err) {
        // Never thrown upwards — a lock screen extra failing must not break the
        // screen that mounted it.
        console.warn('Live Activity check failed:', err?.message || err)
      }
    }

    check()

    // Every five minutes. The server pushes the score updates; this only
    // notices a gameweek starting or finishing, which does not need checking
    // more often than that.
    timer = setInterval(check, 5 * 60 * 1000)

    return () => { cancelled = true; clearInterval(timer) }
  }, [competitionId, userId])
}

/** A participant's provisional total. */
function totalFor(fixtures, predictions, rules) {
  let total = 0
  for (const fx of (fixtures || [])) {
    if (fx.status === 'void') continue
    const score = effectiveScore(fx)
    if (!score) continue

    const p = predictions.find(x => x.fixture_id === fx.id)
    if (!p) continue

    total += scoreOnePrediction(
      { predicted_home: p.predicted_home, predicted_away: p.predicted_away },
      { home_score: score.home, away_score: score.away },
      rules,
    ).points
  }
  return total
}
