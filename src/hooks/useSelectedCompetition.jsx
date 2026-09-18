import { createContext, useContext, useState, useEffect } from 'react'
import { useAuth } from './useAuth'

/* The stored choice is keyed BY USER.
 *
 * It used to be one global key. Sign in as somebody else and their app opened
 * on the previous account's competition — and because the validation below
 * gives up when the list is empty, a brand new user with no competitions at
 * all kept the old id and loaded another league's fixtures with it.
 *
 * A per-user key cannot do that: a different account reads a different key and
 * finds nothing, which is the correct answer for someone who has not chosen
 * yet. */
const STORAGE_PREFIX = 'aloto_selected_competition'
const keyFor = userId => (userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX)
const SelectedCompetitionContext = createContext(null)

// One shared "which competition am I looking at" choice, used by every
// page (Dashboard, Predict, Table, Bracket, Admin) AND the nav bar. This
// lives in a single React Context, not independent per-component state —
// each page previously had its own copy that only read localStorage once
// on mount, so switching competitions on one page never notified the nav
// bar (which stays mounted across navigation) or any other already-open
// page. A shared context means every consumer re-renders the instant the
// selection changes, anywhere in the app.
export function SelectedCompetitionProvider({ children }) {
  const { user } = useAuth()
  const [selected, setSelected] = useState(null)

  // Re-read whenever the signed-in user changes, including to nobody. Without
  // this the state would hold whatever the last account was looking at until
  // something else happened to overwrite it.
  useEffect(() => {
    if (!user?.id) { setSelected(null); return }
    try { setSelected(localStorage.getItem(keyFor(user.id)) || null) }
    catch { setSelected(null) }
  }, [user?.id])

  function select(id) {
    setSelected(id)
    try {
      const k = keyFor(user?.id)
      if (id) localStorage.setItem(k, id)
      else localStorage.removeItem(k)
    } catch { /* storage blocked — the choice still works for this session */ }
  }

  // Tidy away the old shared key, so a device that has been used by two people
  // is not left holding one of their competition ids indefinitely.
  useEffect(() => {
    try { localStorage.removeItem(STORAGE_PREFIX) } catch { /* ignore */ }
  }, [])

  return (
    <SelectedCompetitionContext.Provider value={[selected, select]}>
      {children}
    </SelectedCompetitionContext.Provider>
  )
}

export function useSelectedCompetition(competitions) {
  const ctx = useContext(SelectedCompetitionContext)
  if (!ctx) throw new Error('useSelectedCompetition must be used within a SelectedCompetitionProvider')
  const [selected, select] = ctx

  useEffect(() => {
    if (!competitions) return

    // No competitions at all — a new account, or someone removed from the last
    // one they were in. Anything still selected belongs to somebody else.
    //
    // The previous version returned early here, which is how a brand new user
    // ended up looking at another league's gameweek: the list was empty, so the
    // stale id was never questioned.
    if (!competitions.length) {
      if (selected) select(null)
      return
    }

    // Nothing chosen yet, or the stored choice is not one of theirs — fall back
    // to the first in the list.
    if (!selected || !competitions.some(c => c.id === selected)) {
      select(competitions[0].id)
    }
  }, [competitions, selected])

  return [selected, select]
}
