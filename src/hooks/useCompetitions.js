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
    const { data, error } = await supabase.from('competitions').insert(comp).select().single()
    if (error) throw error
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
