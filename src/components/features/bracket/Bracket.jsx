import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { supabase } from '../../../lib/supabase'
import { Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import toast from 'react-hot-toast'

const ROUND_LABELS = { r64:'Round of 64', r32:'Round of 32', r16:'Round of 16', qf:'Quarter-finals', sf:'Semi-finals', f:'Final' }

function MatchCard({ match, prediction, onPredict }) {
  const isCompleted = match.status==='completed'
  return (
    <div className="rounded-md overflow-hidden mb-2" style={{ border:'0.5px solid var(--border-med)', background:'var(--bg-surface)' }}>
      {[match.home_team, match.away_team].map((team,i)=> !team
        ? <div key={i} className="flex items-center px-3 py-2.5" style={{ borderBottom:i===0?'0.5px solid var(--border)':'', opacity:0.4 }}><span className="text-xs" style={{ color:'var(--txt-muted)' }}>TBD</span></div>
        : <div key={i} onClick={()=>!isCompleted&&onPredict(match.id,team)}
            className="flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors"
            style={{ borderBottom:i===0?'0.5px solid var(--border)':'', background:isCompleted&&match.winner_team===team?'var(--accent-dim)':prediction===team&&!isCompleted?'rgba(79,142,247,0.08)':'' }}>
            <span className="text-sm" style={{ color:'var(--txt-primary)', fontWeight:match.winner_team===team||prediction===team?500:400 }}>{team}</span>
            <div className="flex items-center gap-2">
              {isCompleted&&<span className="text-sm font-medium" style={{ color:'var(--accent)' }}>{i===0?match.home_score:match.away_score}</span>}
              {prediction===team&&!isCompleted&&<i className="ti ti-check text-xs" style={{ color:'var(--accent)' }}/>}
              {match.winner_team===team&&<i className="ti ti-star text-xs" style={{ color:'var(--gold)' }}/>}
            </div>
          </div>
      )}
    </div>
  )
}

export default function Bracket() {
  const { user } = useAuth()
  const { competitions, loading: compsLoading } = useCompetitions()
  const [comp, setComp] = useState(null)
  const [rounds, setRounds] = useState([])
  const [preds, setPreds] = useState({})
  const [loading, setLoading] = useState(false)
  useEffect(()=>{ if(competitions.length&&!comp){ const ko=competitions.find(c=>c.format==='knockout'||c.format==='group_knockout'); setComp(ko?.id||competitions[0]?.id) }}, [competitions])
  useEffect(()=>{ if(comp&&user) load(); else setLoading(false) }, [comp,user])

  async function load() {
    setLoading(true)
    try {
      const { data: matches } = await supabase.from('bracket_matches').select('*').eq('competition_id',comp).order('round_order')
      const { data: bpreds }  = await supabase.from('bracket_predictions').select('*').eq('competition_id',comp).eq('user_id',user.id)
      const pm={}; (bpreds||[]).forEach(p=>{ pm[p.match_id]=p.predicted_winner }); setPreds(pm)
      const rm={}; (matches||[]).forEach(m=>{ if(!rm[m.round]) rm[m.round]=[]; rm[m.round].push(m) })
      setRounds(Object.entries(rm).map(([r,ms])=>({ round:r, matches:ms })))
    } finally { setLoading(false) }
  }

  async function handlePredict(matchId, winner) {
    const existing = preds[matchId]
    if (existing) await supabase.from('bracket_predictions').update({ predicted_winner:winner }).eq('match_id',matchId).eq('user_id',user.id)
    else await supabase.from('bracket_predictions').insert({ match_id:matchId, competition_id:comp, user_id:user.id, predicted_winner:winner })
    setPreds(p=>({...p,[matchId]:winner}))
    toast.success('Bracket prediction saved!')
  }

  // Still checking whether the account belongs to any competition at all
  if (compsLoading) {
    return <div className="flex justify-center py-20"><Spinner size="lg"/></div>
  }

  // Confirmed: no competitions exist for this account yet — normal first-run state
  if (competitions.length === 0) {
    return (
      <Card className="p-6 text-center">
        <EmptyState icon="ti-tournament" title="No competitions yet" description="Once you're part of a competition with a knockout stage, its bracket will appear here."/>
      </Card>
    )
  }

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp}/>
      {loading ? <div className="flex justify-center py-20"><Spinner size="lg"/></div>
        : rounds.length===0 ? <EmptyState icon="ti-tournament" title="No bracket yet" description="The admin will set up bracket matches when the knockout stage begins"/>
        : <>
          <div className="mb-4 p-3 rounded-md text-xs" style={{ background:'var(--bg-surface)', border:'0.5px solid var(--border)' }}>
            <span style={{ color:'var(--txt-second)' }}>Click a team to predict · Correct finalist = <strong style={{ color:'var(--accent)' }}>5 pts</strong> · Correct winner = <strong style={{ color:'var(--gold)' }}>10 pts</strong></span>
          </div>
          {rounds.map(({round,matches})=>(
            <div key={round} className="mb-5">
              <SectionLabel className="mb-2">{ROUND_LABELS[round]||round}</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {matches.map(m=><MatchCard key={m.id} match={m} prediction={preds[m.id]} onPredict={handlePredict}/>)}
              </div>
            </div>
          ))}
        </>
      }
    </div>
  )
}
