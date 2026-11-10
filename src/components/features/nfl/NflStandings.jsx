import { useState, useEffect } from 'react'
import { loadNflTable, withRanks } from '../../../lib/sports/nfl/table'
import SeasonResults from '../season/SeasonResults'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { sortGameweeks, latestGameweek } from '../../../lib/gameweeks'
import { nflPointRules, marginScore, bandStyle, MARGIN_BANDS } from '../../../lib/sports/nfl/scoring'
import { nflTeam } from '../../../lib/sports/nfl/teams'
import CompetitionSelector from '../../layout/CompetitionSelector'
import { Card, Select, Spinner, EmptyState } from '../../ui'

/**
 * NFL Standings. Separate from football's: two views, the season table and a
 * week's results.
 *
 * The page never scrolls sideways. The season table is wider than a phone, so
 * it scrolls inside its own card with the rank and name pinned.
 *
 * No monthly tables and no Triple Points in NFL (Lloyd, 10 Nov 2026): the
 * season table, and who scored the most each week.
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
// A column for each way of scoring, so anyone can see where a total came from
// (Lloyd, 10 Nov 2026), with a key above it saying what each is worth in THIS
// league. The counts come from the finished weeks; Pts is the official total.
//
// Wider than a phone, so the table scrolls sideways INSIDE its card with the
// rank and name pinned on the left. The page itself never scrolls sideways.
const COLS = [
  { key: 'winners',    head: 'CW', name: 'Correct winner',          pts: r => r.winner_only_points },
  { key: 'teamScores', head: 'TS', name: 'Team score, each', pts: r => r.team_score_points },
  ...MARGIN_BANDS.map(b => ({
    band: b.band,
    head: b.band === 'exact_margin' ? 'EM' : `≤${b.max}`,
    name: b.band === 'exact_margin' ? 'Exact margin' : `Margin within ${b.max}`,
    pts: r => r[b.key],
  })),
  { key: 'fullHouses', head: 'FH', name: 'Full house', pts: r => [r.full_house_results_bonus, r.full_house_scores_bonus] },
  { key: 'weeksWon',   head: 'WW', name: 'Weeks won', pts: null },
]

function TableKey({ rules, hasSeason }) {
  const n = v => Number(v) || 0
  return (
    <div className="mb-3 p-3 rounded-md text-xs grid gap-x-4 gap-y-1"
      style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)', color: 'var(--txt-second)', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))' }}>
      {COLS.map(c => {
        const p = c.pts ? c.pts(rules) : null
        const val = p == null ? null : Array.isArray(p) ? `+${n(p[0])} / +${n(p[1])}` : n(p)
        return (
          <span key={c.head} className="flex items-baseline gap-1.5 whitespace-nowrap">
            <strong style={{ color: 'var(--txt-primary)', minWidth: 30 }}>{c.head}</strong>
            <span className="truncate">{c.name}</span>
            {val != null && <strong className="ml-auto" style={{ color: 'var(--accent-txt, var(--accent))' }}>{val}</strong>}
          </span>
        )
      })}
      {hasSeason && (
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <strong style={{ color: 'var(--txt-primary)', minWidth: 30 }}>S</strong><span className="truncate">Season questions</span>
        </span>
      )}
      <span style={{ gridColumn: '1 / -1', color: 'var(--txt-muted)' }} className="mt-1">
        Full house is a bonus once a week: +{n(rules.full_house_results_bonus)} for every winner correct, +{n(rules.full_house_scores_bonus)} for every score exact.
        A wrong winner scores 0. Your league admin sets all these points.
      </span>
    </div>
  )
}

function SeasonTable({ competitionId, userId }) {
  const [rows, setRows] = useState(null)

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

  const ranked = withRanks(rows.list)
  const cell = { padding: '9px 6px', textAlign: 'center', whiteSpace: 'nowrap' }
  const pinned = (bg, left, width) => ({ position: 'sticky', left, zIndex: 1, minWidth: width, maxWidth: width, backgroundColor: 'var(--bg-surface)', backgroundImage: bg ? `linear-gradient(${bg}, ${bg})` : 'none' })

  return (
    <div>
      <TableKey rules={rows.rules} hasSeason={rows.hasSeason} />
      <Card className="overflow-hidden" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className="text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ color: 'var(--txt-muted)' }}>
                <th style={{ ...cell, ...pinned(null, 0, 30), textAlign: 'left', paddingLeft: 12, borderBottom: '0.5px solid var(--border)' }}>#</th>
                <th style={{ ...cell, ...pinned(null, 30, 112), textAlign: 'left', borderBottom: '0.5px solid var(--border)' }}>Player</th>
                {COLS.map(c => <th key={c.head} title={c.name} style={{ ...cell, fontWeight: 600, borderBottom: '0.5px solid var(--border)' }}>{c.head}</th>)}
                {rows.hasSeason && <th title="Season question points" style={{ ...cell, fontWeight: 600, borderBottom: '0.5px solid var(--border)' }}>S</th>}
                <th style={{ ...cell, paddingRight: 12, fontWeight: 700, color: 'var(--txt-primary)', borderBottom: '0.5px solid var(--border)' }}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const isMe = r.user_id === userId
                const bg = isMe ? 'var(--accent-dim)' : null
                const line = i < ranked.length - 1 ? '0.5px solid var(--border)' : 'none'
                const val = c => c.band ? r.bands[c.band] : r[c.key]
                return (
                  <tr key={r.user_id} style={{ backgroundColor: bg || 'transparent' }}>
                    <td style={{ ...cell, ...pinned(bg, 0, 30), textAlign: 'left', paddingLeft: 12, fontWeight: 600, color: r.rank <= 3 ? 'var(--gold, var(--amber))' : 'var(--txt-muted)', borderBottom: line }}>{r.rank}</td>
                    <td style={{ ...cell, ...pinned(bg, 30, 112), textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', color: isMe ? 'var(--accent-txt, var(--accent))' : 'var(--txt-primary)', fontWeight: isMe ? 700 : 500, fontSize: 13, borderBottom: line }}>
                      {r.name}
                    </td>
                    {COLS.map(c => (
                      <td key={c.head} style={{ ...cell, color: val(c) ? 'var(--txt-second)' : 'var(--txt-muted)', borderBottom: line }}>{val(c) || '–'}</td>
                    ))}
                    {rows.hasSeason && <td style={{ ...cell, color: r.season > 0 ? 'var(--gold)' : 'var(--txt-muted)', borderBottom: line }}>{r.season > 0 ? r.season : '–'}</td>}
                    <td style={{ ...cell, paddingRight: 12, fontWeight: 700, fontSize: 14, color: 'var(--txt-primary)', borderBottom: line }}>{r.points}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>
        Counts are from finished weeks.<span className="sm:hidden"> Swipe the table sideways to see every column.</span>
      </p>
    </div>
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
      const [rules, { data: fixtures }, { data: preds }, { data: parts }, { data: official }] = await Promise.all([
        nflPointRules(supabase, competitionId),
        supabase.from('fixtures').select('*').eq('gameweek_id', weekId).order('kickoff_time'),
        supabase.from('predictions').select('*').eq('gameweek_id', weekId),
        supabase.from('participants').select('user_id').eq('competition_id', competitionId),
        supabase.from('gameweek_scores').select('*').eq('competition_id', competitionId).eq('gameweek_id', weekId),
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
      // Once the week is marked completed its stored score is the official one:
      // it includes any full house bonus.
      for (const s of (official || [])) {
        if (!players[s.user_id]) continue
        players[s.user_id].points = s.points || 0
        players[s.user_id].fullHouse = !!(s.full_house_results || s.full_house_scores)
      }
      const list = Object.values(players).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      const week = weeks.find(g => g.id === weekId)
      const done = week?.status === 'completed'
      const top = list[0]?.points || 0
      if (!cancelled) setData({ list, fixtures: (fixtures || []).filter(f => f.status !== 'void'), finalCount: final.length, done, top })
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
            {data.done && data.top > 0 && <> Week winner: <strong style={{ color: 'var(--gold)' }}>{data.list.filter(p => p.points === data.top).map(p => p.name).join(', ')}</strong> with {data.top}.</>}
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
                    <span className="flex-1 min-w-0 flex items-center text-sm" style={{ color: isMe ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: isMe ? 700 : 500 }}>
                      {data.top > 0 && p.points === data.top && <i className="ti ti-trophy text-xs mr-1 shrink-0" style={{ color: 'var(--gold)' }} aria-label={data.done ? 'Week winner' : 'Leading'} />}
                      <span className="truncate">{p.name}{isMe && ' (you)'}</span>
                      {p.fullHouse && <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap" style={{ background: 'var(--gold-dim)', color: 'var(--gold)', fontWeight: 600 }}>FH</span>}
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
