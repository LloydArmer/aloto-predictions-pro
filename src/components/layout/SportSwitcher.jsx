import { useState } from 'react'
import { useSport } from '../../hooks/useSport'

/**
 * The sport chooser in the top bar.
 *
 * A button showing the current sport that opens a short list, rather than a
 * row of tabs: the bar already carries the brand, chat, avatar and menu at
 * 390px, and a list keeps working when a third and fourth sport arrive.
 *
 * Switching sport also moves the selected competition to the first one in the
 * new sport (or clears it if there are none), so no page is left showing a
 * competition from the sport you just left.
 */
export default function SportSwitcher({ activeSport, allCompetitions, onSelectCompetition }) {
  const { sports, choose } = useSport()
  const [open, setOpen] = useState(false)
  const current = sports.find(s => s.id === activeSport) || sports[0]

  function pick(sportId) {
    setOpen(false)
    if (sportId === activeSport) return
    choose(sportId)
    const first = allCompetitions.find(c => (c.sport || 'football') === sportId)
    onSelectCompetition(first ? first.id : null)
  }

  return (
    <div className="relative flex-shrink-0">
      <style>{`
        @media (max-width: 379px) {
          .aloto-sport-name { display: none; }
        }
      `}</style>
      <button
        className="pill active"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sport: ${current?.name}. Change sport`}
        style={{ gap: 5, paddingLeft: 9, paddingRight: 8 }}>
        <span aria-hidden="true">{current?.emoji}</span>
        <span className="aloto-sport-name">{current?.name}</span>
        <i className={`ti ${open ? 'ti-chevron-up' : 'ti-chevron-down'} text-xs`} aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Tap anywhere else to close. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="listbox"
            className="absolute left-0 top-9 rounded-lg shadow-lg py-1 z-50 min-w-36"
            style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-med)' }}>
            {sports.map(s => (
              <button key={s.id} role="option" aria-selected={s.id === activeSport}
                onClick={() => pick(s.id)}
                className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left"
                style={{
                  color: s.id === activeSport ? 'var(--accent)' : 'var(--txt-second)',
                  fontWeight: s.id === activeSport ? 500 : 400,
                }}>
                <span aria-hidden="true">{s.emoji}</span>{s.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
