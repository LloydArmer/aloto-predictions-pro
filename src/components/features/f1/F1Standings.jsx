import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { loadF1Table, loadF1Races, loadF1Drivers } from '../../../lib/sports/f1/data'
import { surname, teamColour } from '../../../lib/sports/f1/teams'
import CompetitionSelector from '../../layout/CompetitionSelector'
import { Card, Select, Spinner, EmptyState } from '../../ui'

/**
 * F1 Standings: the league table (grid, race and season points), each race's
 * scores, and the real championship the season predictions are settled on.
 */
export default function F1Standings() {
  const { user } = useAuth()
  const { competitions, loading } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [view, setView] = useState('table')

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  if (!competitions.length) return <EmptyState icon="ti-list-numbers" title="No F1 leagues yet" description="Join one with a code, or ask your admin to add you" />

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp} />
      <div className="flex gap-4 mb-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
        {[['table', 'Table'], ['race', 'Race results'], ['champ', 'Championship']].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className="text-sm pb-2"
            style={{ color: view === k ? 'var(--accent)' : 'var(--txt-muted)', fontWeight: view === k ? 600 : 400, borderBottom: view === k ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>
      {comp && view === 'table' && <LeagueTable competitionId={comp} userId={user?.id} />}
      {comp && view === 'race' && <RaceResults competitionId={comp} userId={user?.id} />}
      {comp && view === 'champ' && <Championship competitionId={comp} />}
    </div>
  )
}

function LeagueTable({ competitionId, userId }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { setRows(null); loadF1Table(supabase, competitionId).then(setRows) }, [competitionId])
  if (!rows) return <div className="flex justify-center py-16"><Spinner /></div>
  if (!rows.length) return <EmptyState icon="ti-users" title="No players yet" description="" />
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center px-3 py-2 text-[11px] uppercase tracking-wide" style={{ color: 'var(--txt-muted)' }}>
        <span style={{ width: 26 }}>#</span>
        <span className="flex-1">Player</span>
        <span className="text-right" style={{ width: 44 }}>Grid</span>
        <span className="text-right" style={{ width: 44 }}>Race</span>
        <span className="text-right" style={{ width: 46 }}>Sprint</span>
        <span className="text-right" style={{ width: 50 }}>Season</span>
        <span className="text-right" style={{ width: 44 }}>Pts</span>
      </div>
      {rows.map(r => {
        const mine = r.user_id === userId
        return (
          <div key={r.user_id} className="flex items-center px-3 py-2.5 text-sm"
            style={{ borderTop: '0.5px solid var(--border)', background: mine ? 'var(--accent-dim)' : 'transparent' }}>
            <span className="font-semibold" style={{ width: 26, color: r.rank <= 3 ? 'var(--gold, var(--amber))' : 'var(--txt-muted)' }}>{r.rank}</span>
            <span className="flex-1 truncate" style={{ color: mine ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: mine ? 700 : 500 }}>{r.name}</span>
            <span className="text-right text-xs" style={{ width: 44, color: 'var(--txt-second)' }}>{r.grid}</span>
            <span className="text-right text-xs" style={{ width: 44, color: 'var(--txt-second)' }}>{r.race}</span>
            <span className="text-right text-xs" style={{ width: 46, color: 'var(--txt-second)' }}>{r.sprint}</span>
            <span className="text-right text-xs" style={{ width: 50, color: 'var(--txt-second)' }}>{r.season}</span>
            <span className="text-right font-bold" style={{ width: 44, color: 'var(--txt-primary)' }}>{r.points}</span>
          </div>
        )
      })}
      <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--txt-muted)', borderTop: '0.5px solid var(--border)' }}>
        Grid: qualifying and sprint qualifying picks. Race and Sprint: finishing order picks. Season: champion and tables, once scored.
      </p>
    </Card>
  )
}

function RaceResults({ competitionId, userId }) {
  const [races, setRaces] = useState([])
  const [raceId, setRaceId] = useState(null)
  const [rows, setRows] = useState(null)
  const [names, setNames] = useState({})
  const [open, setOpen] = useState(null)
  const [picks, setPicks] = useState({})
  const [drivers, setDrivers] = useState([])

  useEffect(() => {
    loadF1Races(supabase, competitionId).then(list => {
      const done = list.filter(r => r.grid_confirmed || r.race_confirmed || r.sprint_grid_confirmed || r.sprint_confirmed)
      setRaces(done); setRaceId(done[done.length - 1]?.id || null)
      if (!done.length) setRows([])
    })
    supabase.from('participants').select('user_id, profiles:user_id(display_name)').eq('competition_id', competitionId)
      .then(({ data }) => setNames(Object.fromEntries((data || []).map(p => [p.user_id, p.profiles?.display_name || 'Player']))))
  }, [competitionId])

  useEffect(() => {
    if (!raceId) return
    const race = races.find(r => r.id === raceId)
    setRows(null); setOpen(null)
    Promise.all([
      supabase.from('f1_race_scores').select('*').eq('competition_id', competitionId).eq('race_id', raceId),
      supabase.from('f1_picks').select('*').eq('race_id', raceId).order('position'),
      loadF1Drivers(supabase, race.season),
    ]).then(([{ data: sc }, { data: pk }, { drivers: ds }]) => {
      setRows((sc || []).map(s => ({ ...s, total: s.grid_points + s.race_points + (s.sprint_grid_points || 0) + (s.sprint_points || 0) })).sort((a, b) => b.total - a.total))
      const byUser = {}
      ;(pk || []).forEach(p => { ((byUser[p.user_id] ||= { sprint_grid: [], sprint: [], grid: [], race: [] })[p.session]).push(p) })
      setPicks(byUser); setDrivers(ds)
    })
  }, [raceId])

  const dById = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers])

  if (!races.length && rows) return <EmptyState icon="ti-flag" title="No results yet" description="Scores appear here once a race weekend's results are confirmed." />
  return (
    <div>
      <Select value={raceId || ''} onChange={e => setRaceId(e.target.value)} className="mb-3 w-full">
        {races.map(r => <option key={r.id} value={r.id}>{r.round ? `R${r.round} ` : ''}{r.name}</option>)}
      </Select>
      {!rows ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <Card className="overflow-hidden">
          {rows.map((r, i) => {
            const mine = r.user_id === userId
            const pk = picks[r.user_id]
            return (
              <div key={r.user_id} style={{ borderTop: i ? '0.5px solid var(--border)' : 'none' }}>
                <button className="w-full flex items-center px-3 py-2.5 text-sm text-left" onClick={() => setOpen(open === r.user_id ? null : r.user_id)}
                  style={{ background: mine ? 'var(--accent-dim)' : 'transparent' }}>
                  <span className="flex-1 truncate" style={{ color: mine ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: mine ? 700 : 500 }}>{names[r.user_id] || 'Player'}</span>
                  <span className="text-xs mr-3" style={{ color: 'var(--txt-muted)' }}>
                    {(r.sprint_grid_points || r.sprint_points) ? `Sprint ${(r.sprint_grid_points || 0) + (r.sprint_points || 0)} · ` : ''}Grid {r.grid_points} · Race {r.race_points}
                  </span>
                  <span className="font-bold" style={{ color: 'var(--txt-primary)' }}>{r.total}</span>
                </button>
                {open === r.user_id && pk && (
                  <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                    {['grid', 'race'].map(s => (
                      <div key={s}>
                        <p className="text-[11px] uppercase mb-1" style={{ color: 'var(--txt-muted)' }}>{s === 'grid' ? 'Grid pick' : 'Race pick'}</p>
                        {pk[s].slice(0, 10).map(p => {
                          const d = dById.get(p.driver_id)
                          return (
                            <p key={p.position} className="text-xs flex items-center gap-1.5" style={{ color: 'var(--txt-second)' }}>
                              <span style={{ width: 16, color: 'var(--txt-muted)' }}>{p.position}</span>
                              <span style={{ width: 3, height: 10, background: teamColour(d?.team?.name) }} />
                              {surname(d?.name)}
                            </p>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}

function Championship({ competitionId }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    ;(async () => {
      const races = await loadF1Races(supabase, competitionId)
      const season = races[races.length - 1]?.season || new Date().getFullYear()
      const [{ drivers, teams }, { data }] = await Promise.all([
        loadF1Drivers(supabase, season),
        supabase.from('f1_championship').select('*').eq('season', season).order('position'),
      ])
      setState({ season, drivers: new Map(drivers.map(d => [d.id, d])), teams: new Map(teams.map(t => [t.id, t])), rows: data || [] })
    })()
  }, [competitionId])
  if (!state) return <div className="flex justify-center py-16"><Spinner /></div>
  if (!state.rows.length) return <EmptyState icon="ti-trophy" title="No standings yet" description="The championship appears after the first race." />
  return (
    <div className="grid gap-3">
      {[['drivers', 'Drivers'], ['constructors', 'Constructors']].map(([kind, label]) => (
        <Card key={kind} className="overflow-hidden">
          <p className="px-3 pt-3 pb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--txt-muted)' }}>{state.season} {label}</p>
          {state.rows.filter(r => r.kind === kind).map(r => {
            const d = kind === 'drivers' ? state.drivers.get(r.driver_id) : null
            const t = kind === 'drivers' ? d?.team : state.teams.get(r.team_id)
            return (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm" style={{ borderTop: '0.5px solid var(--border)' }}>
                <span className="font-semibold" style={{ width: 22, color: 'var(--txt-muted)' }}>{r.position}</span>
                <span style={{ width: 3, height: 16, background: teamColour(t?.name) }} />
                <span className="flex-1 truncate" style={{ color: 'var(--txt-primary)' }}>{kind === 'drivers' ? d?.name : t?.name}</span>
                <span className="font-semibold" style={{ color: 'var(--txt-primary)' }}>{r.points != null ? Number(r.points) : ''}</span>
              </div>
            )
          })}
        </Card>
      ))}
    </div>
  )
}
