import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useSport, sportOf } from './useSport'
import { useSelectedCompetitionId } from './useSelectedCompetition'

/**
 * The order every competition dropdown shows — and therefore which one the
 * app opens on, because the picker defaults to the first.
 *
 * Leagues first, then cups, each oldest first. The main league is almost
 * always the first thing somebody sets up, so it lands at the top where it
 * belongs. The list used to come back newest-first, which meant creating a
 * cup in November silently made that cup the default view of the whole app.
 */
export function orderForDisplay(list) {
  const rank = c => (c.format === 'league' ? 0 : 1)
  return [...(list || [])].sort((a, b) =>
    rank(a) !== rank(b)
      ? rank(a) - rank(b)
      : new Date(a.created_at) - new Date(b.created_at))
}

export function useCompetitions() {
  // Every competition this person is in, across all sports.
  const [allCompetitions, setCompetitions] = useState([])
  const [loading, setLoading] = useState(true)

  // Sports are separate: the app only ever shows ONE sport's competitions, and
  // this is where that happens, so every page is filtered without knowing it.
  //
  // The sport is the one chosen in the top bar; if nothing has been chosen, the
  // sport of the competition already selected; failing that, of the first in
  // display order. A football player who never touches the chooser therefore
  // sees exactly what they always have, and an NFL-only player opens on NFL.
  const { chosen } = useSport()
  const [selectedId] = useSelectedCompetitionId()
  const activeSport = chosen
    || sportOf(allCompetitions.find(c => c.id === selectedId) || allCompetitions[0])

  // Memoised: pages pass this list to effects, and a fresh array on every
  // render would re-run them on every render.
  const competitions = useMemo(
    () => allCompetitions.filter(c => sportOf(c) === activeSport),
    [allCompetitions, activeSport])

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
      //
      // The same query also brings back this person's ROLE in each one, which
      // is attached to the competition as my_role ('admin' or 'player'). That is
      // what decides whether someone can run a competition — per competition,
      // not one global flag. It rides on a query that was already being made, so
      // nothing new runs in the auth flow and nothing new can hang.
      const { data: mine } = await supabase
        .from('participants').select('competition_id, role').eq('user_id', user.id)

      const roleById = {}
      ;(mine || []).forEach(p => { roleById[p.competition_id] = p.role })
      const ids = Object.keys(roleById)
      if (!ids.length) { setCompetitions([]); return }

      const { data } = await supabase
        .from('competitions').select('*').in('id', ids)
      setCompetitions(orderForDisplay(
        (data || []).map(c => ({ ...c, my_role: roleById[c.id] || 'player' }))))
    } finally { setLoading(false) }
  }

  async function createCompetition(comp) {
    const { data: { user } } = await supabase.auth.getUser()
    // A competition is created in the sport currently on screen. Football sends
    // exactly what it always did — the column's default is 'football' — so
    // creating a football competition is unchanged.
    const sportField = activeSport !== 'football' ? { sport: activeSport } : {}
    const { data, error } = await supabase.from('competitions').insert({ ...comp, ...sportField, created_by: user.id }).select().single()
    if (error) throw error
    // Register creator as admin — upsert handles the case where the
    // database trigger (029) already created this row, avoiding the
    // duplicate-key / RLS conflict that a plain insert would cause.
    await supabase.from('participants').upsert({ competition_id: data.id, user_id: user.id, role: 'admin' }, { onConflict: 'competition_id,user_id' })
    // Sorted in rather than pushed to the front: a cup created today must
    // not displace the main league as what the app opens on.
    setCompetitions(prev => orderForDisplay([...prev, { ...data, my_role: 'admin' }]))
    return data
  }

  async function updateCompetition(id, updates) {
    const { data, error } = await supabase.from('competitions').update(updates).eq('id', id).select().single()
    if (error) throw error
    // Keep my_role: it isn't a column, so the updated row doesn't carry it.
    setCompetitions(prev => prev.map(c => c.id === id ? { ...data, my_role: c.my_role } : c))
    return data
  }

  return { competitions, allCompetitions, activeSport, loading, refetch: fetch, createCompetition, updateCompetition }
}
