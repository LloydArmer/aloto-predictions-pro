import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { loadF1Races, currentRace, loadF1Drivers, loadF1Results, loadF1Picks, lockTime, isLocked } from '../../../lib/sports/f1/data'
import { loadF1Rules, pointsForPlace, scorePicks, sessionsFor, confirmedField, isQualiSession, F1_SESSIONS } from '../../../lib/sports/f1/scoring'
import { Card, Button, Select, Spinner, EmptyState } from '../../ui'
import { FORMAT_MARK } from '../../ui/CompetitionIcon'
import F1OrderPicker from './F1OrderPicker'
import F1RaceHeader from './F1RaceHeader'
import F1SeasonPredict from './F1SeasonPredict'
import { driverItem, inOrder } from './f1Items'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

/**
 * The F1 Predict screen. A tab for each pick of the weekend, then Season:
 *
 *   Sprint grid  sprint weekends: the sprint qualifying order. Locks when it starts.
 *   Sprint       sprint weekends: the sprint finish. Locks at the sprint start.
 *   Grid         the qualifying order, all 22. Locks when qualifying starts.
 *   Race         the finishing order, all 22. Locks when the race starts.
 *   Season       Drivers' Champion, and the full tables where the league has them.
 *
 * A pick starts from the championship order (or, for the race, the
 * qualifying result once it is in), so nobody has to build 22 places from
 * nothing. While a session runs, each driver shows where they are now and
 * what your pick would score if it finished that way.
 */
export default function F1Predict() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [races, setRaces] = useState([])
  const [raceId, setRaceId] = useState(null)
  const [rules, setRules] = useState(null)
  const [drivers, setDrivers] = useState([])
  const EMPTY = { sprint_grid: [], sprint: [], grid: [], race: [] }
  const [results, setResults] = useState(EMPTY)
  const [orders, setOrders] = useState(EMPTY)
  const [saved, setSaved] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('grid')
  const location = useLocation()
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'season') setTab('season')
  }, [location.search])

  const race = races.find(r => r.id === raceId) || null

  useEffect(() => {
    if (!comp) return
    let cancelled = false
    ;(async () => {
      const [list, rl] = await Promise.all([loadF1Races(supabase, comp), loadF1Rules(supabase, comp)])
      if (cancelled) return
      setRaces(list); setRules(rl)
      const cur = currentRace(list)
      setRaceId(cur?.id || null)
      if (!cur) setLoading(false)
      // Open on the first pick still to make this weekend.
      if (cur) {
        const next = sessionsFor(cur).find(x => !isLocked(cur, x.key)) || sessionsFor(cur).slice(-1)[0]
        setTab(t => t === 'season' ? t : next.key)
      }
    })()
    return () => { cancelled = true }
  }, [comp])

  useEffect(() => { if (race && user) loadRace() }, [raceId, user?.id])

  async function loadRace() {
    setLoading(true)
    try {
      const [{ drivers: ds }, res, picks] = await Promise.all([
        loadF1Drivers(supabase, race.season), loadF1Results(supabase, race.id), loadF1Picks(supabase, race.id, user.id),
      ])
      setDrivers(ds); setResults(res); setSaved(picks)
      const champ = ds.map(d => d.id)
      // A new pick starts from the session before it where that helps: the
      // sprint from sprint qualifying, the race from qualifying.
      const seed = { sprint: 'sprint_grid', race: 'grid' }
      const next = {}
      for (const { key } of F1_SESSIONS) {
        const from = seed[key] ? res[seed[key]].filter(r => r.position).map(r => r.driver_id) : []
        next[key] = picks[key].length ? inOrderIds(champ, picks[key].map(p => p.driver_id))
          : from.length ? inOrderIds(champ, from) : champ
      }
      setOrders(next)
    } finally { setLoading(false) }
  }

  // While a session is running, refresh the order every 30 seconds.
  useEffect(() => {
    if (!race) return
    const first = sessionsFor(race)[0].key
    const running = race.live_session || (isLocked(race, first) && !race.race_confirmed && Date.now() < +new Date(race.race_at) + 4 * 3600e3)
    if (!running) return
    const t = setInterval(async () => {
      const [res, { data: r }] = await Promise.all([
        loadF1Results(supabase, race.id),
        supabase.from('f1_races').select('*').eq('id', race.id).maybeSingle(),
      ])
      setResults(res)
      if (r) setRaces(list => list.map(x => x.id === r.id ? { ...x, ...r } : x))
    }, 30000)
    return () => clearInterval(t)
  }, [race?.id, race?.live_session])

  const byId = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers])

  if (!competitions.length) return (
    <EmptyState icon="ti-steering-wheel" title="No F1 leagues yet"
      description="Enter the code your league admin sent you to join one." />
  )

  const weekend = sessionsFor(race)
  const session = weekend.some(x => x.key === tab) ? tab : (weekend[weekend.length - 1]?.key || 'race')
  const sessionDef = F1_SESSIONS.find(x => x.key === session)
  const quali = isQualiSession(session)
  const locked = race ? isLocked(race, session) : true
  const count = quali ? Math.min(rules?.gridPositions ?? 22, drivers.length) : Math.min(rules?.racePositions ?? 22, drivers.length)
  const items = orders[session].map(id => byId.get(id)).filter(Boolean).map(driverItem)
  const savedIds = saved[session].map(p => p.driver_id)
  const dirty = !locked && orders[session].slice(0, count).join() !== savedIds.slice(0, count).join()
  const result = results[session]
  const confirmed = race?.[confirmedField(session)]
  const shownPicks = locked ? saved[session] : orders[session].slice(0, count).map((driver_id, i) => ({ driver_id, position: i + 1 }))
  const scored = rules && result.length ? scorePicks(session, shownPicks, result, rules) : null

  // After lock, the rows are your saved picks; each shows where that driver is.
  const lockedItems = saved[session].map(p => byId.get(p.driver_id)).filter(Boolean).map(driverItem)
  const marks = {}
  if (locked && result.length) {
    const pos = new Map(result.map(r => [r.driver_id, r.position]))
    saved[session].forEach(p => {
      const at = pos.get(p.driver_id)
      const ok = at === p.position
      marks[p.driver_id] = ok
        ? { ok: true, text: `+${pointsForPlace(session, p.position, rules)}` }
        : { ok: false, text: at ? `P${at}` : 'Out' }
    })
  }

  async function save() {
    setSaving(true)
    const { error } = await supabase.rpc('f1_save_picks', { p_race_id: race.id, p_session: session, p_driver_ids: orders[session].slice(0, count) })
    setSaving(false)
    if (error) {
      toast.error(/LOCKED/.test(error.message) ? 'Too late: this has locked' : `Could not save: ${error.message}`)
      return
    }
    toast.success(`${sessionDef.label} saved`)
    setSaved(s => ({ ...s, [session]: orders[session].slice(0, count).map((driver_id, i) => ({ driver_id, position: i + 1 })) }))
  }

  function startFrom(kind) {
    const champ = drivers.map(d => d.id)
    const ids = kind === 'champ' ? champ : results[kind].filter(r => r.position).map(r => r.driver_id)
    setOrders(o => ({ ...o, [session]: inOrderIds(champ, ids) }))
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-4">
        <Select value={comp || ''} onChange={e => setComp(e.target.value)} style={{ flex: '1 1 200px' }}>
          {competitions.map(c => <option key={c.id} value={c.id}>{FORMAT_MARK[c.format] || ''} {c.name}</option>)}
        </Select>
        {tab !== 'season' && (
          <Select value={raceId || ''} onChange={e => setRaceId(e.target.value)} style={{ flex: '1 1 160px' }}>
            {races.length === 0 && <option value="">No races yet</option>}
            {races.map(r => <option key={r.id} value={r.id}>{r.round ? `R${r.round} ` : ''}{r.name}{r.status === 'cancelled' ? ' (cancelled)' : ''}</option>)}
          </Select>
        )}
      </div>

      <div className="flex gap-4 mb-4 overflow-x-auto" style={{ borderBottom: '0.5px solid var(--border)', scrollbarWidth: 'none' }}>
        {[...weekend.map(x => [x.key, x.label]), ['season', 'Season']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="text-sm pb-2 whitespace-nowrap"
            style={{ color: tab === k ? 'var(--accent)' : 'var(--txt-muted)', fontWeight: tab === k ? 600 : 400, borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'season' && comp && <F1SeasonPredict competitionId={comp} userId={user?.id} season={race?.season || races[races.length - 1]?.season || new Date().getFullYear()} />}

      {tab !== 'season' && (loading ? <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        : !race ? <EmptyState icon="ti-calendar-off" title="No races yet" description="Races appear when the league admin adds them" />
        : <>
          <F1RaceHeader race={race} />

          <Card className="p-3.5 mb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>
                  {quali ? `Your ${session === 'sprint_grid' ? 'sprint grid' : 'grid'}` : `Your ${session === 'sprint' ? 'sprint' : 'race'} order, 1 to ${count}`}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--txt-muted)' }}>
                  {quali
                    ? `${rules?.gridPoints ?? 5} points for each driver in exactly the right place in ${sessionDef.name.toLowerCase()}.`
                    : `Each driver in exactly the right place scores what that place scores in the ${session === 'sprint' ? 'sprint' : 'race'}.`}
                </p>
                <p className="text-xs mt-1" style={{ color: locked ? 'var(--txt-muted)' : 'var(--amber)' }}>
                  {locked ? 'Locked' : 'Locks'} {format(lockTime(race, session), 'EEE d MMM, HH:mm')}
                </p>
              </div>
              {scored && (
                <div className="text-right flex-shrink-0">
                  <p className="text-2xl font-semibold" style={{ color: confirmed ? 'var(--green)' : 'var(--txt-primary)' }}>{scored.points}</p>
                  <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>{confirmed ? 'points' : 'if it ends now'}</p>
                </div>
              )}
            </div>
            {!locked && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <Button className="btn-sm" onClick={() => startFrom('champ')}>Start from championship order</Button>
                {!quali && results[session === 'sprint' ? 'sprint_grid' : 'grid'].some(r => r.position) && (
                  <Button className="btn-sm" onClick={() => startFrom(session === 'sprint' ? 'sprint_grid' : 'grid')}>
                    Start from {session === 'sprint' ? 'sprint qualifying' : 'qualifying'}
                  </Button>
                )}
              </div>
            )}
          </Card>

          {drivers.length === 0 ? (
            <EmptyState icon="ti-users" title="No drivers yet" description="The admin loads this season's drivers in Admin → Races." />
          ) : locked && !saved[session].length ? (
            <EmptyState icon="ti-lock" title="No picks made" description={`${sessionDef.name} started before a pick was saved.`} />
          ) : (
            <F1OrderPicker
              items={locked ? lockedItems : items}
              scored={locked ? lockedItems.length : count}
              locked={locked}
              marks={marks}
              pointsFor={rules ? p => pointsForPlace(session, p, rules) : null}
              onChange={next => setOrders(o => ({ ...o, [session]: next.map(x => x.id) }))} />
          )}

          {!locked && drivers.length > 0 && (
            <div className="sticky bottom-3 mt-3">
              <Button variant="primary" className="w-full" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : dirty ? (savedIds.length ? 'Save changes' : 'Save my picks') : 'Saved'}
              </Button>
            </div>
          )}

          {locked && result.length > 0 && <LiveOrder result={result} byId={byId} confirmed={confirmed} session={session} race={race} />}
        </>)}
    </div>
  )
}

const inOrderIds = (all, ids) => inOrder(all.map(id => ({ id })), ids).map(x => x.id)

/** The real order: live while the session runs, final once confirmed. */
function LiveOrder({ result, byId, confirmed, session, race }) {
  const rows = result.filter(r => r.position).sort((a, b) => a.position - b.position)
  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--txt-muted)' }}>
          {F1_SESSIONS.find(x => x.key === session)?.name} {confirmed ? 'result' : 'order now'}
        </p>
        {!confirmed && !isQualiSession(session) && race.live_session === session && race.live_lap && (
          <span className="text-xs" style={{ color: 'var(--red)' }}>● Lap {race.live_lap}{race.total_laps ? `/${race.total_laps}` : ''}</span>
        )}
      </div>
      {rows.map(r => {
        const d = byId.get(r.driver_id)
        return (
          <div key={r.id} className="flex items-center gap-2 px-4 py-1.5 text-xs" style={{ borderTop: '0.5px solid var(--border)' }}>
            <span className="font-semibold" style={{ width: 22, color: 'var(--txt-muted)' }}>{r.position}</span>
            <span className="flex-1 truncate" style={{ color: 'var(--txt-primary)' }}>{d?.name || 'Driver'}</span>
            <span style={{ color: 'var(--txt-muted)' }}>{r.gap || ''}</span>
          </div>
        )
      })}
    </Card>
  )
}
