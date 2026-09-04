import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { useFixtures, usePredictions } from '../../../hooks/useFixtures'
import { supabase } from '../../../lib/supabase'
import { resolvePointRules, scoreOnePrediction } from '../../../lib/scoring'
import { Card, Button, Select, Spinner, EmptyState } from '../../ui'
import { FORMAT_MARK } from '../../ui/CompetitionIcon'
import SeasonPredictions from '../season/SeasonPredictions'
import { effectiveScore, isInPlay, isFinished, liveLabel } from '../../../lib/livePoints'
import { fitName } from '../../../lib/names'
import toast from 'react-hot-toast'
import { format, isPast } from 'date-fns'

// Three-tier colouring shared by the fixture cards and the results matrix —
// green for an exact score, amber for a correct result, muted for neither.
function pointsStyle(points, rules) {
  if (!rules) return { bg: 'var(--bg-elevated)', color: 'var(--txt-muted)' }
  if (points >= rules.exact_score_points && rules.exact_score_points > 0) return { bg: 'var(--green-dim)', color: 'var(--green)' }
  if (points >= rules.correct_result_points && rules.correct_result_points > 0) return { bg: 'rgba(245,166,35,0.14)', color: 'var(--amber)' }
  return { bg: 'var(--bg-elevated)', color: 'var(--txt-muted)' }
}

function ScoreInput({ value, onChange, disabled }) {
  // Keep the raw string during editing so the browser never shows a
  // leading zero — only parse to a number when the input is actually
  // submitted (onSave), not on every keystroke.
  return <input type="number" min="0" max="20"
    value={value === '' ? '' : value}
    onChange={e => {
      const raw = e.target.value
      if (raw === '') { onChange(''); return }
      const n = parseInt(raw, 10)
      if (!isNaN(n)) onChange(Math.max(0, Math.min(20, n)))
    }}
    disabled={disabled} className="score-box"
    style={disabled ? { opacity:0.45, cursor:'not-allowed' } : {}}/>
}

function AllPredictions({ fixtureId, fixture, userId, rules }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('predictions').select('predicted_home, predicted_away, points_earned, user_id, profiles(display_name)')
      .eq('fixture_id', fixtureId)
      .then(({ data }) => {
        const sorted = (data || []).sort((a, b) => {
          if (a.user_id === userId) return -1
          if (b.user_id === userId) return 1
          return b.points_earned - a.points_earned
        })
        setRows(sorted); setLoading(false)
      })
  }, [fixtureId])

  function calcPts(pred) {
    if (!fixture || fixture.home_score === null) return pred.points_earned || 0
    const { predicted_home: ph, predicted_away: pa } = pred
    const { home_score: ah, away_score: aa } = fixture
    const isExact = ph === ah && pa === aa
    const getR = (h, a) => h > a ? 'home' : a > h ? 'away' : 'draw'
    const isResult = getR(ph, pa) === getR(ah, aa)
    if (isExact) return (rules?.correct_result_points || 2) + (rules?.exact_score_points || 3)
    if (isResult) return rules?.correct_result_points || 2
    return 0
  }

  if (loading) return <div className="flex justify-center py-4"><Spinner size="sm"/></div>
  if (!rows?.length) return <p className="text-xs py-2" style={{ color:'var(--txt-muted)' }}>No one predicted this fixture.</p>

  return (
    <div className="mt-2 rounded-md overflow-hidden" style={{ border:'0.5px solid var(--border)' }}>
      {rows.map((r, i) => {
        const isMe = r.user_id === userId
        const pts = calcPts(r)
        const ps = pointsStyle(pts, rules)
        return (
          <div key={i} className="flex items-center justify-between px-3 py-2"
            style={{ background: isMe ? 'var(--accent-dim)' : 'transparent', borderBottom: i < rows.length-1 ? '0.5px solid var(--border)' : '' }}>
            <span className="text-xs" style={{ color: isMe ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: isMe ? 700 : 400 }}>
              {r.profiles?.display_name}{isMe && ' (you)'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color:'var(--txt-second)' }}>{r.predicted_home}–{r.predicted_away}</span>
              <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: ps.bg, color: ps.color }}>{pts}pts</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FixtureCard({ fixture, prediction, userId, count, rules, gwLabel, onSave }) {
  const [home, setHome] = useState(prediction?.predicted_home ?? '')
  const [away, setAway] = useState(prediction?.predicted_away ?? '')
  const [saving, setSaving] = useState(false)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { setHome(prediction?.predicted_home ?? ''); setAway(prediction?.predicted_away ?? '') }, [prediction])

  const kickoff  = new Date(fixture.kickoff_time)
  // A voided fixture (postponed, abandoned) is out of the gameweek: locked for
  // editing, scores nobody anything, and not required for full house or Triple
  // Points.
  const isVoid   = fixture.status === 'void'
  const isLocked = isVoid || isPast(kickoff)
  const hasResult = !isVoid && fixture.home_score !== null

  // Live data from the fixture feed, shown only while the admin hasn't
  // confirmed a result. Once they have, hasResult takes over — the admin was
  // watching, and a feed can be behind or simply wrong.
  const inPlay   = !isVoid && !hasResult && isInPlay(fixture)
  const liveDone = !isVoid && !hasResult && isFinished(fixture)
  const live     = (inPlay || liveDone) ? effectiveScore(fixture) : null
  const clock    = liveLabel(fixture)

  // Provisional points from the live score, so a player can see what a goal has
  // just done to them. Never written anywhere — see lib/livePoints.
  const livePts = live && prediction
    ? scoreOnePrediction(
        { predicted_home: prediction.predicted_home, predicted_away: prediction.predicted_away },
        { home_score: live.home, away_score: live.away },
        rules,
      ).points
    : null
  const justSaved = !!prediction
  // Calculate points from actual scores at display time — don't rely on
  // points_earned in the DB which is only written after the GW is fully
  // marked completed and recalculated. This way correct results and exact
  // scores show the right pts label even while the GW is still active.
  const calcPoints = () => {
    if (!hasResult || !prediction) return 0
    const { predicted_home: ph, predicted_away: pa } = prediction
    const { home_score: ah, away_score: aa } = fixture
    const isExact = ph === ah && pa === aa
    const isResult = (ph > pa ? 'home' : pa > ph ? 'away' : 'draw') === (ah > aa ? 'home' : aa > ah ? 'away' : 'draw')
    if (isExact) return (rules?.correct_result_points || 2) + (rules?.exact_score_points || 3)
    if (isResult) return rules?.correct_result_points || 2
    return 0
  }
  const displayPts = calcPoints()
  const ps = hasResult && prediction ? pointsStyle(displayPts, rules) : null

  async function save() {
    if (home === '' || away === '') { toast.error('Enter both scores'); return }
    setSaving(true)
    try { await onSave(fixture.id, Number(home), Number(away)); toast.success('Prediction saved!') }
    catch { toast.error('Could not save prediction') }
    finally { setSaving(false) }
  }

  return (
    <Card className="p-4 mb-3" style={justSaved && !isLocked ? { border: '1px solid var(--green)' } : isVoid ? { opacity: 0.75 } : {}}>
      {isVoid && (
        <div className="mb-2 px-2 py-1 rounded" style={{ background: 'var(--amber-dim)' }}>
          <span className="text-xs" style={{ color: 'var(--amber)' }}>
            Void{fixture.void_reason ? ` — ${fixture.void_reason}` : ''} · scores nothing, and isn't needed for bonuses
          </span>
        </div>
      )}
      <p className="text-base font-semibold" style={{ color:'var(--txt-primary)' }}>
        {fixture.home_team} <span style={{ color:'var(--txt-muted)', fontWeight:400 }}>vs</span> {fixture.away_team}
      </p>
      <p className="text-xs mb-3" style={{ color:'var(--txt-muted)' }}>{gwLabel} · KO: {format(kickoff,'EEE d MMM')} at {format(kickoff,'HH:mm')}</p>

      {/* In play: the live score, a clock, and what it's currently worth.
          Amber and labelled provisional throughout, because a disallowed goal
          can take it away again a second later. */}
      {live && !hasResult && (
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-base font-bold" style={{ color: inPlay ? 'var(--amber)' : 'var(--txt-primary)' }}>
            {live.home}–{live.away}
          </span>

          {clock && (
            <span className="text-xs font-medium px-2 py-1 rounded-md flex items-center gap-1"
              style={{ background: inPlay ? 'var(--amber-dim)' : 'var(--bg-elevated)', color: inPlay ? 'var(--amber)' : 'var(--txt-muted)' }}>
              {inPlay && <span className="live-dot" aria-hidden="true"/>}
              {clock}
            </span>
          )}

          {livePts != null && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-md"
              style={{ background: 'var(--bg-elevated)', color: 'var(--txt-second)' }}>
              {livePts}pts so far
            </span>
          )}

          {liveDone && (
            <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>
              awaiting confirmation
            </span>
          )}
        </div>
      )}

      {hasResult ? (
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-base font-bold" style={{ color:'var(--green)' }}>Result: {fixture.home_score}–{fixture.away_score}</span>
          {prediction && <span className="text-xs font-medium px-2.5 py-1 rounded-md" style={{ background: ps.bg, color: ps.color }}>{displayPts}pts</span>}
          <span className="text-xs font-medium px-2.5 py-1 rounded-md flex items-center gap-1" style={{ background:'rgba(239,68,68,0.14)', color:'var(--red)' }}>
            <i className="ti ti-lock text-xs" aria-hidden="true"/>Locked
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <div className="flex items-center gap-2">
            <ScoreInput value={home} onChange={setHome} disabled={isLocked}/>
            <span style={{ color:'var(--txt-muted)' }} className="font-medium">–</span>
            <ScoreInput value={away} onChange={setAway} disabled={isLocked}/>
          </div>
          {isLocked && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-md flex items-center gap-1" style={{ background:'rgba(239,68,68,0.14)', color:'var(--red)' }}>
              <i className="ti ti-lock text-xs" aria-hidden="true"/>Locked
            </span>
          )}
        </div>
      )}

      {hasResult && (
        <p className="text-sm mb-2" style={{ color:'var(--txt-second)' }}>
          Your prediction: <strong style={{ color:'var(--txt-primary)' }}>{prediction ? `${prediction.predicted_home}–${prediction.predicted_away}` : '—'}</strong>
        </p>
      )}

      {!isLocked && !hasResult && (
        <div className="flex items-center justify-between mt-1 flex-wrap gap-2">
          <p className="text-xs" style={{ color:'var(--txt-muted)' }}>
            {justSaved
              ? <span style={{ color:'var(--green)' }}>Saved {format(new Date(prediction.submitted_at), 'd MMM, HH:mm')} — you can still change this until kickoff</span>
              : `Deadline: ${format(kickoff,'EEE d MMM, HH:mm')} (kickoff)`}
          </p>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            <i className="ti ti-check text-xs"/>{saving ? 'Saving…' : justSaved ? 'Update' : 'Save'}
          </Button>
        </div>
      )}

      {isLocked && (
        <button onClick={() => setShowAll(v => !v)} className="text-xs flex items-center gap-1" style={{ color:'var(--accent)' }}>
          <i className={`ti ti-chevron-${showAll ? 'up' : 'down'} text-xs`} aria-hidden="true"/>
          {showAll ? 'Hide' : 'Show'} all predictions {count != null && `(${count})`}
        </button>
      )}
      {isLocked && showAll && <AllPredictions fixtureId={fixture.id} fixture={fixture} userId={userId} rules={rules} />}
    </Card>
  )
}

// ───────────────────────── Gameweek Results tab ─────────────────────────
function GameweekResultsTab({ competitionId, gwId, gwLabel, rules, compFormat, userId }) {
  const [fixtures, setFixtures] = useState([])
  const [participants, setParticipants] = useState([])
  const [predMap, setPredMap] = useState({})
  const [tpUsers, setTpUsers] = useState(new Set()) // user_ids who played TP in this GW
  // Authoritative per-user totals for the gameweek, written by
  // recalculateGameweek. These include the Triple Points multiplier and full
  // house bonuses; summing per-fixture points_earned does not.
  const [gwTotals, setGwTotals] = useState({}) // { userId: points }
  const [cupFixtures, setCupFixtures] = useState([]) // bracket or group matches for this GW
  const [loading, setLoading] = useState(true)
  const isGroup = compFormat === 'group_knockout'
  const isKnockout = compFormat === 'knockout'
  const isCupFormat = isGroup || isKnockout

  useEffect(() => { if (gwId) load(); else setLoading(false) }, [gwId, compFormat])

  async function load() {
    setLoading(true)
    try {
      if (isGroup) {
        const { data: gfx } = await supabase.from('group_fixtures')
          .select('*, home:home_user_id(display_name), away:away_user_id(display_name)')
          .eq('competition_id', competitionId).eq('gameweek_id', gwId).order('round_number')
        setCupFixtures(gfx || [])
      } else if (isKnockout) {
        // For a Knockout competition, the "results" are the bracket matches
        // whose assigned gameweek is this one — the participant vs participant
        // matchups for whichever round is in progress.
        const { data: bfx } = await supabase.from('bracket_matches')
          .select('*, home:home_user_id(display_name), away:away_user_id(display_name), winner:winner_user_id(display_name)')
          .eq('competition_id', competitionId).eq('gameweek_id', gwId)
        setCupFixtures(bfx || [])
      }

      // Football fixture matrix always loads for both formats — it shows
      // each participant's predictions and points for the real fixtures,
      // which is what feeds the participant vs participant scores.
      const [{ data: fx }, { data: parts }, { data: preds }] = await Promise.all([
        supabase.from('fixtures').select('*').eq('gameweek_id', gwId).order('kickoff_time'),
        supabase.from('participants').select('user_id, profiles(display_name)').eq('competition_id', competitionId),
        supabase.from('predictions').select('user_id, fixture_id, predicted_home, predicted_away, points_earned').eq('gameweek_id', gwId),
      ])
      setFixtures(fx || [])
      const totals = {}
      ;(preds || []).forEach(p => { totals[p.user_id] = (totals[p.user_id] || 0) + (p.points_earned || 0) })
      const sortedParts = [...(parts || [])].sort((a,b) => (totals[b.user_id]||0) - (totals[a.user_id]||0))
      setParticipants(sortedParts)
      const map = {}
      ;(preds || []).forEach(p => { if (!map[p.user_id]) map[p.user_id] = {}; map[p.user_id][p.fixture_id] = p })
      setPredMap(map)
      // Fetch TP plays for this specific GW — only for League competitions
      if (!isCupFormat && competitionId && gwId) {
        const { data: totals } = await supabase.from('gameweek_scores')
          .select('user_id, points').eq('competition_id', competitionId).eq('gameweek_id', gwId)
        setGwTotals(Object.fromEntries((totals || []).map(t => [t.user_id, t.points || 0])))
        const { data: tp } = await supabase.from('triple_points_plays').select('user_id').eq('competition_id', competitionId).eq('gameweek_id', gwId)
        setTpUsers(new Set((tp||[]).map(t => t.user_id)))
      }
    } finally { setLoading(false) }
  }

  if (!gwId) return <EmptyState icon="ti-calendar-off" title="No gameweek selected" />
  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg"/></div>

  const CupResultsCard = () => {
    const title = isGroup ? 'Group Results' : 'Cup Results'
    return (
      <Card className="p-4 mb-4">
        <p className="text-sm font-semibold mb-3" style={{ color:'var(--txt-primary)' }}>{title}</p>
        {cupFixtures.length === 0
          ? <p className="text-xs" style={{ color:'var(--txt-muted)' }}>No cup fixtures assigned to {gwLabel} yet.</p>
          : cupFixtures.map(fx => (
              <div key={fx.id} className="flex items-center justify-between py-2.5 border-b last:border-0 gap-3" style={{ borderColor:'var(--border)' }}>
                <span className="text-sm" style={{ color:'var(--txt-primary)', minWidth: 0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {fx.home?.display_name} vs {fx.away?.display_name}
                </span>
                {fx.status === 'completed' ? (
                  <div className="flex items-center" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    <span className="text-sm font-bold" style={{ color: 'var(--green)', width: 30, textAlign: 'right' }}>{isKnockout ? fx.home_points : fx.home_points}</span>
                    <span className="text-sm font-bold" style={{ color: 'var(--green)', width: 16, textAlign: 'center' }}>–</span>
                    <span className="text-sm font-bold" style={{ color: 'var(--green)', width: 30, textAlign: 'left' }}>{isKnockout ? fx.away_points : fx.away_points}</span>
                  </div>
                ) : (
                  <span className="text-sm" style={{ color:'var(--txt-muted)', flexShrink: 0 }}>Pending</span>
                )}
              </div>
            ))
        }
      </Card>
    )
  }

  return (
    <div>
      {isCupFormat && <CupResultsCard />}
      <Card className="p-4 mb-4">
        <p className="text-sm font-semibold mb-3" style={{ color:'var(--txt-primary)' }}>Results</p>
        {fixtures.length === 0
          ? <p className="text-xs" style={{ color:'var(--txt-muted)' }}>No fixtures this gameweek</p>
          : fixtures.map(f => (
              <div key={f.id} className="flex items-center justify-between py-2.5 border-b last:border-0 gap-3" style={{ borderColor:'var(--border)' }}>
                <span className="text-sm" style={{ color:'var(--txt-primary)', minWidth: 0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.home_team} vs {f.away_team}</span>
                <span className="text-sm font-bold" style={{ color: f.home_score !== null ? 'var(--green)' : 'var(--txt-muted)', minWidth: 66, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {f.home_score !== null ? `${f.home_score} – ${f.away_score}` : format(new Date(f.kickoff_time), 'EEE d MMM, HH:mm')}
                </span>
              </div>
            ))
        }
      </Card>

      {participants.length > 0 && fixtures.length > 0 && (
        <Card className="overflow-hidden p-0">
          <p className="text-sm font-semibold p-4 pb-3" style={{ color:'var(--txt-primary)' }}>Predictions & Points</p>
          <div className="overflow-x-auto">
            <table className="data-table w-full" style={{ minWidth: 190 + fixtures.length * 100 + (tpUsers.size > 0 ? 60 : 0) }}>
              <thead><tr>
                <th className="sticky-col" style={{ width: 110, paddingLeft: 14 }}>Participant</th>
                {fixtures.map(f => <th key={f.id} style={{ width: 100, textAlign:'center', fontSize: 10, lineHeight: 1.3 }}>{f.home_team}<br/>v<br/>{f.away_team}</th>)}
                {tpUsers.size > 0 && <th style={{ width: 50, textAlign:'center', fontSize: 10 }}>⚡ TP</th>}
                <th style={{ width: 70, textAlign:'center', fontSize: 10 }}>Total</th>
              </tr></thead>
              <tbody>
                {participants.map(p => {
                  const isMe = p.user_id === userId
                  // Only count points for fixtures that have kicked off — a locked
                  // fixture's prediction isn't visible, so its points mustn't show
                  // in the total either (it would reveal relative standing).
                  const liveSum = fixtures.reduce((sum, f) => {
                    const kicked = new Date(f.kickoff_time) <= new Date()
                    return sum + (kicked ? (predMap[p.user_id]?.[f.id]?.points_earned || 0) : 0)
                  }, 0)
                  const playedTp = tpUsers.has(p.user_id)
                  // Once the gameweek has been recalculated, gameweek_scores holds
                  // the real figure — multiplier and full house bonuses included.
                  // Before that, approximate by applying the multiplier to what's
                  // known so far. Summing raw per-fixture points was showing a
                  // Triple Points player the same total as everyone else.
                  const settled = gwTotals[p.user_id]
                  const total = settled != null ? settled : (playedTp ? liveSum * 3 : liveSum)
                  const tpBonus = playedTp ? total - Math.round(total / 3) : 0
                  return (
                  <tr key={p.user_id} className={isMe ? 'highlight' : ''}>
                    {/* Pinned: scrolling the grid sideways used to take the names
                        off screen, leaving numbers with nothing to attach them to. */}
                    <td className="sticky-col" style={{ paddingLeft: 14, maxWidth: 0 }}>
                      {/* Shortened rather than truncated. A 110px column can't
                          hold "Gavin Whiteside", and letting CSS cut it gives
                          "Gavin Whit…" — which spends the whole column on a
                          surname nobody can read. "Gavin W." says more in less
                          space. Short names are left alone. */}
                      <p className="text-sm font-medium" title={p.profiles?.display_name}
                        style={{ color:'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {/* 10, not the default 13. This column is the narrowest
                            in the app — roughly 140px — and a 12-character name
                            like "Mark Haworth" still overflowed it. Anything
                            longer than ten characters shortens here. */}
                        {fitName(p.profiles?.display_name, 10)}
                      </p>
                    </td>
                    {fixtures.map(f => {
                      const pred = predMap[p.user_id]?.[f.id]
                      const hasKickedOff = new Date(f.kickoff_time) <= new Date()
                      // Show prediction only if the fixture has kicked off OR it's your own
                      if (!hasKickedOff && !isMe) {
                        return (
                          <td key={f.id} style={{ textAlign:'center' }}>
                            <i className="ti ti-lock text-xs" style={{ color:'var(--txt-muted)' }} title="Visible after kickoff" aria-hidden="true"/>
                          </td>
                        )
                      }
                      if (!pred) return <td key={f.id} style={{ textAlign:'center' }}><span className="text-xs" style={{ color:'var(--txt-muted)' }}>—</span></td>
                      const ps = pointsStyle(pred.points_earned, rules)
                      return (
                        <td key={f.id} style={{ textAlign:'center', background: ps.bg, padding: '8px 4px' }}>
                          <p className="text-sm font-semibold" style={{ color: ps.color }}>{pred.predicted_home}–{pred.predicted_away}</p>
                          {hasKickedOff && (() => {
                            const { predicted_home: ph, predicted_away: pa } = pred
                            const isExact = f.home_score !== null && ph === f.home_score && pa === f.away_score
                            const isResult = f.home_score !== null && ((ph > pa ? 'home' : pa > ph ? 'away' : 'draw') === (f.home_score > f.away_score ? 'home' : f.away_score > f.home_score ? 'away' : 'draw'))
                            const pts = f.home_score !== null ? (isExact ? (rules?.correct_result_points||2)+(rules?.exact_score_points||3) : isResult ? (rules?.correct_result_points||2) : 0) : 0
                            return <p className="text-xs" style={{ color: ps.color, opacity: 0.85 }}>{pts}pts</p>
                          })()}
                        </td>
                      )
                    })}
                    {tpUsers.size > 0 && (
                      <td style={{ textAlign:'center' }}>
                        {playedTp
                          ? <>
                              <span style={{ color:'var(--gold)', fontSize:14 }}>⚡</span>
                              {/* What the chip actually earned them, which is the
                                  whole point of playing it. */}
                              {tpBonus > 0 && <p className="text-xs font-semibold" style={{ color:'var(--gold)' }}>+{tpBonus}</p>}
                            </>
                          : <span style={{ color:'var(--txt-muted)', fontSize:11 }}>—</span>
                        }
                      </td>
                    )}
                    <td style={{ textAlign:'center', borderLeft: '0.5px solid var(--border)' }}>
                      <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{total || '—'}</span>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// Which half-season a gameweek falls into: 'first' must be used on-or-before
// 31 Dec, 'second' from 1 Jan through end of season. Determined from the
// gameweek's assigned month, or its earliest fixture's date if no month
// has been set yet.
function gameweekHalf(gw, fixtures) {
  let ym = gw?.month_key
  if (!ym && fixtures?.length) {
    const earliest = [...fixtures].sort((a,b) => new Date(a.kickoff_time) - new Date(b.kickoff_time))[0]
    if (earliest) ym = new Date(earliest.kickoff_time).toISOString().slice(0,7)
  }
  if (!ym) return null
  const month = Number(ym.split('-')[1])
  return (month >= 8 && month <= 12) ? 'first' : 'second'
}

function TriplePointsCard({ competitionId, competitions, gameweek, fixtures, predictions, userId }) {
  const [plays, setPlays] = useState([]) // [{ half, gameweek_id, gameweek_number }]
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)

  const comp = competitions.find(c => c.id === competitionId)
  const isLeague = comp?.format === 'league'
  const isCompBlocked = comp?.triple_points_blocked === true

  useEffect(() => {
    if (!competitionId || !userId || !isLeague) { setLoading(false); return }
    supabase.from('triple_points_plays').select('*, gameweeks(number)').eq('competition_id', competitionId).eq('user_id', userId)
      .then(({ data }) => {
        setPlays((data || []).map(p => ({ ...p, gameweek_number: p.gameweeks?.number || '?' })))
        setLoading(false)
      })
  }, [competitionId, userId, isLeague])

  if (!isLeague || !gameweek || loading) return null

  const half = gameweekHalf(gameweek, fixtures)
  if (!half) return null

  const activeThisGw = plays.some(p => p.gameweek_id === gameweek.id)
  const usedThisHalf  = plays.find(p => p.half === half)
  const isBlocked = gameweek.triple_points_blocked || isCompBlocked
  const hasKickedOff  = fixtures.some(f => f.status !== 'void' && new Date(f.kickoff_time) <= new Date())
  const halfLabel = half === 'first' ? 'first half (by 31 Dec)' : 'second half (Jan–end of season)'

  // Triple Points can only be played on a gameweek the participant has
  // predicted in full. Tripling a partial entry would reward leaving fixtures
  // blank, and the same rule voids the full house bonuses that the chip
  // multiplies.
  // Voided fixtures are excluded — a participant can't predict a match that's
  // been called off, so requiring it would make the chip unplayable.
  const livePicks = fixtures.filter(f => f.status !== 'void')
  const missing = livePicks.filter(f => !predictions?.[f.id])
  const predictedAll = livePicks.length > 0 && missing.length === 0

  async function activate() {
    const confirmed = window.confirm(`Play Triple Points on ${gameweek.number}? This triples every point you earn this gameweek, including bonuses — and uses up your ${halfLabel} chip for the season. This can't be undone. Are you sure?`)
    if (!confirmed) return
    setActivating(true)
    const { error } = await supabase.from('triple_points_plays').insert({ competition_id: competitionId, gameweek_id: gameweek.id, user_id: userId, half })
    setActivating(false)
    if (error) {
      // The database enforces the same complete-predictions rule the UI does,
      // so surface its message rather than a generic failure — it says exactly
      // how many fixtures are still missing.
      const msg = error.code === '23505' ? `You've already used your ${halfLabel} chip`
        : /prediction for every fixture/i.test(error.message || '') ? 'Predict every fixture in this gameweek before playing Triple Points'
        : 'Could not activate Triple Points'
      toast.error(msg); return
    }
    setPlays(prev => [...prev, { competition_id: competitionId, gameweek_id: gameweek.id, gameweek_number: gameweek.number, user_id: userId, half }])
    toast.success('⚡ Triple Points active for this gameweek!')
  }

  const tp1 = plays.find(p => p.half === 'first')
  const tp2 = plays.find(p => p.half === 'second')
  const otherHalf = half === 'first' ? 'second' : 'first'
  const otherPlay = half === 'first' ? tp2 : tp1

  return (
    <Card className="p-3.5 mb-4" style={{ background: activeThisGw ? 'var(--gold-dim)' : 'var(--bg-surface)', borderColor: activeThisGw ? 'rgba(245,200,66,0.4)' : undefined }}>
      {/* Always show the status of both chips clearly */}
      <div className="flex flex-col gap-2">
        {/* Chip 1 */}
        <div className="flex items-start gap-2">
          <span style={{ color: tp1 ? 'var(--gold)' : 'var(--txt-muted)', fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>⚡</span>
          <p className="text-xs" style={{ color: tp1 ? 'var(--gold)' : 'var(--txt-second)' }}>
            <span className="font-semibold">Triple Points 1 (due by 31st Dec)</span>
            {tp1 ? ` — played ${tp1.gameweek_number}` : ' — still available'}
          </p>
        </div>
        {/* Chip 2 */}
        <div className="flex items-start gap-2">
          <span style={{ color: tp2 ? 'var(--gold)' : 'var(--txt-muted)', fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>⚡</span>
          <p className="text-xs" style={{ color: tp2 ? 'var(--gold)' : 'var(--txt-second)' }}>
            <span className="font-semibold">Triple Points 2 (due by end of season)</span>
            {tp2 ? ` — played ${tp2.gameweek_number}` : ' — still available'}
          </p>
        </div>
      </div>

      {/* Action section — only shown when relevant */}
      {activeThisGw ? (
        <div className="flex items-center gap-2 mt-2.5 pt-2.5" style={{ borderTop: '0.5px solid rgba(245,200,66,0.3)' }}>
          <i className="ti ti-bolt text-sm" style={{ color: 'var(--gold)' }} aria-hidden="true"/>
          <span className="text-xs font-medium" style={{ color: 'var(--gold)' }}>Active this gameweek — every point is ×3</span>
        </div>
      ) : usedThisHalf ? null
      : isBlocked ? (
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>Triple Points is blocked for this {isCompBlocked ? 'competition' : `gameweek (${gameweek.number})`}.</p>
      ) : hasKickedOff ? (
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>Too late to activate for {gameweek.number} — kickoff has passed.</p>
      ) : !predictedAll ? (
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>
          Predict all {livePicks.length} fixture{livePicks.length !== 1 ? 's' : ''} in {gameweek.number} to unlock Triple Points
          {missing.length > 0 && ` — ${missing.length} still to go`}.
        </p>
      ) : (
        <div className="flex items-center justify-between gap-2 flex-wrap mt-2.5 pt-2.5" style={{ borderTop: '0.5px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--txt-second)' }}>Play your {half === 'first' ? 'first (by 31 Dec)' : 'second (end of season)'} chip on {gameweek.number}?</p>
          <Button variant="primary" size="sm" onClick={activate} disabled={activating}>
            <i className="ti ti-bolt text-xs"/>{activating ? 'Activating…' : 'Play Triple Points'}
          </Button>
        </div>
      )}
    </Card>
  )
}

export default function Predict() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [gameweeks, setGameweeks] = useState([])
  const [selectedGW, setSelectedGW] = useState(null)
  const [rules, setRules] = useState(null)
  const [tab, setTab] = useState('mine')
  const [counts, setCounts] = useState({})
  const { fixtures, loading: lf } = useFixtures(selectedGW?.id)
  const { predictions, loading: lp, savePrediction } = usePredictions(selectedGW?.id, user?.id)

  useEffect(() => { if (comp) { loadGWs(); loadRules() } }, [comp])
  useEffect(() => { if (selectedGW) loadCounts() }, [selectedGW])

  async function loadGWs() {
    // Gameweeks linked to this competition — whether created here or linked
    // in from another competition — via the join table.
    const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', comp)
    const gwIds = (links || []).map(l => l.gameweek_id)
    const { data } = gwIds.length
      ? await supabase.from('gameweeks').select('*').in('id', gwIds).order('number')
      : { data: [] }
    setGameweeks(data||[])
    const active = data?.find(g=>g.status==='active') || data?.[data.length-1]
    setSelectedGW(active||null)
  }

  async function loadRules() {
    const data = await resolvePointRules(supabase, comp)
    setRules(data)
  }

  async function loadCounts() {
    const { data } = await supabase.from('predictions').select('fixture_id').eq('gameweek_id', selectedGW.id)
    const c = {}; (data||[]).forEach(p => { c[p.fixture_id] = (c[p.fixture_id]||0) + 1 })
    setCounts(c)
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-4">
        <Select value={comp || ''} onChange={e => setComp(e.target.value)} style={{ flex: '1 1 200px' }}>
          {competitions.map(c => <option key={c.id} value={c.id}>{FORMAT_MARK[c.format] || ''} {c.name}</option>)}
        </Select>
        {/* Hidden on Season: season predictions cover the whole season and
            aren't tied to a gameweek, so a gameweek picker there is a control
            that does nothing. */}
        {tab !== 'season' && (
          <Select value={selectedGW?.id || ''} onChange={e => setSelectedGW(gameweeks.find(g => g.id === e.target.value) || null)} style={{ flex: '1 1 140px' }}>
            {gameweeks.length === 0 && <option value="">No gameweeks yet</option>}
            {gameweeks.map(gw => <option key={gw.id} value={gw.id}>{gw.number}{gw.status === 'active' ? ' (current)' : ''}</option>)}
          </Select>
        )}
      </div>

      <div className="flex gap-4 mb-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
        {[['mine','My Predictions'],['results','Gameweek Results'],['season','Season']].map(([k,label]) => (
          <button key={k} onClick={() => setTab(k)} className="text-sm pb-2"
            style={{ color: tab===k ? 'var(--accent)' : 'var(--txt-muted)', fontWeight: tab===k ? 600 : 400, borderBottom: tab===k ? '2px solid var(--accent)' : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {selectedGW && rules && (
        <div className="mb-4 p-3 rounded-md text-xs" style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border)' }}>
          <span style={{ color:'var(--txt-second)' }}>
            Correct result = <strong style={{ color:'var(--accent)' }}>{rules.correct_result_points}pts</strong> &nbsp;·&nbsp;
            Exact score bonus = <strong style={{ color:'var(--green)' }}>+{rules.exact_score_points}pts</strong> extra
            {rules.full_house_results_bonus > 0 && <> &nbsp;·&nbsp; <strong style={{ color:'var(--amber)' }}>+{rules.full_house_results_bonus}pts</strong> bonus (all results)</>}
            {rules.full_house_scores_bonus > 0 && <> &nbsp;·&nbsp; <strong style={{ color:'var(--gold)' }}>+{rules.full_house_scores_bonus}pts</strong> bonus (all scores)</>}
          </span>
        </div>
      )}

      {tab === 'season' && <SeasonPredictions competitionId={comp} userId={user?.id} />}
      {tab === 'mine' && <TriplePointsCard competitionId={comp} competitions={competitions} gameweek={selectedGW} fixtures={fixtures} predictions={predictions} userId={user?.id} />}

      {/* Explicit per-tab checks, not a ternary. This was
          `tab === 'mine' ? predictions : results`, so adding a third tab meant
          Season fell into the else branch and rendered the Gameweek Results
          content underneath itself. */}
      {tab === 'mine' && (
        lf || lp ? <div className="flex justify-center py-20"><Spinner size="lg"/></div>
        : fixtures.length === 0 ? <EmptyState icon="ti-calendar-off" title="No fixtures this gameweek" description="Fixtures will appear when the admin adds them"/>
        : fixtures.map(f => <FixtureCard key={f.id} fixture={f} prediction={predictions[f.id]} userId={user?.id} count={counts[f.id]} rules={rules} gwLabel={selectedGW?.number} onSave={(fid,h,a)=>savePrediction(fid,h,a,selectedGW.id,user.id)}/>)
      )}

      {tab === 'results' && (
        <GameweekResultsTab competitionId={comp} gwId={selectedGW?.id} gwLabel={selectedGW?.number} rules={rules} compFormat={competitions.find(c=>c.id===comp)?.format} userId={user?.id} />
      )}
    </div>
  )
}
