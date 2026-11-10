import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { loadF1Races, currentRace, loadF1Drivers, loadF1Results, loadF1Picks, loadF1Table, isLocked, lockTime } from '../../../lib/sports/f1/data'
import { loadF1Rules, scorePicks, sessionsFor, confirmedField, F1_SESSIONS } from '../../../lib/sports/f1/scoring'
import { teamColour } from '../../../lib/sports/f1/teams'
import { StatCard, Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import JoinCompetition from '../competitions/JoinCompetition'
import F1RaceHeader from './F1RaceHeader'
import { format } from 'date-fns'

/**
 * The F1 Dashboard. Top to bottom: the next race weekend (where, when, and
 * what is live), your picks for it, the live order with your points so far
 * while a session runs, your season numbers, the top of the table, and how
 * the last race went.
 */
export default function F1Dashboard() {
  const { user, isAdmin } = useAuth()
  const { competitions, loading: compsLoading } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => { if (comp && user) load(); else setLoading(false) }, [comp, user?.id])

  async function load(quiet = false) {
    if (!quiet) setLoading(true)
    try {
      const [races, rules, table] = await Promise.all([loadF1Races(supabase, comp), loadF1Rules(supabase, comp), loadF1Table(supabase, comp)])
      const race = currentRace(races)
      const last = [...races].reverse().find(r => r.race_confirmed && r.id !== race?.id) || null
      const none = { sprint_grid: [], sprint: [], grid: [], race: [] }
      let drivers = [], results = none, picks = none
      if (race) {
        ;[{ drivers }, results, picks] = await Promise.all([
          loadF1Drivers(supabase, race.season), loadF1Results(supabase, race.id), loadF1Picks(supabase, race.id, user.id),
        ])
      }
      setData({ races, race, last, rules, table, drivers, results, picks })
    } finally { setLoading(false) }
  }

  // Live: refresh every 30 seconds while a session is running.
  const live = !!data?.race?.live_session
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => load(true), 30000)
    return () => clearInterval(t)
  }, [live, comp])

  const byId = useMemo(() => new Map((data?.drivers || []).map(d => [d.id, d])), [data?.drivers])

  if (compsLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>

  if (!competitions.length) return (
    <div>
      <Card className="p-6 text-center mb-4">
        <EmptyState icon="ti-steering-wheel" title="No F1 leagues yet"
          description={isAdmin ? 'Create one in Admin, or join one with a code.' : 'Enter the code your league admin sent you to join one.'}
          action={isAdmin ? <Link to="/admin" className="btn btn-primary btn-sm">Go to Admin</Link> : null} />
      </Card>
      <JoinCompetition onJoined={() => window.location.reload()} />
    </div>
  )

  const { race, last, rules, table = [], results, picks } = data || {}
  const me = table.find(r => r.user_id === user?.id)
  const lastMine = last && me ? me.byRace[last.id] : null

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp} />
      {loading || !data ? <div className="flex justify-center py-20"><Spinner size="lg" /></div> : <>

        {!race ? (
          <Card className="p-4 mb-3">
            <SectionLabel>Next race</SectionLabel>
            <p className="text-sm mt-2" style={{ color: 'var(--txt-muted)' }}>No races yet. They appear when the league admin adds them.</p>
          </Card>
        ) : <>
          <F1RaceHeader race={race} />

          {/* Your picks for this weekend */}
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            {sessionsFor(race).map(({ key: s, label }) => {
              const made = picks[s].length > 0
              const locked = isLocked(race, s)
              const sc = rules && results[s].length && made ? scorePicks(s, picks[s], results[s], rules) : null
              const confirmed = race[confirmedField(s)]
              return (
                <Link key={s} to="/predict" className="block">
                  <Card className="p-3.5 h-full" style={!made && !locked ? { background: 'var(--amber-dim)', borderColor: 'rgba(245,166,35,0.35)' } : undefined}>
                    <p className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--txt-muted)' }}>Your {label.toLowerCase()}</p>
                    {sc ? (
                      <p className="text-2xl font-semibold mt-1" style={{ color: confirmed ? 'var(--green)' : 'var(--txt-primary)' }}>
                        {sc.points}<span className="text-xs font-normal ml-1" style={{ color: 'var(--txt-muted)' }}>{confirmed ? 'pts' : 'pts so far'}</span>
                      </p>
                    ) : (
                      <p className="text-sm font-semibold mt-1.5" style={{ color: made ? 'var(--green)' : locked ? 'var(--txt-muted)' : 'var(--amber)' }}>
                        {made ? 'Picked' : locked ? 'Missed' : 'Not picked yet'}
                      </p>
                    )}
                    <p className="text-[11px] mt-1" style={{ color: 'var(--txt-muted)' }}>
                      {locked ? `${sc ? `${sc.correct} exactly right` : 'Locked'}` : `Locks ${format(lockTime(race, s), 'EEE HH:mm')}`}
                    </p>
                  </Card>
                </Link>
              )
            })}
          </div>

          {/* The live order, with your pick for each place beside it */}
          {(race.live_session || F1_SESSIONS.some(x => !race[confirmedField(x.key)] && results[x.key].length)) && (
            <LiveCard race={race} results={results} picks={picks} byId={byId} />
          )}
        </>}

        {/* Your season */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <StatCard label="Your rank" value={me ? `#${me.rank}` : '—'} sub={`of ${table.length} player${table.length === 1 ? '' : 's'}`} />
          <StatCard label="Total points" value={me?.points ?? 0} sub="this season" />
          <StatCard label="Grid points" value={me?.grid ?? 0} sub={`${me?.gridCorrect ?? 0} exactly right`} />
          <StatCard label="Race points" value={(me?.race ?? 0) + (me?.sprint ?? 0)} sub={me?.sprint ? `incl. ${me.sprint} from sprints` : `${me?.raceCorrect ?? 0} exactly right`} />
        </div>

        {/* Top of the table */}
        {table.length > 0 && (
          <Card className="mb-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <SectionLabel>Table</SectionLabel>
              <Link to="/standings" className="text-xs" style={{ color: 'var(--accent)' }}>Full table</Link>
            </div>
            {table.slice(0, 3).concat(me && me.rank > 3 ? [me] : []).map(r => {
              const mine = r.user_id === user?.id
              return (
                <div key={r.user_id} className="flex items-center px-4 py-2 text-sm"
                  style={{ borderTop: '0.5px solid var(--border)', background: mine ? 'var(--accent-dim)' : 'transparent' }}>
                  <span className="font-semibold" style={{ width: 28, color: r.rank <= 3 ? 'var(--gold, var(--amber))' : 'var(--txt-muted)' }}>{r.rank}</span>
                  <span className="flex-1 truncate" style={{ color: mine ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: mine ? 700 : 500 }}>{r.name}{mine && ' (you)'}</span>
                  <span className="font-bold" style={{ color: 'var(--txt-primary)' }}>{r.points}</span>
                </div>
              )
            })}
          </Card>
        )}

        {/* Last race */}
        {last && (
          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between">
              <SectionLabel>Last race</SectionLabel>
              <Link to="/standings" className="text-xs" style={{ color: 'var(--accent)' }}>Results</Link>
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>{last.name}</p>
              <p className="text-sm" style={{ color: 'var(--txt-second)' }}>{lastMine != null ? `${lastMine} pts` : 'No picks'}</p>
            </div>
          </Card>
        )}
      </>}
    </div>
  )
}

function LiveCard({ race, results, picks, byId }) {
  // The session running now, else the latest one with an unconfirmed order.
  const session = race.live_session
    || [...F1_SESSIONS].reverse().find(x => results[x.key].length && !race[confirmedField(x.key)])?.key || 'grid'
  const rows = results[session].filter(r => r.position).sort((a, b) => a.position - b.position).slice(0, 10)
  const myAt = new Map(picks[session].map(p => [p.position, p.driver_id]))
  return (
    <Card className="mb-3 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <SectionLabel>{F1_SESSIONS.find(x => x.key === session)?.name} {race.live_session ? 'live' : 'provisional'}</SectionLabel>
        {(session === 'race' || session === 'sprint') && race.live_session === session && race.live_lap && (
          <span className="text-xs font-semibold" style={{ color: 'var(--red)' }}>● Lap {race.live_lap}{race.total_laps ? `/${race.total_laps}` : ''}</span>
        )}
      </div>
      {rows.map(r => {
        const d = byId.get(r.driver_id)
        const hit = myAt.get(r.position) === r.driver_id
        return (
          <div key={r.id} className="flex items-center gap-2 px-4 py-1.5 text-xs"
            style={{ borderTop: '0.5px solid var(--border)', background: hit ? 'var(--green-dim)' : 'transparent' }}>
            <span className="font-semibold" style={{ width: 20, color: 'var(--txt-muted)' }}>{r.position}</span>
            <span style={{ width: 3, height: 14, background: teamColour(d?.team?.name) }} />
            <span className="flex-1 truncate font-medium" style={{ color: 'var(--txt-primary)' }}>{d?.name || 'Driver'}</span>
            <span style={{ color: 'var(--txt-muted)' }}>{r.gap || ''}</span>
            {hit && <i className="ti ti-check" style={{ color: 'var(--green)' }} aria-label="Your pick" />}
          </div>
        )
      })}
    </Card>
  )
}
