import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useLeaderboard(competitionId) {
  const [overall, setOverall] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (competitionId) load(competitionId)
    else { setOverall([]); setLoading(false) }
  }, [competitionId])

  async function load(id) {
    setLoading(true)
    try {
      const { data } = await supabase.from('leaderboard_overall').select('*').eq('competition_id', id).order('total_points', { ascending: false })

      // Season prediction points — the final table and individual picks. They
      // aren't gameweek points, so they aren't in the view; they're merged here
      // and added to the total, with the season figure kept separately so the
      // table can show its own column.
      const { data: season } = await supabase.from('season_scores')
        .select('user_id, table_points, picks_points').eq('competition_id', id)

      const seasonByUser = {}
      ;(season || []).forEach(r => { seasonByUser[r.user_id] = (r.table_points || 0) + (r.picks_points || 0) })

      const merged = (data || []).map(row => {
        const seasonPoints = seasonByUser[row.user_id] || 0
        return {
          ...row,
          season_points: seasonPoints,
          gameweek_points: row.total_points || 0,   // before season points, for reference
          total_points: (row.total_points || 0) + seasonPoints,
        }
      })

      // Someone whose only points are season points has no row in the view at
      // all — leaderboard_overall is built from gameweek_scores, so a
      // participant who hasn't been scored on a gameweek yet simply isn't in
      // it. Without this they'd be missing from the table entirely despite
      // having points, which reads as the table being broken.
      const inView = new Set((data || []).map(r => r.user_id))
      const missing = Object.keys(seasonByUser).filter(uid => !inView.has(uid) && seasonByUser[uid] > 0)

      if (missing.length) {
        const { data: profs } = await supabase.from('profiles')
          .select('id, display_name, avatar_initials').in('id', missing)

        ;(profs || []).forEach(pr => {
          merged.push({
            competition_id: id,
            user_id: pr.id,
            display_name: pr.display_name,
            avatar_initials: pr.avatar_initials,
            total_points: seasonByUser[pr.id],
            gameweek_points: 0,
            season_points: seasonByUser[pr.id],
            exact_scores: 0,
            correct_results: 0,
            full_house_results_count: 0,
            full_house_scores_count: 0,
          })
        })
      }

      // Re-sorted, because adding season points can change the order.
      merged.sort((a, b) => b.total_points - a.total_points || (b.exact_scores || 0) - (a.exact_scores || 0))
      setOverall(merged)
    } finally { setLoading(false) }
  }

  return { overall, loading, refetch: () => load(competitionId) }
}

export function useWeeklyLeaderboard(competitionId, gameweekId) {
  const [weekly,  setWeekly]  = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (competitionId && gameweekId) load(competitionId, gameweekId)
    else { setWeekly([]); setLoading(false) }
  }, [competitionId, gameweekId])

  async function load(compId, gwId) {
    setLoading(true)
    try {
      const { data } = await supabase.from('gameweek_scores').select('*, profiles(display_name, avatar_initials)').eq('competition_id', compId).eq('gameweek_id', gwId).order('points', { ascending: false })
      setWeekly(data || [])
    } finally { setLoading(false) }
  }

  return { weekly, loading, refetch: () => load(competitionId, gameweekId) }
}

export function useMonthlyLeaderboard(competitionId, monthKey) {
  const [monthly,          setMonthly]          = useState([])
  const [gameweeksInMonth, setGameweeksInMonth] = useState([])
  const [loading,          setLoading]          = useState(false)

  useEffect(() => {
    if (competitionId && monthKey) load(competitionId, monthKey)
    else { setMonthly([]); setGameweeksInMonth([]); setLoading(false) }
  }, [competitionId, monthKey])

  async function load(compId, mKey) {
    setLoading(true)
    try {
      // Gameweeks linked to this competition (whether created here or
      // linked in from another competition) via the join table — not just
      // ones originally created under this competition_id.
      const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', compId)
      const gwIds = (links || []).map(l => l.gameweek_id)
      if (!gwIds.length) { setGameweeksInMonth([]); setMonthly([]); return }

      const { data: gws } = await supabase.from('gameweeks').select('*').in('id', gwIds).eq('month_key', mKey).order('number')
      setGameweeksInMonth(gws || [])
      if (!gws?.length) { setMonthly([]); return }

      const { data: scores } = await supabase.from('gameweek_scores').select('*, profiles(display_name, avatar_initials)')
        .eq('competition_id', compId).in('gameweek_id', gws.map(g => g.id))

      const map = {}
      ;(scores||[]).forEach(s => {
        const k = s.user_id
        if (!map[k]) map[k] = {
          user_id: k,
          display_name: s.profiles?.display_name || 'Unknown',
          avatar_initials: s.profiles?.avatar_initials || '?',
          total_points: 0, exact_scores: 0, correct_results: 0,
          // Counted so the monthly table can show the same bonus columns as the
          // overall one — the underlying booleans were being thrown away here.
          full_house_results_count: 0, full_house_scores_count: 0,
          gw_breakdown: {},
        }
        map[k].total_points   += s.points || 0
        map[k].exact_scores   += s.exact_scores || 0
        map[k].correct_results += s.correct_results || 0
        if (s.full_house_results) map[k].full_house_results_count++
        if (s.full_house_scores)  map[k].full_house_scores_count++
        map[k].gw_breakdown[s.gameweek_id] = s.points || 0
      })
      setMonthly(Object.values(map).sort((a,b) => b.total_points - a.total_points))
    } finally { setLoading(false) }
  }

  return { monthly, gameweeksInMonth, loading, refetch: () => load(competitionId, monthKey) }
}

/**
 * Provisional standings for a gameweek while its matches are being played.
 *
 * Computed in the browser from live scores rather than read from
 * gameweek_scores, and never written back. A goal changes the table instantly;
 * a disallowed goal changes it back just as instantly; and nobody's actual
 * points move until an admin confirms the results. The live table can therefore
 * be wrong for ten seconds with no lasting consequence — whereas if live data
 * wrote to scores, a bad feed would corrupt the standings for good.
 *
 * Polls while anything is in play, and stops when nothing is. There is no point
 * re-querying every fifteen seconds on a Tuesday.
 */
export function useLiveGameweek(competitionId, gameweekId, rules) {
  const [rows, setRows] = useState([])
  const [inPlay, setInPlay] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!competitionId || !gameweekId) { setRows([]); setInPlay(false); return }

    let cancelled = false
    let timer

    async function load() {
      const { liveStandings, anyInPlay } = await import('../lib/livePoints')

      const [{ data: fixtures }, { data: preds }, { data: parts }] = await Promise.all([
        supabase.from('fixtures')
          .select('id, is_void, home_score, away_score, live_home_score, live_away_score, live_status, live_minute')
          .eq('gameweek_id', gameweekId),
        supabase.from('predictions')
          .select('user_id, fixture_id, predicted_home, predicted_away')
          .eq('gameweek_id', gameweekId),
        supabase.from('participants')
          .select('user_id, profiles(display_name)')
          .eq('competition_id', competitionId),
      ])

      if (cancelled) return

      const live = anyInPlay(fixtures || [])
      setInPlay(live)
      setRows(liveStandings(parts || [], fixtures || [], preds || [], rules))

      // 45 seconds while matches are on. Frequent enough that a goal shows up
      // before anyone refreshes by hand, infrequent enough not to hammer the
      // database for the whole of a Saturday afternoon.
      if (live && !cancelled) timer = setTimeout(load, 45000)
    }

    setLoading(true)
    load().finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true; clearTimeout(timer) }
  }, [competitionId, gameweekId, rules])

  return { rows, inPlay, loading }
}
