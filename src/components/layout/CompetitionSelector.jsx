import { useRef, useEffect } from 'react'
import { useCompetitions } from '../../hooks/useCompetitions'
import CompetitionIcon from '../ui/CompetitionIcon'

/**
 * The competition switcher.
 *
 * A single row that scrolls sideways rather than a block that wraps onto four
 * lines. Six competitions used to take a third of the dashboard before anything
 * useful appeared; this takes one row however many there are.
 *
 * The selected pill is scrolled into view on mount, so opening the app on a
 * competition that sits off to the right doesn't look like it isn't selected.
 */
export default function CompetitionSelector({ value, onChange, excludeFormats = [] }) {
  const { competitions, loading } = useCompetitions()
  const scroller = useRef(null)
  const selected = useRef(null)

  const visible = excludeFormats.length
    ? competitions.filter(c => !excludeFormats.includes(c.format))
    : competitions

  useEffect(() => {
    // 'nearest' rather than 'center' — centring yanks the row about even when
    // the pill was already perfectly visible.
    selected.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [value, competitions.length])

  if (loading) return (
    <div className="flex gap-2 mb-4">
      {[1,2,3].map(i => (
        <div key={i} className="h-7 w-28 rounded-full animate-pulse flex-shrink-0"
          style={{ background: 'var(--bg-raised)' }} />
      ))}
    </div>
  )

  // One competition is not a choice, so there is nothing to show.
  if (visible.length <= 1) return null

  return (
    <div style={{ position: 'relative', marginBottom: 20 }}>
      <div
        ref={scroller}
        className="flex gap-1.5 aloto-comp-row"
        style={{
          overflowX: 'auto',
          overflowY: 'hidden',
          // Negative margin then padding, so pills can scroll to the very edge
          // of the screen rather than stopping inside the page gutter.
          margin: '0 -16px',
          padding: '2px 16px',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* The scrollbar is hidden on desktop too — this is a phone control and
            a grey bar under it looks like a mistake. */}
        <style>{`
          .aloto-comp-row::-webkit-scrollbar { display: none; }
        `}</style>

        {visible.map(c => (
          <button
            key={c.id}
            ref={value === c.id ? selected : null}
            className={`pill ${value === c.id ? 'active' : ''}`}
            onClick={() => onChange(c.id)}
            style={{
              gap: 7,
              paddingLeft: 6,
              // Stops long names being squashed rather than scrolled.
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <CompetitionIcon format={c.format} emoji={c.emoji} />
            {c.name}
          </button>
        ))}
      </div>

      {/* A fade at the right edge, so it is obvious there is more to swipe to.
          Without it a row that happens to end near the edge looks complete. */}
      <div style={{
        position: 'absolute', right: -16, top: 0, bottom: 0, width: 28,
        pointerEvents: 'none',
        background: 'linear-gradient(to right, transparent, var(--bg-base, #0d0f14))',
      }}/>
    </div>
  )
}
