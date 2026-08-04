import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useFixtures, usePredictions } from '../../../hooks/useFixtures'
import { supabase } from '../../../lib/supabase'
import { Card, Badge, Button, Spinner, EmptyState, LiveDot } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import toast from 'react-hot-toast'
import { format, isPast, subHours } from 'date-fns'

function ScoreInput({ value, onChange, disabled }) {
  return <input type="number" min="0" max="20" value={value}
    onChange={e => onChange(Math.max(0, Math.min(20, parseInt(e.target.value)||0)))}
    disabled={disabled} className="score-box"
    style={disabled ? { opacity:0.45, cursor:'not-allowed' } : {}}/>
}

function FixtureCard({ fixture, prediction, onSave }) {
  const [home, setHome] = useState(prediction?.predicted_home ?? '')
  const [away, setAway] = useState(prediction?.predicted_away ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setHome(prediction?.predicted_home ?? ''); setAway(prediction?.predicted_away ?? '') }, [prediction])

  const kickoff  = new Date(fixture.kickoff_time)
  const deadline = subHours(kickoff, 1)
  const isLocked = isPast(deadline)
  const hasResult = fixture.home_score !== null

  async function save() {
    if (home === '' || away === '') { toast.error('Enter both scores'); return }
    setSaving(true)
    try { await onSave(fixture.id, Number(home), Number(away)); toast.success('Prediction saved!') }
    catch { toast.error('Could not save prediction') }
    finally { setSaving(false) }
  }

  return (
    <Card className="p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color:'var(--txt-muted)' }}>{format(kickoff,'EEE d MMM · HH:mm')}</span>
        {isLocked ? <Badge variant="miss">Locked</Badge> : <Badge variant="upcoming">Open</Badge>}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm font-medium" style={{ color:'var(--txt-primary)' }}>{fixture.home_team}</span>
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
        <span className="flex-1 text-sm font-medium text-right" style={{ color:'var(--txt-primary)' }}>{fixture.away_team}</span>
      </div>
      {!isLocked && !hasResult && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs" style={{ color:'var(--txt-muted)' }}>Deadline: {format(deadline,'EEE d MMM, HH:mm')}</p>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            <i className="ti ti-check text-xs"/>{saving ? 'Saving…' : 'Save'}
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
    </Card>
  )
}

export default function Predict() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useState(null)
  const [gameweeks, setGameweeks] = useState([])
  const [selectedGW, setSelectedGW] = useState(null)
  const { fixtures, loading: lf } = useFixtures(selectedGW?.id)
  const { predictions, loading: lp, savePrediction } = usePredictions(selectedGW?.id, user?.id)

  useEffect(() => { if (competitions.length && !comp) setComp(competitions[0]?.id) }, [competitions])
  useEffect(() => { if (comp) loadGWs() }, [comp])

  async function loadGWs() {
    const { data } = await supabase.from('gameweeks').select('*').eq('competition_id', comp).order('number')
    setGameweeks(data||[])
    const active = data?.find(g=>g.status==='active') || data?.[data.length-1]
    setSelectedGW(active||null)
  }

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp}/>
      <div className="flex gap-1.5 flex-wrap mb-4 overflow-x-auto pb-1">
        {gameweeks.map(gw => (
          <button key={gw.id} className={`pill ${selectedGW?.id===gw.id?'active':''}`} onClick={()=>setSelectedGW(gw)}>
            GW{gw.number}{gw.status==='active'&&<span className="live-dot ml-1"/>}
          </button>
        ))}
      </div>
      {selectedGW && (
        <div className="mb-4 p-3 rounded-md text-xs" style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border)' }}>
          <span style={{ color:'var(--txt-second)' }}>Exact score = <strong style={{ color:'var(--green)' }}>5 pts</strong> &nbsp;·&nbsp; Correct result = <strong style={{ color:'var(--accent)' }}>2 pts</strong> &nbsp;·&nbsp; Clean sheet bonus = <strong>+1 pt</strong></span>
        </div>
      )}
      {lf || lp ? <div className="flex justify-center py-20"><Spinner size="lg"/></div>
        : fixtures.length === 0 ? <EmptyState icon="ti-calendar-off" title="No fixtures this gameweek" description="Fixtures will appear when the admin adds them"/>
        : fixtures.map(f => <FixtureCard key={f.id} fixture={f} prediction={predictions[f.id]} onSave={(fid,h,a)=>savePrediction(fid,h,a,selectedGW.id,user.id)}/>)
      }
    </div>
  )
}
