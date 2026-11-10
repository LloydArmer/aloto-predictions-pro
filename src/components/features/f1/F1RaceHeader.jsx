import { useEffect, useState } from 'react'
import { Card } from '../../ui'
import { format, formatDistanceToNowStrict } from 'date-fns'

/**
 * The race weekend at a glance: which Grand Prix, where, when qualifying and
 * the race start, and what is happening now (live, next up, or finished).
 */
export default function F1RaceHeader({ race, compact = false }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 60000); return () => clearInterval(t) }, [])

  const now = Date.now()
  const q = race.qualifying_at ? new Date(race.qualifying_at) : null
  const r = new Date(race.race_at)
  const sq = race.sprint_qualifying_at ? new Date(race.sprint_qualifying_at) : null
  const sp = race.sprint_at ? new Date(race.sprint_at) : null
  const LIVE = { sprint_grid: 'Sprint qualifying live', sprint: 'Sprint live', grid: 'Qualifying live', race: 'Race live' }
  let status, colour = 'var(--txt-second)'
  if (race.status === 'cancelled') { status = 'Cancelled'; colour = 'var(--red)' }
  else if (race.race_confirmed) { status = 'Finished'; colour = 'var(--green)' }
  else if (race.live_session === 'race') { status = `Race live${race.live_lap ? ` · lap ${race.live_lap}${race.total_laps ? `/${race.total_laps}` : ''}` : ''}`; colour = 'var(--red)' }
  else if (race.live_session) { status = LIVE[race.live_session]; colour = 'var(--red)' }
  else if (sq && now < +sq) status = `Sprint qualifying in ${formatDistanceToNowStrict(sq)}`
  else if (sp && now < +sp) status = `Sprint in ${formatDistanceToNowStrict(sp)}`
  else if (q && now < +q) status = `Qualifying in ${formatDistanceToNowStrict(q)}`
  else if (now < +r) status = `Race in ${formatDistanceToNowStrict(r)}`
  else status = 'Waiting for the result'

  return (
    <Card className={compact ? 'p-3.5' : 'p-4 mb-3'} style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--accent)' }}>
            {race.round ? `Round ${race.round}` : 'Grand Prix'}{race.country ? ` · ${race.country}` : ''}{sp ? ' · Sprint weekend' : ''}
          </p>
          <p className="text-base font-semibold truncate" style={{ color: 'var(--txt-primary)' }}>{race.name}</p>
          {race.circuit && <p className="text-xs truncate" style={{ color: 'var(--txt-muted)' }}>{race.circuit}</p>}
        </div>
        <span className="text-[11px] font-semibold px-2 py-1 rounded whitespace-nowrap" style={{ background: 'var(--bg-elevated)', color: colour }}>
          {(race.live_session && !race.race_confirmed) && '● '}{status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {[...(sp ? [['Sprint qualifying', sq], ['Sprint', sp]] : []), ['Qualifying', q], ['Race', r]].map(([label, at]) => (
          <div key={label} className="rounded-md px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
            <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>{label}</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>{at ? format(at, 'EEE d MMM, HH:mm') : 'TBC'}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}
