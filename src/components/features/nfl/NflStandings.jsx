import { useState, useEffect } from 'react'
import { loadNflTable } from '../../../lib/sports/nfl/table'
import SeasonResults from '../season/SeasonResults'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { sortGameweeks, latestGameweek } from '../../../lib/gameweeks'
import { nflPointRules, marginScore, bandStyle } from '../../../lib/sports/nfl/scoring'
import { nflTeam } from '../../../lib/sports/nfl/teams'
import CompetitionSelector from '../../layout/CompetitionSelector'
import { Card, Select, Spinner, EmptyState } from '../../ui'

/**
 * NFL Standings. Separate from football's: two views, the season table and a
 * week's results.
 *
 * Phones get no sideways scrolling, the same rule football's table follows:
 * each row is rank, name and points, and a tap opens the detail.
 */
export default function NflStandings() {
  const { user } = useAuth()
  const { competitions, loading } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [view, setView] = useState('table')
  // The Season tab appears once season questions have been scored, the same
  // as football: an empty tab before then looks broken.
  const [hasSeason, setHasSeason] = useState(false)
  useEffect(() => {
    if (!comp) { setHasSeason(false); return }
    let cancelled = false
    supabase.from('season_scores').select('id', { count: 'exact', head: true }).eq('competition_id', comp)
      .then(({ count }) => { if (!cancelled) setHasSeason((count ?? 0) > 0) })
    return () => { cancelled = true }
  }, [comp])
  useEffect(() => { if (view === 'season' && !hasSeason) setView('table') }, [view, hasSeason])

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  if (!competitions.length) return (
    <EmptyState icon="ti-list-numbers" title="No NFL competitions yet"
      description="Join one with a code, or ask your admin to add you" />
  )

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp} />
      <div className="flex gap-4 mb-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
        {[['table', 'Table'], ['week', 'Week results'], ...(hasSeason ? [['season', 'Season']] : [])].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className="text-sm pb-2"
            style={{ color: view === k ? 'var(--accent)' : 'var(--txt-muted)', fontWeight: view === k ? 600 : 400, borderBottom: view === k ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>
      {comp && view === 'table' && <SeasonTable competitionId={comp} userId={user?.id} />}
      {comp && view === 'week' && <WeekResults competitionId={comp} userId={user?.id} />}
      {comp && view === 'season' && <SeasonResults competitionId={comp} userId={user?.id} />}
    </div>
  )
}

// ── The season table ────────────────────────────────────────────────────────
// Built from gameweek_scores, which NFL scoring writes when a week is marked
// completed. Ties on points split on exact scores, then on right winners.
function SeasonTable({ competitionId, userId }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    ;(async () => {
      const table = await loadNflTable(supabase, competitionId)
      if (!cancelled) setRows(table)
    })()
    return () => { cancelled = true }
  }, [competitionId])

  if (!rows) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  if (!rows.list.length) return (
    <EmptyState icon="ti-list-numbers" title="No scores yet"
      description="The table fills in once the first week is marked completed" />
  )

  let rank = 0, prev = null
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center px-3 py-2 text-xs" style={{ color: 'var(--txt-muted)', borderBottom: '0.5px solid var(--border)' }}>
        <span style={{ width: 28 }}>#</span>
        <span className="flex-1">Player</span>
        {rows.latestLabel && <span style={{ width: 56, textAlign: 'right' }}>{rows.latestLabel}</span>}
        {rows.hasSeason && <span style={{ width: 52, textAlign: 'right' }}>Season</span>}
        <span style={{ width: 52, textAlign: 'right' }}>Pts</span>
      </div>
      {rows.list.map((r, i) => {
        if (prev === null || r.points !== prev) rank = i + 1
        prev = r.points
        const isMe = r.user_id === userId
        const isOpen = open === r.user_id
        return (
          <div key={r.user_id} style={{ borderBottom: i < rows.list.length - 1 ? '0.5px solid var(--border)' : '' }}>
            <button onClick={() => setOpen(isOpen ? null : r.user_id)}
              className="flex items-center px-3 py-2.5 w-full text-left"
              style={{ background: isMe ? 'var(--accent-dim)' : 'transparent' }}>
              <span className="text-sm font-semibold" style={{ width: 28, color: rank <= 3 ? 'var(--gold, var(--amber))' : 'var(--txt-muted)' }}>{rank}</span>
              <span className="flex-1 text-sm truncate" style={{ color: isMe ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: isMe ? 700 : 500 }}>
                {r.name}{isMe && ' (you)'}
              </span>
              {rows.latestLabel && <span className="text-xs" style={{ width: 56, textAlign: 'right', color: 'var(--txt-second)' }}>{r.lastWeek ?? '—'}</span>}
              {rows.hasSeason && <span className="text-xs" style={{ width: 52, textAlign: 'right', color: r.season > 0 ? 'var(--gold)' : 'var(--txt-muted)' }}>{r.season > 0 ? `+${r.season}` : '–'}</span>}
              <span className="text-sm font-bold" style={{ width: 52, textAlign: 'right', color: 'var(--txt-primary)' }}>{r.points}</span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-4 gap-2 px-3 pb-3 text-center">
                {[['Weeks', r.weeks], ['Best week', r.best], ['Exact scores', r.exact], ['Right winners', r.winners]].map(([l, v]) => (
                  <div key={l} className="rounded-md py-1.5" style={{ background: 'var(--bg-elevated)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>{v}</p>
                    <p className="text-[10px]" style={{ color: 'var(--txt-muted)' }}>{l}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}

// ── A week's results ────────────────────────────────────────────────────────
// Every player's week, worked out from the confirmed final scores — so a week
// in progress shows the games already finished, not zero until it is closed.
// Tap a player to see each pick and the band it landed in.
function WeekResults({ competitionId, userId }) {
  const [weeks, setWeeks] = useState([])
  const [weekId, setWeekId] = useState(null)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    ;(async () => {
      const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', competitionId)
      const ids = (links || []).map(l => l.gameweek_id)
      const { data: raw } = ids.length
        ? await supabase.from('gameweeks').select('*').in('id', ids).in('status', ['active', 'completed'])
        : { data: [] }
      const sorted = sortGameweeks(raw)
      setWeeks(sorted)
      setWeekId((sorted.find(g => g.status === 'active') || latestGameweek(sorted))?.id || null)
    })()
  }, [competitionId])

  useEffect(() => {
    if (!weekId) { setData(null); return }
    let cancelled = false
    setData(null)
    ;(async () => {
      const [rules, { data: fixtures }, { data: preds }, { data: parts }] = await Promise.all([
        nflPointRules(supabase, competitionId),
        supabase.from('fixtures').select('*').eq('gameweek_id', weekId).order('kickoff_time'),
        supabase.from('predictions').select('*').eq('gameweek_id', weekId),
        supabase.from('participants').select('user_id').eq('competition_id', competitionId),
      ])
      const memberIds = (parts || []).map(p => p.user_id)
      const { data: profs } = memberIds.length
        ? await supabase.from('profiles').select('id, display_name').in('id', memberIds)
        : { data: [] }
      const names = {}; (profs || []).forEach(p => { names[p.id] = p.display_name })

      const final = (fixtures || []).filter(f => f.status !== 'void' && f.home_score != null && f.away_score != null)
      const fxById = {}; (fixtures || []).forEach(f => { fxById[f.id] = f })
      const members = new Set(memberIds)

      const players = {}
      memberIds.forEach(id => { players[id] = { user_id: id, name: names[id] || 'Player', points: 0, picks: {} } })
      for (const p of (preds || [])) {
        if (!members.has(p.user_id)) continue
        const fx = fxById[p.fixture_id]; if (!fx) continue
        const done = final.includes(fx)
        const scored = done ? marginScore(p, fx, rules) : null
        players[p.user_id].picks[fx.id] = { pred: p, scored }
        if (scored) players[p.user_id].points += scored.points
      }
      const list = Object.values(players).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      if (!cancelled) setData({ list, fixtures: (fixtures || []).filter(f => f.status !== 'void'), finalCount: final.length })
    })()
    return () => { cancelled = true }
  }, [weekId, competitionId])

  if (!weeks.length) return <EmptyState icon="ti-calendar-off" title="No weeks played yet" />

  return (
    <div>
      <Select value={weekId || ''} onChange={e => { setWeekId(e.target.value); setOpen(null) }} style={{ width: '100%', maxWidth: 220 }} className="mb-3">
        {weeks.map(g => <option key={g.id} value={g.id}>{g.number}{g.status === 'active' ? ' (current)' : ''}</option>)}
      </Select>

      {!data ? <div className="flex justify-center py-20"><Spinner size="lg" /></div> : (
        <>
          <p className="text-xs mb-2" style={{ color: 'var(--txt-muted)' }}>
            {data.finalCount} of {data.fixtures.length} games final. Points count final scores only, overtime included.
          </p>
          <Card className="overflow-hidden">
            {data.list.map((p, i) => {
              const isMe = p.user_id === userId
              const isOpen = open === p.user_id
              return (
                <div key={p.user_id} style={{ borderBottom: i < data.list.length - 1 ? '0.5px solid var(--border)' : '' }}>
                  <button onClick={() => setOpen(isOpen ? null : p.user_id)}
                    className="flex items-center px-3 py-2.5 w-full text-left gap-2"
                    style={{ background: isMe ? 'var(--accent-dim)' : 'transparent' }}>
                    <span className="flex-1 text-sm truncate" style={{ color: isMe ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: isMe ? 700 : 500 }}>
                      {p.name}{isMe && ' (you)'}
                    </span>
                    <BandDots fixtures={data.fixtures} picks={p.picks} />
                    <span className="text-sm font-bold" style={{ width: 40, textAlign: 'right', color: 'var(--txt-primary)' }}>{p.points}</span>
                    <i className={`ti ti-chevron-${isOpen ? 'up' : 'down'} text-xs`} style={{ color: 'var(--txt-muted)' }} aria-hidden="true" />
                  </button>
                  {isOpen && <PlayerWeek fixtures={data.fixtures} picks={p.picks} />}
                </div>
              )
            })}
          </Card>
        </>
      )}
    </div>
  )
}

// A dot per finished game in the band's colour: the week at a glance.
function BandDots({ fixtures, picks }) {
  const done = fixtures.filter(f => f.home_score != null)
  if (!done.length) return null
  return (
    <span className="flex gap-0.5 flex-wrap justify-end" style={{ maxWidth: 110 }} aria-hidden="true">
      {done.map(f => {
        const s = picks[f.id]?.scored
        const st = s ? bandStyle(s.band) : { color: 'var(--border-med)' }
        return <span key={f.id} style={{ width: 6, height: 6, borderRadius: 3, background: s && s.points > 0 ? st.color : 'var(--border-med)' }} />
      })}
    </span>
  )
}

// One player's picks for the week, game by game.
function PlayerWeek({ fixtures, picks }) {
  return (
    <div className="px-3 pb-3">
      {fixtures.map(f => {
        const pick = picks[f.id]
        const away = nflTeam(f.away_team), home = nflTeam(f.home_team)
        const s = pick?.scored
        const st = s ? bandStyle(s.band) : null
        return (
          <div key={f.id} className="flex items-center gap-2 py-1.5 text-xs" style={{ borderTop: '0.5px solid var(--border)' }}>
            <span className="font-semibold" style={{ width: 74, color: 'var(--txt-second)' }}>{away.abbr} @ {home.abbr}</span>
            <span style={{ width: 52, color: 'var(--txt-muted)' }}>
              {f.home_score != null ? `${f.away_score}–${f.home_score}` : '—'}
            </span>
            <span className="flex-1" style={{ color: 'var(--txt-primary)' }}>
              {pick ? `${pick.pred.predicted_away}–${pick.pred.predicted_home}` : 'No pick'}
            </span>
            {s && (
              <span className="font-medium px-2 py-0.5 rounded" style={{ background: st.bg, color: st.color }}>
                {(s.label || 'Miss')} · {s.points}
              </span>
            )}
          </div>
        )
      })}
      <p className="text-[10px] mt-1" style={{ color: 'var(--txt-muted)' }}>Scores shown away–home.</p>
    </div>
  )
}
