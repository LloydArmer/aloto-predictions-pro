import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useCompetitions() {
  const [competitions, setCompetitions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetch() }, [])

  async function fetch() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setCompetitions([]); return }

      // Only competitions this person is a participant in.
      //
      // This used to select every competition in the database with no filter,
      // so a brand new account saw — and could use — every league anyone had
      // ever created. That made the join code decorative: there was nothing to
      // join, because you were already looking at everything.
      const { data: mine } = await supabase
        .from('participants').select('competition_id').eq('user_id', user.id)

      const ids = (mine || []).map(p => p.competition_id)
      if (!ids.length) { setCompetitions([]); return }

      const { data } = await supabase
        .from('competitions').select('*').in('id', ids)
        .order('created_at', { ascending: false })
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
