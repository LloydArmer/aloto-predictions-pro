import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useFixtures, usePredictions } from '../../../hooks/useFixtures'
import { supabase } from '../../../lib/supabase'
import { Card, Badge, Button, Select, Spinner, EmptyState } from '../../ui'
import toast from 'react-hot-toast'
import { format, isPast } from 'date-fns'

function ScoreInput({ value, onChange, disabled }) {
  return <input type="number" min="0" max="20" value={value}
    onChange={e => onChange(Math.max(0, Math.min(20, parseInt(e.target.value)||0)))}
    disabled={disabled} className="score-box"
    style={disabled ? { opacity:0.45, cursor:'not-allowed' } : {}}/>
}

function AllPredictions({ fixtureId, userId }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('predictions').select('predicted_home, predicted_away, points_earned, user_id, profiles(display_name)')
      .eq('fixture_id', fixtureId).order('points_earned', { ascending: false })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [fixtureId])

  if (loading) return <div className="flex justify-center py-4"><Spinner size="sm"/></div>
  if (!rows?.length) return <p className="text-xs py-2" style={{ color:'var(--txt-muted)' }}>No one predicted this fixture.</p>

  return (
    <div className="mt-2 rounded-md overflow-hidden" style={{ border:'0.5px solid var(--border)' }}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between px-3 py-2"
          style={{ background: r.user_id === userId ? 'rgba(79,142,247,0.08)' : i % 2 ? 'var(--bg-surface)' : 'transparent', borderBottom: i < rows.length-1 ? '0.5px solid var(--border)' : '' }}>
          <span className="text-xs" style={{ color:'var(--txt-primary)', fontWeight: r.user_id === userId ? 600 : 400 }}>
            {r.profiles?.display_name}{r.user_id === userId && <span style={{ color:'var(--accent)' }}> (you)</span>}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color:'var(--txt-second)' }}>{r.predicted_home}–{r.predicted_away}</span>
            <Badge variant={r.points_earned > 0 ? 'result' : 'upcoming'}>{r.points_earned}pts</Badge>
          </div>
        </div>
      ))}
    </div>
  )
}

function FixtureCard({ fixture, prediction, userId, onSave }) {
  const [home, setHome] = useState(prediction?.predicted_home ?? '')
  const [away, setAway] = useState(prediction?.predicted_away ?? '')
  const [saving, setSaving] = useState(false)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { setHome(prediction?.predicted_home ?? ''); setAway(prediction?.predicted_away ?? '') }, [prediction])

  const kickoff  = new Date(fixture.kickoff_time)
  const isLocked = isPast(kickoff)
  const hasResult = fixture.home_score !== null
  const justSaved = !!prediction

  async function save() {
    if (home === '' || away === '') { toast.error('Enter both scores'); return }
    setSaving(true)
    try { await onSave(fixture.id, Number(home), Number(away)); toast.success('Prediction saved!') }
    catch { toast.error('Could not save prediction') }
    finally { setSaving(false) }
  }

  return (
    <Card className="p-4 mb-3" style={justSaved && !isLocked ? { border: '1px solid var(--green)' } : {}}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <span className="text-xs" style={{ color:'var(--txt-muted)' }}>{format(kickoff,'EEE d MMM · HH:mm')}</span>
        {isLocked ? <Badge variant="miss">Locked</Badge> : <Badge variant="upcoming">Open</Badge>}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="flex-1 text-sm font-medium" style={{ color:'var(--txt-primary)', minWidth: 80 }}>{fixture.home_team}</span>
        {hasResult ? (
          <div className="flex items-center gap-2">
            <div className="score-box flex items-center justify-center" style={{ cursor:'default', background:'var(--bg-raised)' }}>{fixture.home_score}</div>
            <span style={{ color:'var(--txt-muted)' }} className="font-medium">–</span>
            <div className="score-box flex items-center justify-center" style={{ cursor:'default', background:'var(--bg-raised)' }}>{fixture.away_score}</div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ScoreInput value={home} onChange={setHome} disabled={isLocked}/>
            <span style={{ color:'var(--txt-muted)' }} className="font-medium">–</span>
            <ScoreInput value={away} onChange={setAway} disabled={isLocked}/>
          </div>
        )}
        <span className="flex-1 text-sm font-medium text-right" style={{ color:'var(--txt-primary)', minWidth: 80 }}>{fixture.away_team}</span>
      </div>

      {!isLocked && !hasResult && (
        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
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

      {prediction && hasResult && (
        <div className="mt-2.5 pt-2.5 flex items-center justify-between" style={{ borderTop:'0.5px solid var(--border)' }}>
          <span className="text-xs" style={{ color:'var(--txt-muted)' }}>Your prediction: {prediction.predicted_home}–{prediction.predicted_away}</span>
          <span className="text-xs font-medium" style={{ color: prediction.points_earned > 0 ? (prediction.points_earned >= 5 ? 'var(--green)' : 'var(--accent)') : 'var(--txt-muted)' }}>
            {prediction.points_earned > 0 ? `+${prediction.points_earned} pts` : '0 pts'}
          </span>
        </div>
      )}

      {isLocked && (
        <div className="mt-2.5 pt-2.5" style={{ borderTop:'0.5px solid var(--border)' }}>
          <button onClick={() => setShowAll(v => !v)} className="text-xs" style={{ color:'var(--accent)' }}>
            {showAll ? 'Hide' : 'Show'} everyone's predictions
          </button>
          {showAll && <AllPredictions fixtureId={fixture.id} userId={userId} />}
        </div>
      )}
    </Card>
  )
}

export default function Predict() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useState(null)
  const [gameweeks, setGameweeks] = useState([])
  const [selectedGW, setSelectedGW] = useState(null)
  const [rules, setRules] = useState(null)
  const { fixtures, loading: lf } = useFixtures(selectedGW?.id)
  const { predictions, loading: lp, savePrediction } = usePredictions(selectedGW?.id, user?.id)

  useEffect(() => { if (competitions.length && !comp) setComp(competitions[0]?.id) }, [competitions])
  useEffect(() => { if (comp) { loadGWs(); loadRules() } }, [comp])

  async function loadGWs() {
    const { data } = await supabase.from('gameweeks').select('*').eq('competition_id', comp).order('number')
    setGameweeks(data||[])
    const active = data?.find(g=>g.status==='active') || data?.[data.length-1]
    setSelectedGW(active||null)
  }

  async function loadRules() {
    const { data } = await supabase.from('point_rules').select('*').eq('competition_id', comp).maybeSingle()
    setRules(data)
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

      {selectedGW && rules && (
        <div className="mb-4 p-3 rounded-md text-xs" style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border)' }}>
          <span style={{ color:'var(--txt-second)' }}>
            Correct result = <strong style={{ color:'var(--accent)' }}>{rules.correct_result_points}pts</strong> &nbsp;·&nbsp;
            Exact score = <strong style={{ color:'var(--green)' }}>{rules.exact_score_points}pts</strong>
            {rules.full_house_results_bonus > 0 && <> &nbsp;·&nbsp; <strong style={{ color:'var(--amber)' }}>+{rules.full_house_results_bonus}pts</strong> bonus (all results)</>}
            {rules.full_house_scores_bonus > 0 && <> &nbsp;·&nbsp; <strong style={{ color:'var(--gold)' }}>+{rules.full_house_scores_bonus}pts</strong> bonus (all scores)</>}
          </span>
        </div>
      )}

      {lf || lp ? <div className="flex justify-center py-20"><Spinner size="lg"/></div>
        : fixtures.length === 0 ? <EmptyState icon="ti-calendar-off" title="No fixtures this gameweek" description="Fixtures will appear when the admin adds them"/>
        : fixtures.map(f => <FixtureCard key={f.id} fixture={f} prediction={predictions[f.id]} userId={user?.id} onSave={(fid,h,a)=>savePrediction(fid,h,a,selectedGW.id,user.id)}/>)
      }
    </div>
  )
}
