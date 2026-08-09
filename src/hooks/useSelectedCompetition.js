import { useState, useEffect } from 'react'

const STORAGE_KEY = 'aloto_selected_competition'

// One shared "which competition am I looking at" choice, used by every
// page (Dashboard, Predict, Table, Leaderboards, Bracket, Admin). Picking
// a competition anywhere in the app carries it everywhere else too, and
// it survives a page reload — instead of every screen independently
// defaulting to whichever competition happens to sort first.
export function useSelectedCompetition(competitions) {
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || null } catch { return null }
  })

  useEffect(() => {
    if (!competitions || !competitions.length) return
    // Nothing chosen yet, or the stored choice no longer exists (e.g. it
    // was deleted) — fall back to the first competition in the list.
    if (!selected || !competitions.some(c => c.id === selected)) {
      select(competitions[0].id)
    }
  }, [competitions])

  function select(id) {
    setSelected(id)
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
  }

  return [selected, select]
}
