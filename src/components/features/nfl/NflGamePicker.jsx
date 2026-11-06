import { useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../../../lib/supabase'
import { Button, Input, Spinner } from '../../ui'
import { nflTeam } from '../../../lib/sports/nfl/teams'
import toast from 'react-hot-toast'

/**
 * Admin: choose NFL games for this gameweek from the NFL feed.
 *
 * The admin picks the week, sees that week's games, and ticks the ones the
 * league will play — all of them, or only a few. Games already in the
 * gameweek show as added. Added games come in linked to the feed, so live
 * scores and finals follow on their own.
 */
export default function NflGamePicker({ gameweekId, gwNumber, onAdded }) {
  const guess = Number(String(gwNumber ?? '').match(/\d+/)?.[0]) || ''
  const [week, setWeek] = useState(guess)
  const [games, setGames] = useState(null)
  const [picked, setPicked] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)

  async function call(body) {
    const { data, error } = await supabase.functions.invoke('sync-nfl', { body })
    if (error) throw new Error('Could not reach the NFL feed. Is sync-nfl deployed?')
    if (!data?.ok) throw new Error(data?.error || 'The NFL feed did not respond')
    return data
  }

  async function show() {
    if (!week) { toast.error('Enter the NFL week number'); return }
    setLoading(true); setGames(null)
    try {
      const data = await call({ mode: 'week', gameweek_id: gameweekId, week: Number(week) })
      setGames(data.games)
      // Everything not yet added starts ticked; untick what the league skips.
      setPicked(new Set(data.games.filter(g => !g.added).map(g => g.id)))
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  async function add() {
    if (!picked.size) { toast.error('Tick at least one game'); return }
    setAdding(true)
    try {
      const data = await call({ mode: 'import', gameweek_id: gameweekId, week: Number(week), game_ids: [...picked] })
      toast.success(`${data.added} game${data.added === 1 ? '' : 's'} added`)
      setGames(gs => gs.map(g => picked.has(g.id) ? { ...g, added: true } : g))
      setPicked(new Set())
      onAdded?.()
    } catch (e) { toast.error(e.message) }
    finally { setAdding(false) }
  }

  function toggle(id) {
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const open = (games || []).filter(g => !g.added)
  const allTicked = open.length > 0 && open.every(g => picked.has(g.id))

  return (
    <div className="mb-4 p-3 rounded-md" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}>
      <p className="text-sm font-medium mb-2" style={{ color: 'var(--txt-primary)' }}>NFL games</p>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs" style={{ color: 'var(--txt-second)' }}>Week</span>
        <Input type="number" min="1" max="22" value={week} style={{ width: 64 }} onChange={e => setWeek(e.target.value)} />
        <Button size="sm" onClick={show} disabled={loading}>{loading ? 'Loading…' : 'Show games'}</Button>
      </div>

      {loading && <div className="flex justify-center py-4"><Spinner size="sm" /></div>}

      {games && (
        <>
          {open.length > 1 && (
            <button className="text-xs mb-1" style={{ color: 'var(--accent)' }}
              onClick={() => setPicked(allTicked ? new Set() : new Set(open.map(g => g.id)))}>
              {allTicked ? 'Untick all' : 'Tick all'}
            </button>
          )}
          <div className="rounded-md overflow-hidden mb-2" style={{ border: '0.5px solid var(--border)' }}>
            {games.map((g, i) => {
              const a = nflTeam(g.away_team), h = nflTeam(g.home_team)
              return (
                <label key={g.id} className="flex items-center gap-2.5 px-3 py-2 text-sm"
                  style={{ borderTop: i ? '0.5px solid var(--border)' : '', cursor: g.added ? 'default' : 'pointer', opacity: g.added ? 0.6 : 1 }}>
                  <input type="checkbox" checked={g.added || picked.has(g.id)} disabled={g.added} onChange={() => toggle(g.id)} />
                  <span className="font-semibold" style={{ width: 82, color: 'var(--txt-primary)' }}>{a.abbr} @ {h.abbr}</span>
                  <span className="flex-1 text-xs" style={{ color: 'var(--txt-muted)' }}>
                    {format(new Date(g.kickoff_time), 'EEE d MMM, HH:mm')}
                  </span>
                  {g.added && <span className="text-xs" style={{ color: 'var(--green)' }}>Added</span>}
                </label>
              )
            })}
          </div>
          {open.length > 0 ? (
            <Button variant="primary" size="sm" onClick={add} disabled={adding || !picked.size}>
              {adding ? 'Adding…' : `Add ${picked.size} game${picked.size === 1 ? '' : 's'}`}
            </Button>
          ) : (
            <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>Every game this week is already added.</p>
          )}
        </>
      )}
    </div>
  )
}
