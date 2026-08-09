import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useFixtures(gameweekId) {
  const [fixtures, setFixtures] = useState([])
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    if (gameweekId) load(gameweekId)
    else { setFixtures([]); setLoading(false) }
  }, [gameweekId])

  async function load(gwId) {
    setLoading(true)
    try {
      const { data } = await supabase.from('fixtures').select('*').eq('gameweek_id', gwId).order('kickoff_time')
      setFixtures(data || [])
    } finally { setLoading(false) }
  }

  async function updateResult(id, h, a) {
    const { data, error } = await supabase.from('fixtures').update({ home_score: h, away_score: a, status: 'completed' }).eq('id', id).select().single()
    if (error) throw error
    setFixtures(prev => prev.map(f => f.id === id ? data : f))
    return data
  }

  return { fixtures, loading, refetch: () => load(gameweekId), updateResult }
}

export function usePredictions(gameweekId, userId) {
  const [predictions, setPredictions] = useState({})
  const [loading,     setLoading]     = useState(false)

  useEffect(() => {
    if (gameweekId && userId) load(gameweekId, userId)
    else { setPredictions({}); setLoading(false) }
  }, [gameweekId, userId])

  async function load(gwId, uid) {
    setLoading(true)
    try {
      const { data } = await supabase.from('predictions').select('*').eq('gameweek_id', gwId).eq('user_id', uid)
      const map = {}; (data||[]).forEach(p => { map[p.fixture_id] = p })
      setPredictions(map)
    } finally { setLoading(false) }
  }

  async function savePrediction(fixtureId, home, away, gwId, uid) {
    const existing = predictions[fixtureId]
    let result
    if (existing) {
      const { data, error } = await supabase.from('predictions').update({ predicted_home: home, predicted_away: away }).eq('id', existing.id).select().single()
      if (error) throw error; result = data
    } else {
      const { data, error } = await supabase.from('predictions').insert({ fixture_id: fixtureId, gameweek_id: gwId, user_id: uid, predicted_home: home, predicted_away: away }).select().single()
      if (error) throw error; result = data
      // First-ever prediction from this user in this competition — make sure
      // they actually show up in the admin's Participants list. Predicting
      // was never gated on being a participant, so without this a player
      // could sign up and predict without ever appearing there.
      const { data: gw } = await supabase.from('gameweeks').select('competition_id').eq('id', gwId).single()
      if (gw) {
        // Ignore the error here on purpose — a duplicate just means they're
        // already a participant (the normal case after their first ever
        // prediction), which isn't a real problem.
        await supabase.from('participants').insert({ competition_id: gw.competition_id, user_id: uid, role: 'player' })
      }
    }
    setPredictions(prev => ({ ...prev, [fixtureId]: result }))
    return result
  }

  return { predictions, loading, savePrediction }
}
