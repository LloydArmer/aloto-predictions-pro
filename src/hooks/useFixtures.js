import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useFixtures(gameweekId) {
  const [fixtures, setFixtures] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => { if (gameweekId) load(gameweekId) }, [gameweekId])

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
  const [loading,     setLoading]     = useState(true)

  useEffect(() => { if (gameweekId && userId) load(gameweekId, userId) }, [gameweekId, userId])

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
    }
    setPredictions(prev => ({ ...prev, [fixtureId]: result }))
    return result
  }

  return { predictions, loading, savePrediction }
}
