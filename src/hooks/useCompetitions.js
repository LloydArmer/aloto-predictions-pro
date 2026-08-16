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
    // Register creator as admin — upsert handles the case where the
    // database trigger (029) already created this row, avoiding the
    // duplicate-key / RLS conflict that a plain insert would cause.
    await supabase.from('participants').upsert({ competition_id: data.id, user_id: user.id, role: 'admin' }, { onConflict: 'competition_id,user_id' })
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
