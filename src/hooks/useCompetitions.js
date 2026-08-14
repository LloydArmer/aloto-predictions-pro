import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useCompetitions() {
  const [competitions, setCompetitions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetch() }, [])

  async function fetch() {
    try {
      const { data } = await supabase.from('competitions').select('*').order('created_at', { ascending: false })
      setCompetitions(data || [])
    } finally { setLoading(false) }
  }

  async function createCompetition(comp) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('competitions').insert({ ...comp, created_by: user.id }).select().single()
    if (error) throw error
    // Immediately register the creator as admin of this competition —
    // every subsequent admin operation (inserting bracket matches, updating
    // rules, etc.) checks for a participants row with role='admin', so
    // without this the creator silently fails every permission check.
    await supabase.from('participants').insert({ competition_id: data.id, user_id: user.id, role: 'admin' })
    setCompetitions(prev => [data, ...prev])
    return data
  }

  async function updateCompetition(id, updates) {
    const { data, error } = await supabase.from('competitions').update(updates).eq('id', id).select().single()
    if (error) throw error
    setCompetitions(prev => prev.map(c => c.id === id ? data : c))
    return data
  }

  return { competitions, loading, refetch: fetch, createCompetition, updateCompetition }
}
