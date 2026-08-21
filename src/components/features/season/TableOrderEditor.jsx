import { useMemo } from 'react'
import { Select } from '../../ui'

/**
 * Orders a pool of teams into positions 1..N.
 *
 * Used in two places with the same rules — an admin entering the real final
 * table, and a participant predicting one. Sharing the component means the two
 * can't drift apart, which matters because they're scored against each other
 * position by position.
 *
 * A row per position with a dropdown, rather than drag-and-drop. Dragging 20
 * rows on a phone is genuinely unpleasant, and a mis-drop is silent — you don't
 * notice until you're scored. A dropdown is slower but says exactly what it
 * did, and a team already used elsewhere is removed from the remaining lists,
 * so the same team cannot be placed twice.
 *
 * @param teams     the pool: [{ id, name }]
 * @param value     { [position]: teamId }
 * @param onChange  (position, teamId | null) => void
 * @param count     how many positions
 * @param disabled  locked after the deadline
 */
export default function TableOrderEditor({ teams, value, onChange, count, disabled = false, highlight = null }) {
  const positions = useMemo(() => Array.from({ length: count }, (_, i) => i + 1), [count])

  // Teams already placed, so each dropdown can hide them.
  const usedElsewhere = useMemo(() => {
    const map = {}
    for (const [pos, teamId] of Object.entries(value || {})) {
      if (teamId) map[teamId] = Number(pos)
    }
    return map
  }, [value])

  const filled = Object.values(value || {}).filter(Boolean).length

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>
          {filled} of {count} placed
        </span>
        {filled > 0 && !disabled && (
          <button
            onClick={() => positions.forEach(p => onChange(p, null))}
            className="text-xs" style={{ color: 'var(--txt-muted)', textDecoration: 'underline' }}>
            Clear all
          </button>
        )}
      </div>

      <div className="rounded-md overflow-hidden" style={{ border: '0.5px solid var(--border-med)' }}>
        {positions.map(pos => {
          const selected = value?.[pos] || ''
          const isRight = highlight?.[pos] === true
          const isWrong = highlight?.[pos] === false

          return (
            <div key={pos} className="flex items-center gap-2 px-2.5 py-2"
              style={{
                borderBottom: pos < count ? '0.5px solid var(--border)' : 'none',
                background: isRight ? 'var(--green-dim)' : isWrong ? 'rgba(255,90,90,0.08)' : 'var(--bg-surface)',
              }}>
              <span className="text-xs font-semibold text-center flex-shrink-0"
                style={{ width: 22, color: pos <= 4 ? 'var(--accent)' : pos > count - 3 ? 'var(--red)' : 'var(--txt-muted)' }}>
                {pos}
              </span>

              <Select
                value={selected}
                disabled={disabled}
                onChange={e => onChange(pos, e.target.value || null)}
                style={{ flex: '1 1 auto', minWidth: 0 }}>
                <option value="">—</option>
                {teams
                  // Keep the currently selected team in its own list, or the
                  // dropdown would show blank for the row you're looking at.
                  .filter(t => !usedElsewhere[t.id] || usedElsewhere[t.id] === pos)
                  .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>

              {isRight && <i className="ti ti-check text-sm flex-shrink-0" style={{ color: 'var(--green)' }} aria-hidden="true" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
