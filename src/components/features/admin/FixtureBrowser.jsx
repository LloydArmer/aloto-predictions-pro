import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Button, Input, Spinner } from '../../ui'
import { formatUK } from '../../../lib/time'
import toast from 'react-hot-toast'

/**
 * Pick real fixtures from the provider and add them to a gameweek.
 *
 * This replaces typing team names and hoping they match. Matching what an admin
 * typed against what the provider calls a club fails eventually — "Bayern
 * München" against "Bayern Munich", "1. FC Köln" against "Cologne" — and every
 * alias added is a fixture that already failed for somebody.
 *
 * Picking from the real list removes the problem entirely: the names come from
 * the provider, and the fixture id is attached the moment it's created. Results
 * and live scores then arrive with nothing further to configure.
 *
 * Manual entry stays, below this, for anything not covered — North West
 * Counties, West Lancashire, a works league.
 */
export default function FixtureBrowser({ gameweekId, onAdded }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [fixtures, setFixtures] = useState(null)
  const [chosen, setChosen] = useState(new Set())
  const [adding, setAdding] = useState(false)
  const [meta, setMeta] = useState(null)

  async function browse() {
    setLoading(true)
    setFixtures(null)
    setChosen(new Set())
    try {
      const { data, error } = await supabase.functions.invoke('sync-football', {
        body: { mode: 'browse', date, search },
      })
      if (error) throw error
      if (data?.ok === false || data?.error) { toast.error(data.error || 'Lookup failed'); return }

      setFixtures(data.fixtures || [])
      setMeta({ total: data.total, truncated: data.truncated })

      if (!data.fixtures?.length) {
        toast.error(search.trim()
          ? `No fixtures matching "${search}" on that date`
          : 'No fixtures found on that date')
      }
    } catch (err) {
      console.error('browse failed:', err)
      toast.error(`Lookup failed: ${err?.message || err}`)
    } finally { setLoading(false) }
  }

  function toggle(id) {
    setChosen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function addChosen() {
    const picked = (fixtures || []).filter(f => chosen.has(f.api_fixture_id))
    if (!picked.length) return

    setAdding(true)
    try {
      // The api_fixture_id goes in at creation, so results and live scores work
      // straight away with nothing else to set up.
      const rows = picked.map(f => ({
        gameweek_id: gameweekId,
        home_team: f.home_team,
        away_team: f.away_team,
        kickoff_time: f.kickoff_time,
        api_fixture_id: f.api_fixture_id,
        status: 'upcoming',
      }))

      const { error } = await supabase.from('fixtures').insert(rows)
      if (error) throw error

      toast.success(`${picked.length} fixture${picked.length !== 1 ? 's' : ''} added`)
      setChosen(new Set())
      setFixtures(null)
      onAdded?.()
    } catch (err) {
      // A fixture already added shows as a duplicate-key error, which is worth
      // saying plainly rather than as a database message.
      const msg = String(err?.message || err)
      toast.error(msg.includes('duplicate')
        ? 'Some of those are already in this gameweek'
        : `Could not add: ${msg}`)
    } finally { setAdding(false) }
  }

  return (
    <div className="mb-3">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-sm"
        style={{ color: 'var(--accent)' }}>
        <i className={`ti ti-chevron-${open ? 'up' : 'down'} text-sm`} aria-hidden="true"/>
        <i className="ti ti-search text-sm" aria-hidden="true"/>
        Find real fixtures
      </button>

      {open && (
        <Card className="p-3 mt-2" style={{ background: 'var(--bg-elevated)' }}>
          <p className="text-xs mb-2.5" style={{ color: 'var(--txt-second)' }}>
            Pick fixtures from the real calendar and their results arrive automatically. Team names
            come from the source, so nothing has to match.
          </p>

          <div className="flex flex-wrap gap-2 mb-2">
            <div style={{ flex: '0 1 170px' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Date</p>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ width: '100%', maxWidth: 170 }}/>
            </div>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Filter (optional)</p>
              <Input value={search} placeholder="Premier League, Bayern…"
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && browse()}
                className="w-full"/>
            </div>
          </div>

          <Button className="btn-sm" onClick={browse} disabled={loading}>
            {loading ? 'Searching…' : 'Show fixtures'}
          </Button>

          {loading && <div className="py-4"><Spinner/></div>}

          {fixtures && fixtures.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                  {fixtures.length} shown{meta?.total > fixtures.length ? ` of ${meta.total} that day` : ''}
                  {meta?.truncated && ' — narrow the filter to see more'}
                </p>
                {chosen.size > 0 && (
                  <Button variant="primary" className="btn-sm" onClick={addChosen} disabled={adding}>
                    {adding ? 'Adding…' : `Add ${chosen.size}`}
                  </Button>
                )}
              </div>

              <div className="rounded-md overflow-hidden" style={{ border: '0.5px solid var(--border-med)', maxHeight: 340, overflowY: 'auto' }}>
                {fixtures.map(f => {
                  const picked = chosen.has(f.api_fixture_id)
                  return (
                    <button key={f.api_fixture_id} onClick={() => toggle(f.api_fixture_id)}
                      className="flex items-center gap-2.5 w-full px-2.5 py-2 text-left"
                      style={{
                        borderBottom: '0.5px solid var(--border)',
                        background: picked ? 'var(--accent-dim)' : 'transparent',
                      }}>
                      <span className="flex items-center justify-center flex-shrink-0"
                        style={{
                          width: 18, height: 18, borderRadius: 5,
                          border: `1px solid ${picked ? 'var(--accent)' : 'var(--border-med)'}`,
                          background: picked ? 'var(--accent)' : 'transparent',
                        }}>
                        {picked && <i className="ti ti-check text-xs" style={{ color: '#fff' }} aria-hidden="true"/>}
                      </span>

                      <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <span className="text-sm block" style={{ color: 'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.home_team} v {f.away_team}
                        </span>
                        <span className="text-xs block" style={{ color: 'var(--txt-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.league_name} · {formatUK(f.kickoff_time, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {fixtures && fixtures.length === 0 && (
            <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>
              Nothing found. Coverage reaches step 4 of the English pyramid — below that (North West
              Counties, West Lancashire, works and Sunday leagues) fixtures aren't listed, and you
              add those by hand below.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
