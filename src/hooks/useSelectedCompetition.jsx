import { createContext, useContext, useState, useEffect } from 'react'

const STORAGE_KEY = 'aloto_selected_competition'
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
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || null } catch { return null }
  })

  function select(id) {
    setSelected(id)
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
  }

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
    if (!competitions || !competitions.length) return
    // Nothing chosen yet, or the stored choice no longer exists (e.g. it
    // was deleted) — fall back to the first competition in the list.
    if (!selected || !competitions.some(c => c.id === selected)) {
      select(competitions[0].id)
    }
  }, [competitions])

  return [selected, select]
}
