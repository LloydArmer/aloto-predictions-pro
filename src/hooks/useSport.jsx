import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Which sport the app is showing: Football, NFL, and whatever is added later.
 *
 * Every sport is separate. A competition belongs to exactly one
 * (competitions.sport), and the whole app — dashboard, predict, standings,
 * chat, admin — only ever shows the competitions of the sport chosen here.
 * The filtering itself happens in useCompetitions(), which every page already
 * goes through, so no page has to know sports exist.
 *
 * `chosen` is null until the person picks one. While it is null the sport is
 * worked out from what they are in (see useCompetitions), so a football player
 * who never touches the chooser sees exactly the app they always have, and an
 * NFL-only player lands on NFL without being asked.
 *
 * Stored per user, for the same reason as the selected competition: a second
 * account on the device must not inherit the first one's choice.
 */
const STORAGE_PREFIX = 'aloto_selected_sport'
const keyFor = userId => (userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX)

// What the app falls back to if the sports table can't be read — before
// migration 111 has run, for instance. One sport means no chooser.
const FALLBACK_SPORTS = [{ id: 'football', name: 'Football', emoji: '⚽', sort_order: 1, enabled: true }]

export const sportOf = c => c?.sport || 'football'

const SportContext = createContext(null)

export function SportProvider({ children }) {
  const [chosen, setChosen] = useState(() => readStoredSport())
  const [sports, setSports] = useState(FALLBACK_SPORTS)
  const userId = useRef(null)

  useEffect(() => {
    let cancelled = false

    supabase.from('sports').select('*').eq('enabled', true).order('sort_order')
      .then(({ data, error }) => {
        if (!cancelled && !error && data?.length) setSports(data)
      })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) userId.current = session?.user?.id ?? null
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      const next = session?.user?.id ?? null
      if (userId.current && next && next !== userId.current) setChosen(null)
      if (!next) setChosen(null)
      userId.current = next
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  function choose(sportId) {
    setChosen(sportId)
    try {
      const k = keyFor(userId.current)
      if (sportId) localStorage.setItem(k, sportId)
      else localStorage.removeItem(k)
    } catch { /* storage blocked — the choice still works for this session */ }
  }

  return (
    <SportContext.Provider value={{ chosen, choose, sports }}>
      {children}
    </SportContext.Provider>
  )
}

function readStoredSport() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(STORAGE_PREFIX + ':')) return localStorage.getItem(k)
    }
    return null
  } catch { return null }
}

export function useSport() {
  const ctx = useContext(SportContext)
  if (!ctx) throw new Error('useSport must be used within a SportProvider')
  return ctx
}
