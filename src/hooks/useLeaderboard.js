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
      setOverall(data || [])
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
        if (!map[k]) map[k] = { user_id: k, display_name: s.profiles?.display_name || 'Unknown', avatar_initials: s.profiles?.avatar_initials || '?', total_points: 0, exact_scores: 0, correct_results: 0, gw_breakdown: {} }
        map[k].total_points   += s.points || 0
        map[k].exact_scores   += s.exact_scores || 0
        map[k].correct_results += s.correct_results || 0
        map[k].gw_breakdown[s.gameweek_id] = s.points || 0
      })
      setMonthly(Object.values(map).sort((a,b) => b.total_points - a.total_points))
    } finally { setLoading(false) }
  }

  return { monthly, gameweeksInMonth, loading, refetch: () => load(competitionId, monthKey) }
}
