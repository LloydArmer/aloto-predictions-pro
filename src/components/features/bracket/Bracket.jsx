import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { scoreOnePrediction } from '../../../lib/scoring'
import { Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'

const ROUND_LABELS = { playoff:'Playoff', r64:'Round of 64', r32:'Round of 32', r16:'Round of 16', qf:'Quarter-finals', sf:'Semi-finals', f:'Final' }

function MatchCard({ match, userId }) {
  const isCompleted = match.status === 'completed'
  const isReplayScheduled = match.status === 'replay_scheduled'
  const rows = [
    { name: match.home?.display_name, uid: match.home_user_id, pts: match.home_points },
    { name: match.away_user_id ? match.away?.display_name : null, uid: match.away_user_id, pts: match.away_points },
  ]
  return (
    <div className="rounded-md overflow-hidden mb-2" style={{ border: '0.5px solid var(--border-med)', background: 'var(--bg-surface)' }}>
      {match.is_replay && (
        <div className="px-3 pt-2"><span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>Replay</span></div>
      )}
      {rows.map((r, i) => !r.uid && i === 1
        ? <div key={i} className="flex items-center px-3 py-2.5" style={{ opacity: 0.4 }}><span className="text-xs" style={{ color: 'var(--txt-muted)' }}>Bye</span></div>
        : <div key={i} className="flex items-center justify-between px-3 py-2.5 gap-2"
            style={{ borderBottom: i === 0 ? '0.5px solid var(--border)' : '', background: isCompleted && match.winner_user_id === r.uid ? 'var(--accent-dim)' : r.uid === userId ? 'rgba(79,142,247,0.06)' : '' }}>
            <span className="text-sm" style={{ color: 'var(--txt-primary)', fontWeight: match.winner_user_id === r.uid ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {r.name || 'TBD'}{r.uid === userId && <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--accent)' }}>(you)</span>}
            </span>
            <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
              {r.pts != null && <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>{r.pts} pts</span>}
              {match.winner_user_id === r.uid && <i className="ti ti-star text-xs" style={{ color: 'var(--gold)' }} />}
            </div>
          </div>
      )}
      {isReplayScheduled && (
        <div className="px-3 py-2" style={{ background: 'var(--amber-dim)' }}>
          <span className="text-xs" style={{ color: 'var(--amber)' }}>Drawn — a replay has been scheduled</span>
        </div>
      )}
    </div>
  )
}

function GroupTable({ competitionId, userId }) {
  const [standings, setStandings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!competitionId) { setLoading(false); return }
    supabase.from('group_standings').select('*, profiles(display_name)').eq('competition_id', competitionId)
      .then(({ data }) => {
        const sorted = [...(data || [])].sort((a,b) => b.league_points - a.league_points || b.points_diff - a.points_diff || b.points_for - a.points_for)
        setStandings(sorted); setLoading(false)
      })
  }, [competitionId])

  if (loading) return <div className="flex justify-center py-6"><Spinner /></div>
  if (!standings.length) return null

  return (
    <Card className="overflow-hidden p-0 mb-5">
      <p className="text-sm font-semibold p-4 pb-3" style={{ color: 'var(--txt-primary)' }}>Group table</p>
      <div className="overflow-x-auto">
        <table className="data-table w-full" style={{ minWidth: 420 }}>
          <thead><tr>
            <th style={{ paddingLeft: 14 }}>Participant</th>
            <th style={{ textAlign: 'right' }}>P</th>
            <th style={{ textAlign: 'right' }}>PF</th>
            <th style={{ textAlign: 'right' }}>PA</th>
            <th style={{ textAlign: 'right' }}>Diff</th>
            <th style={{ textAlign: 'right', paddingRight: 14 }}>Pts</th>
          </tr></thead>
          <tbody>
            {standings.map((s,i) => (
              <tr key={s.user_id} className={s.user_id === userId ? 'highlight' : ''}>
                <td style={{ paddingLeft: 14 }}>
                  <span className="text-sm" style={{ color: 'var(--txt-primary)' }}>
                    {i+1}. {s.profiles?.display_name}{s.user_id === userId && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--accent)' }}>(you)</span>}
                  </span>
                </td>
                <td className="text-xs text-right" style={{ color: 'var(--txt-second)' }}>{s.played}</td>
                <td className="text-xs text-right" style={{ color: 'var(--txt-second)' }}>{s.points_for}</td>
                <td className="text-xs text-right" style={{ color: 'var(--txt-second)' }}>{s.points_against}</td>
                <td className="text-xs text-right" style={{ color: s.points_diff >= 0 ? 'var(--green)' : 'var(--red)' }}>{s.points_diff > 0 ? '+' : ''}{s.points_diff}</td>
                <td style={{ textAlign: 'right', paddingRight: 14 }}><span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>{s.league_points}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function GroupFixturesList({ competitionId, userId }) {
  const [fixtures, setFixtures] = useState([])
  const [loading, setLoading] = useState(true)
  const [openRound, setOpenRound] = useState(null)
  const [livePoints, setLivePoints] = useState({}) // { [gameweekId]: { [userId]: pointsSoFar } }

  useEffect(() => {
    if (!competitionId) { setLoading(false); return }
    load()
  }, [competitionId])

  async function load() {
    const [{ data: fx }, { data: rules }] = await Promise.all([
      supabase.from('group_fixtures').select('*, home:home_user_id(display_name), away:away_user_id(display_name), gameweeks(number)')
        .eq('competition_id', competitionId).order('round_number'),
      supabase.from('point_rules').select('*').eq('competition_id', competitionId).maybeSingle(),
    ])
    setFixtures(fx || [])
    setLoading(false)

    // Live "points so far" for any unresolved fixture — a running total
    // from whichever real fixtures in that gameweek already have a
    // result, purely for display. The official group result still only
    // locks in once the whole gameweek is marked completed.
    const liveGwIds = [...new Set((fx || []).filter(f => f.status !== 'completed' && f.gameweek_id).map(f => f.gameweek_id))]
    if (liveGwIds.length && rules) {
      const cache = {}
      for (const gwId of liveGwIds) {
        const [{ data: gwFixtures }, { data: preds }] = await Promise.all([
          supabase.from('fixtures').select('*').eq('gameweek_id', gwId).eq('status', 'completed'),
          supabase.from('predictions').select('*').eq('gameweek_id', gwId),
        ])
        const fxMap = {}; (gwFixtures || []).forEach(f => { fxMap[f.id] = f })
        const totals = {}
        for (const pred of (preds || [])) {
          const realFx = fxMap[pred.fixture_id]; if (!realFx) continue
          const { points } = scoreOnePrediction(pred, realFx, rules)
          totals[pred.user_id] = (totals[pred.user_id] || 0) + points
        }
        cache[gwId] = totals
      }
      setLivePoints(cache)
    }
  }

  if (loading) return <div className="flex justify-center py-6"><Spinner /></div>
  if (!fixtures.length) return null

  const rounds = [...new Set(fixtures.map(f => f.round_number))].sort((a,b) => a-b)

  return (
    <Card className="p-4 mb-5">
      <SectionLabel className="mb-3">Group fixtures</SectionLabel>
      {rounds.map(rn => {
        const roundFixtures = fixtures.filter(f => f.round_number === rn)
        return (
          <div key={rn} className="mb-1">
            <button onClick={() => setOpenRound(openRound === rn ? null : rn)} className="text-xs flex items-center gap-1 py-1.5" style={{ color: 'var(--accent)' }}>
              <i className={`ti ti-chevron-${openRound === rn ? 'up' : 'down'} text-xs`} aria-hidden="true"/>
              Round {rn}{roundFixtures[0]?.gameweeks?.number && ` — ${roundFixtures[0].gameweeks.number}`}
            </button>
            {openRound === rn && roundFixtures.map(fx => {
              const isMe = fx.home_user_id === userId || fx.away_user_id === userId
              const live = fx.gameweek_id && livePoints[fx.gameweek_id]
              return (
                <div key={fx.id} className="flex items-center justify-between py-2.5 pl-4 border-b last:border-0 gap-3" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm" style={{ color: 'var(--txt-primary)', fontWeight: isMe ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fx.home?.display_name}{fx.status !== 'completed' && live && <span className="text-xs" style={{ color: 'var(--txt-muted)' }}> ({live[fx.home_user_id]||0}pts so far)</span>}
                    {' vs '}
                    {fx.away?.display_name}{fx.status !== 'completed' && live && <span className="text-xs" style={{ color: 'var(--txt-muted)' }}> ({live[fx.away_user_id]||0}pts so far)</span>}
                  </span>
                  <span className="text-sm font-bold" style={{ color: fx.status === 'completed' ? 'var(--green)' : 'var(--txt-muted)', minWidth: 66, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {fx.status === 'completed' ? `${fx.home_points} – ${fx.away_points}` : (fx.gameweeks?.number || 'GW not set')}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </Card>
  )
}

export default function Bracket() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (comp) load(); else setLoading(false) }, [comp])

  async function load() {
    setLoading(true)
    try {
      const { data: matches } = await supabase.from('bracket_matches')
        .select('*, home:home_user_id(display_name), away:away_user_id(display_name), winner:winner_user_id(display_name)')
        .eq('competition_id', comp).order('round_order')
      const rm = {}; (matches || []).forEach(m => { if (!rm[m.round]) rm[m.round] = []; rm[m.round].push(m) })
      setRounds(Object.entries(rm).map(([round, ms]) => ({ round, matches: ms })))
    } finally { setLoading(false) }
  }

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp} excludeFormats={['league']} />
      <GroupTable competitionId={comp} userId={user?.id} />
      <GroupFixturesList competitionId={comp} userId={user?.id} />
      {loading ? <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        : rounds.length === 0 ? <EmptyState icon="ti-tournament" title="No cup competition yet" description="The admin will set up the knockout draw when the cup stage begins" />
        : <>
          <div className="mb-4 p-3 rounded-md text-xs" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}>
            <span style={{ color: 'var(--txt-second)' }}>Matchups are decided automatically by prediction points earned in the gameweek(s) assigned to each round — no separate prediction needed here.</span>
          </div>
          {rounds.map(({ round, matches }) => (
            <div key={round} className="mb-5">
              <SectionLabel className="mb-2">{ROUND_LABELS[round] || round}</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {matches.map(m => <MatchCard key={m.id} match={m} userId={user?.id} />)}
              </div>
            </div>
          ))}
        </>
      }
    </div>
  )
}
