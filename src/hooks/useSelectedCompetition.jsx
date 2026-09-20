import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/* The stored choice is keyed BY USER.
 *
 * It used to be one global key. Sign in as somebody else and the app opened on
 * the previous account's competition — a brand new user with none of their own
 * kept the old id and loaded another league's fixtures with it.
 *
 * A per-user key fixes that on its own: a different account reads a different
 * key and finds nothing, which is the right answer for someone who has not
 * chosen yet. */
const STORAGE_PREFIX = 'aloto_selected_competition'
const keyFor = userId => (userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX)

const SelectedCompetitionContext = createContext(null)

// One shared "which competition am I looking at" choice, used by every page
// (Dashboard, Predict, Table, Bracket, Admin) AND the nav bar. This lives in a
// single React Context, not independent per-component state — each page
// previously had its own copy that only read localStorage once on mount, so
// switching competitions on one page never notified the nav bar (which stays
// mounted across navigation) or any other already-open page.
export function SelectedCompetitionProvider({ children }) {
  // Read from storage during the first render rather than in an effect, so
  // there is never a frame where the selection is null before it is restored.
  const [selected, setSelected] = useState(() => readStoredSelection())

  // The signed-in user, tracked through Supabase DIRECTLY rather than through
  // the auth context.
  //
  // Using useAuth() here would make this provider re-render on every auth
  // change — and since it wraps the entire app, so would everything else. A
  // ref costs nothing and re-renders nobody: the id is only ever read at the
  // moment a selection is written.
  const userId = useRef(null)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) userId.current = session?.user?.id ?? null
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      const next = session?.user?.id ?? null
      // A DIFFERENT person has signed in on this device. Drop the selection —
      // it belongs to whoever was here before, and their competitions are not
      // this person's to look at.
      if (userId.current && next && next !== userId.current) setSelected(null)
      if (!next) setSelected(null)
      userId.current = next
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  function select(id) {
    setSelected(id)
    try {
      const k = keyFor(userId.current)
      if (id) localStorage.setItem(k, id)
      else localStorage.removeItem(k)
    } catch { /* storage blocked — the choice still works for this session */ }
  }

  return (
    <SelectedCompetitionContext.Provider value={[selected, select]}>
      {children}
    </SelectedCompetitionContext.Provider>
  )
}

/** The stored selection for whichever account was last signed in here. */
function readStoredSelection() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(STORAGE_PREFIX + ':')) return localStorage.getItem(k)
    }
    // The old un-keyed value, from before this was per-user. Read once so
    // nobody loses their place on the day this ships, then removed so it
    // cannot leak to the next account on the device.
    const legacy = localStorage.getItem(STORAGE_PREFIX)
    if (legacy) localStorage.removeItem(STORAGE_PREFIX)
    return legacy || null
  } catch { return null }
}

export function useSelectedCompetition(competitions) {
  const ctx = useContext(SelectedCompetitionContext)
  if (!ctx) throw new Error('useSelectedCompetition must be used within a SelectedCompetitionProvider')
  const [selected, select] = ctx

  useEffect(() => {
    // ── Do not add `selected` to the dependencies, and do not act when the
    //    list is empty. Both look like improvements. Both are fatal. ──
    //
    // Every page calls useCompetitions() separately, so each holds its OWN
    // list, loading at its own speed. For a moment one page has loaded and
    // another has not.
    //
    // A version of this effect cleared the selection whenever its list was
    // empty, and re-ran whenever `selected` changed. The page that had loaded
    // set the selection; the page still loading cleared it; the change woke
    // them both; and they fought forever. Every page that waits on a
    // competition spun, while Settings — which does not — looked fine.
    //
    // Leaving an empty list alone means the page that HAS loaded decides, and
    // the one still loading simply says nothing.
    if (!competitions || !competitions.length) return

    // Nothing chosen yet, or the stored choice no longer exists (deleted, or
    // belongs to another account) — fall back to the first in the list.
    if (!selected || !competitions.some(c => c.id === selected)) {
      select(competitions[0].id)
    }
  }, [competitions])

  return [selected, select]
}
