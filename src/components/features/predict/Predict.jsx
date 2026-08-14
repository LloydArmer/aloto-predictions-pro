import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { useFixtures, usePredictions } from '../../../hooks/useFixtures'
import { supabase } from '../../../lib/supabase'
import { resolvePointRules } from '../../../lib/scoring'
import { Card, Button, Select, Spinner, EmptyState } from '../../ui'
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
  return <input type="number" min="0" max="20" value={value}
    onChange={e => onChange(Math.max(0, Math.min(20, parseInt(e.target.value)||0)))}
    disabled={disabled} className="score-box"
    style={disabled ? { opacity:0.45, cursor:'not-allowed' } : {}}/>
}

function AllPredictions({ fixtureId, userId, rules }) {
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

  if (loading) return <div className="flex justify-center py-4"><Spinner size="sm"/></div>
  if (!rows?.length) return <p className="text-xs py-2" style={{ color:'var(--txt-muted)' }}>No one predicted this fixture.</p>

  return (
    <div className="mt-2 rounded-md overflow-hidden" style={{ border:'0.5px solid var(--border)' }}>
      {rows.map((r, i) => {
        const isMe = r.user_id === userId
        const ps = pointsStyle(r.points_earned, rules)
        return (
          <div key={i} className="flex items-center justify-between px-3 py-2"
            style={{ background: isMe ? 'var(--accent-dim)' : 'transparent', borderBottom: i < rows.length-1 ? '0.5px solid var(--border)' : '' }}>
            <span className="text-xs" style={{ color: isMe ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: isMe ? 700 : 400 }}>
              {r.profiles?.display_name}{isMe && ' (you)'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color:'var(--txt-second)' }}>{r.predicted_home}–{r.predicted_away}</span>
              <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: ps.bg, color: ps.color }}>{r.points_earned}pts</span>
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
  const isLocked = isPast(kickoff)
  const hasResult = fixture.home_score !== null
  const justSaved = !!prediction
  const ps = hasResult && prediction ? pointsStyle(prediction.points_earned, rules) : null

  async function save() {
    if (home === '' || away === '') { toast.error('Enter both scores'); return }
    setSaving(true)
    try { await onSave(fixture.id, Number(home), Number(away)); toast.success('Prediction saved!') }
    catch { toast.error('Could not save prediction') }
    finally { setSaving(false) }
  }

  return (
    <Card className="p-4 mb-3" style={justSaved && !isLocked ? { border: '1px solid var(--green)' } : {}}>
      <p className="text-base font-semibold" style={{ color:'var(--txt-primary)' }}>
        {fixture.home_team} <span style={{ color:'var(--txt-muted)', fontWeight:400 }}>vs</span> {fixture.away_team}
      </p>
      <p className="text-xs mb-3" style={{ color:'var(--txt-muted)' }}>{gwLabel} · KO: {format(kickoff,'EEE d MMM')} at {format(kickoff,'HH:mm')}</p>

      {hasResult ? (
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-base font-bold" style={{ color:'var(--green)' }}>Result: {fixture.home_score}–{fixture.away_score}</span>
          {prediction && <span className="text-xs font-medium px-2.5 py-1 rounded-md" style={{ background: ps.bg, color: ps.color }}>{prediction.points_earned}pts</span>}
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
      {isLocked && showAll && <AllPredictions fixtureId={fixture.id} userId={userId} rules={rules} />}
    </Card>
  )
}

// ───────────────────────── Gameweek Results tab ─────────────────────────
function GameweekResultsTab({ competitionId, gwId, gwLabel, rules, compFormat, userId }) {
  const [fixtures, setFixtures] = useState([])
  const [participants, setParticipants] = useState([])
  const [predMap, setPredMap] = useState({})
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
                  {f.home_score !== null ? `${f.home_score} – ${f.away_score}` : format(new Date(f.kickoff_time), 'HH:mm')}
                </span>
              </div>
            ))
        }
      </Card>

      {participants.length > 0 && fixtures.length > 0 && (
        <Card className="overflow-hidden p-0">
          <p className="text-sm font-semibold p-4 pb-3" style={{ color:'var(--txt-primary)' }}>Predictions & Points</p>
          <div className="overflow-x-auto">
            <table className="data-table w-full" style={{ minWidth: 190 + fixtures.length * 100 }}>
              <thead><tr>
                <th style={{ width: 110, paddingLeft: 14 }}>Participant</th>
                {fixtures.map(f => <th key={f.id} style={{ width: 100, textAlign:'center', fontSize: 10, lineHeight: 1.3 }}>{f.home_team}<br/>v<br/>{f.away_team}</th>)}
                <th style={{ width: 70, textAlign:'center', fontSize: 10 }}>Total</th>
              </tr></thead>
              <tbody>
                {participants.map(p => {
                  const isMe = p.user_id === userId
                  // Only count points in the total for fixtures that have kicked off —
                  // a locked fixture's prediction isn't visible so its points shouldn't
                  // show in the total either (it would reveal relative standing)
                  const total = fixtures.reduce((sum, f) => {
                    const kicked = new Date(f.kickoff_time) <= new Date()
                    return sum + (kicked ? (predMap[p.user_id]?.[f.id]?.points_earned || 0) : 0)
                  }, 0)
                  return (
                  <tr key={p.user_id}>
                    <td style={{ paddingLeft: 14 }}><p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>{p.profiles?.display_name}</p></td>
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
                          {hasKickedOff && <p className="text-xs" style={{ color: ps.color, opacity: 0.85 }}>{pred.points_earned}pts</p>}
                        </td>
                      )
                    })}
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

function TriplePointsCard({ competitionId, competitions, gameweek, fixtures, userId }) {
  const [plays, setPlays] = useState([])
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)

  const comp = competitions.find(c => c.id === competitionId)
  const isLeague = comp?.format === 'league'
  const isCompBlocked = comp?.triple_points_blocked === true

  useEffect(() => {
    if (!competitionId || !userId || !isLeague) { setLoading(false); return }
    supabase.from('triple_points_plays').select('*').eq('competition_id', competitionId).eq('user_id', userId)
      .then(({ data }) => { setPlays(data || []); setLoading(false) })
  }, [competitionId, userId, isLeague])

  if (!isLeague || !gameweek || loading) return null

  const half = gameweekHalf(gameweek, fixtures)
  if (!half) return null

  const activeThisGw = plays.some(p => p.gameweek_id === gameweek.id)
  const usedThisHalf  = plays.find(p => p.half === half)
  const isBlocked = gameweek.triple_points_blocked || isCompBlocked
  const hasKickedOff  = fixtures.some(f => new Date(f.kickoff_time) <= new Date())
  const halfLabel = half === 'first' ? 'first half (by 31 Dec)' : 'second half (Jan–end of season)'

  async function activate() {
    const confirmed = window.confirm(`Play Triple Points on ${gameweek.number}? This triples every point you earn this gameweek, including bonuses — and uses up your ${halfLabel} chip for the season. This can't be undone. Are you sure?`)
    if (!confirmed) return
    setActivating(true)
    const { error } = await supabase.from('triple_points_plays').insert({ competition_id: competitionId, gameweek_id: gameweek.id, user_id: userId, half })
    setActivating(false)
    if (error) { toast.error(error.code === '23505' ? `You've already used your ${halfLabel} chip` : 'Could not activate Triple Points'); return }
    setPlays(prev => [...prev, { competition_id: competitionId, gameweek_id: gameweek.id, user_id: userId, half }])
    toast.success('⚡ Triple Points active for this gameweek!')
  }

  return (
    <Card className="p-3.5 mb-4" style={{ background: activeThisGw ? 'var(--gold-dim)' : 'var(--bg-surface)', borderColor: activeThisGw ? 'rgba(245,200,66,0.4)' : undefined }}>
      {activeThisGw ? (
        <div className="flex items-center gap-2">
          <i className="ti ti-bolt text-base" style={{ color: 'var(--gold)' }} aria-hidden="true"/>
          <span className="text-sm font-medium" style={{ color: 'var(--gold)' }}>⚡ Triple Points active for {gameweek.number} — every point this week is ×3</span>
        </div>
      ) : usedThisHalf ? (
        <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>Your {halfLabel} Triple Points chip was already used on GW {usedThisHalf.gameweek_id === gameweek.id ? 'this one' : ''}. Your other chip is for the other half of the season.</p>
      ) : isBlocked ? (
        <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>Triple Points is blocked for this {isCompBlocked ? 'competition' : `gameweek (${gameweek.number})`}.</p>
      ) : hasKickedOff ? (
        <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>Too late to activate Triple Points for {gameweek.number} — the first kickoff has passed.</p>
      ) : (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs" style={{ color: 'var(--txt-second)' }}>You have a Triple Points chip available for this {halfLabel === 'first half (by 31 Dec)' ? 'first half of the season' : 'second half of the season'}.</p>
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
          {competitions.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </Select>
        <Select value={selectedGW?.id || ''} onChange={e => setSelectedGW(gameweeks.find(g => g.id === e.target.value) || null)} style={{ flex: '1 1 140px' }}>
          {gameweeks.length === 0 && <option value="">No gameweeks yet</option>}
          {gameweeks.map(gw => <option key={gw.id} value={gw.id}>{gw.number}{gw.status === 'active' ? ' (current)' : ''}</option>)}
        </Select>
      </div>

      <div className="flex gap-4 mb-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
        {[['mine','My Predictions'],['results','Gameweek Results']].map(([k,label]) => (
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

      {tab === 'mine' && <TriplePointsCard competitionId={comp} competitions={competitions} gameweek={selectedGW} fixtures={fixtures} userId={user?.id} />}

      {tab === 'mine' ? (
        lf || lp ? <div className="flex justify-center py-20"><Spinner size="lg"/></div>
        : fixtures.length === 0 ? <EmptyState icon="ti-calendar-off" title="No fixtures this gameweek" description="Fixtures will appear when the admin adds them"/>
        : fixtures.map(f => <FixtureCard key={f.id} fixture={f} prediction={predictions[f.id]} userId={user?.id} count={counts[f.id]} rules={rules} gwLabel={selectedGW?.number} onSave={(fid,h,a)=>savePrediction(fid,h,a,selectedGW.id,user.id)}/>)
      ) : (
        <GameweekResultsTab competitionId={comp} gwId={selectedGW?.id} gwLabel={selectedGW?.number} rules={rules} compFormat={competitions.find(c=>c.id===comp)?.format} userId={user?.id} />
      )}
    </div>
  )
}
