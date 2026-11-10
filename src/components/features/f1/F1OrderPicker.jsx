import { useState } from 'react'

/**
 * Put a list in order: the grid, the race finish, or a championship table.
 *
 * No dragging (fiddly on a phone, and a scroll that turns into a drag loses
 * picks). Instead: tap one row, then tap another to swap them, or use the
 * arrows to move a row one place. The whole order is always valid, because
 * every move is a swap.
 *
 *   items     [{ id, title, subtitle, colour, tag }]  in the current order
 *   scored    how many places count (20 for the race); rows below that sit
 *             under a "not scored" line
 *   pointsFor (place) => points shown beside the place, optional
 *   marks     { [id]: { ok, text } } after the result, optional
 *   locked    read only
 */
export default function F1OrderPicker({ items, onChange, scored, pointsFor, marks = {}, locked = false }) {
  const [picked, setPicked] = useState(null)
  const count = scored ?? items.length

  function swap(i, j) {
    if (locked || i === j || j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  function tap(i) {
    if (locked) return
    if (picked === null) { setPicked(i); return }
    if (picked !== i) swap(picked, i)
    setPicked(null)
  }

  return (
    <div>
      {!locked && (
        <p className="text-xs mb-2" style={{ color: 'var(--txt-muted)' }}>
          Tap a driver, then tap another to swap them. Or use the arrows.
        </p>
      )}
      <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
        {items.map((it, i) => {
          const sel = picked === i
          const mark = marks[it.id]
          const pts = pointsFor ? pointsFor(i + 1) : null
          return (
            <div key={it.id}>
              {i === count && (
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide" style={{ background: 'var(--bg-elevated)', color: 'var(--txt-muted)', borderTop: '0.5px solid var(--border)' }}>
                  Not scored
                </div>
              )}
              <div onClick={() => tap(i)}
                className="flex items-center gap-2 pr-1.5 select-none"
                style={{
                  minHeight: 44, cursor: locked ? 'default' : 'pointer',
                  borderTop: i ? '0.5px solid var(--border)' : 'none',
                  background: sel ? 'var(--accent-dim)' : mark?.ok ? 'var(--green-dim)' : 'transparent',
                  opacity: i >= count ? 0.55 : 1,
                }}>
                <span style={{ width: 4, alignSelf: 'stretch', background: it.colour || 'var(--accent)' }} />
                <span className="text-sm font-semibold text-right" style={{ width: 26, color: 'var(--txt-muted)' }}>{i + 1}</span>
                <div className="flex-1 min-w-0 py-1.5">
                  <p className="text-sm truncate" style={{ color: 'var(--txt-primary)', fontWeight: 600 }}>
                    {it.tag && <span className="mr-1.5 font-mono text-xs" style={{ color: 'var(--txt-second)' }}>{it.tag}</span>}
                    {it.title}
                  </p>
                  {it.subtitle && <p className="text-[11px] truncate" style={{ color: 'var(--txt-muted)' }}>{it.subtitle}</p>}
                </div>
                {mark && (
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ background: mark.ok ? 'var(--green-dim)' : 'var(--bg-elevated)', color: mark.ok ? 'var(--green)' : 'var(--txt-muted)' }}>
                    {mark.text}
                  </span>
                )}
                {!mark && pts != null && i < count && (
                  <span className="text-[11px] whitespace-nowrap" style={{ color: pts ? 'var(--txt-second)' : 'var(--txt-muted)' }}>{pts} pts</span>
                )}
                {!locked && (
                  <div className="flex flex-col" onClick={e => e.stopPropagation()}>
                    <button aria-label="Move up" className="px-2 leading-none" style={{ color: 'var(--txt-second)', height: 20 }} onClick={() => swap(i, i - 1)} disabled={i === 0}>
                      <i className="ti ti-chevron-up" aria-hidden="true" />
                    </button>
                    <button aria-label="Move down" className="px-2 leading-none" style={{ color: 'var(--txt-second)', height: 20 }} onClick={() => swap(i, i + 1)} disabled={i === items.length - 1}>
                      <i className="ti ti-chevron-down" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
