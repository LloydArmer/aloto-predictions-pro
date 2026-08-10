import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { useWeeklyLeaderboard, useMonthlyLeaderboard } from '../../../hooks/useLeaderboard'
import { supabase } from '../../../lib/supabase'
import { Card, SectionLabel, StatCard, Spinner, EmptyState, Badge, Select } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import { buildWeeklyMessage, buildMonthlyMessage, openWhatsApp } from '../../../lib/whatsapp'
import { format } from 'date-fns'

function Podium({ rankings, userId }) {
  const medals=['🥇','🥈','🥉']; const ptColors=['var(--gold)','#b4b2a9','#f0997b']
  const badgeV=['gold','silver','bronze']; const order=[1,0,2]
  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      {order.map(i => {
        const p=rankings[i]; if(!p) return <div key={i}/>
        return (
          <div key={p.user_id} className={`podium-card ${i===0?'first':''}`}>
            <div className="text-xl mb-1">{medals[i]}</div>
            <div className="mb-1.5"><span className={`badge badge-${badgeV[i]}`}>{i+1}{i===0?'st':i===1?'nd':'rd'}</span></div>
            <p className="text-sm font-medium mb-0.5" style={{ color:'var(--txt-primary)' }}>
              {p.display_name}{p.user_id===userId&&<span className="block text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}
            </p>
            <p className="text-xl font-medium" style={{ color:i===0?'var(--gold)':'var(--accent)' }}>{p.total_points??p.points}</p>
            <p className="text-xs mt-0.5" style={{ color:'var(--txt-muted)' }}>pts</p>
          </div>
        )
      })}
    </div>
  )
}

function WinnerBanner({ player, label }) {
  if (!player) return null
  return (
    <div className="winner-banner mb-4">
      <i className="ti ti-crown text-2xl flex-shrink-0" style={{ color:'var(--gold)' }} aria-hidden="true"/>
      <div>
        <p className="text-sm font-medium" style={{ color:'var(--gold)' }}>{player.display_name||player.profiles?.display_name} wins {label}</p>
        <p className="text-xs" style={{ color:'var(--amber)' }}>
          {player.exact_scores??0} exact · {player.correct_results??0} correct · {player.total_points??player.points} pts
        </p>
      </div>
    </div>
  )
}

function WeeklyPane({ competitionId, gameweeks, userId }) {
  const [sel, setSel] = useState(gameweeks[gameweeks.length-1]||null)
  const { weekly, loading } = useWeeklyLeaderboard(competitionId, sel?.id)
  useEffect(() => { if(gameweeks.length) setSel(gameweeks[gameweeks.length-1]) }, [gameweeks])
  const winner = weekly[0]
  return (
    <div>
      <Select value={sel?.id || ''} onChange={e => setSel(gameweeks.find(g => g.id === e.target.value) || null)} className="mb-4" style={{ maxWidth: 200 }}>
        {[...gameweeks].reverse().map(gw => <option key={gw.id} value={gw.id}>{gw.number}</option>)}
      </Select>
      {loading ? <div className="flex justify-center py-16"><Spinner size="lg"/></div>
        : weekly.length===0 ? <EmptyState icon="ti-medal" title="No scores yet" description="Scores appear after each gameweek is completed"/>
        : <>
          <WinnerBanner player={{...winner, display_name:winner.profiles?.display_name}} label={`${sel?.number}`}/>
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            <StatCard label="Highest score" value={weekly[0]?.points||0} sub={weekly[0]?.profiles?.display_name}/>
            <StatCard label="Avg score" value={Math.round(weekly.reduce((a,b)=>a+(b.points||0),0)/weekly.length)} sub={`${weekly.length} players`}/>
            <StatCard label="Exact scores" value={weekly.reduce((a,b)=>a+(b.exact_scores||0),0)} sub="total this GW"/>
          </div>
          <SectionLabel className="mb-2">{sel?.number} rankings</SectionLabel>
          <Card className="overflow-hidden p-0 mb-4">
            <div className="overflow-x-auto">
            <table className="data-table w-full" style={{ minWidth:400 }}>
              <thead><tr>
                <th style={{ width:36,paddingLeft:14 }}>#</th><th>Player</th>
                <th style={{ width:52,textAlign:'right' }}>Exact</th>
                <th style={{ width:56,textAlign:'right' }}>Result</th>
                <th style={{ width:54,textAlign:'right',paddingRight:14 }}>Pts</th>
              </tr></thead>
              <tbody>
                {weekly.map((p,i)=>(
                  <tr key={p.user_id} className={p.user_id===userId?'highlight':''}>
                    <td style={{ paddingLeft:14 }}><span style={{ fontSize:12,fontWeight:500,color:i===0?'var(--gold)':i===1?'#b4b2a9':i===2?'#f0997b':'var(--txt-muted)' }}>{i+1}</span></td>
                    <td><p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>{p.profiles?.display_name||'Player'}{p.user_id===userId&&<span className="ml-1 text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}</p></td>
                    <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{p.exact_scores||0}</td>
                    <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{p.correct_results||0}</td>
                    <td style={{ textAlign:'right',paddingRight:14 }}><span className="text-sm font-medium" style={{ color:'var(--accent)' }}>{p.points}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
          <button className="wa-btn" onClick={()=>openWhatsApp(buildWeeklyMessage(sel,weekly.map(w=>({display_name:w.profiles?.display_name||'Player',points:w.points})),window.location.origin))}>
            <i className="ti ti-brand-whatsapp text-base" aria-hidden="true"/>Share {sel?.number} results to WhatsApp
          </button>
        </>
      }
    </div>
  )
}

function MonthlyPane({ competitionId, months, userId }) {
  const [sel, setSel] = useState(months[months.length-1]||null)
  const { monthly, gameweeksInMonth, loading } = useMonthlyLeaderboard(competitionId, sel?.key)
  useEffect(() => { if(months.length) setSel(months[months.length-1]) }, [months])
  const winner=monthly[0]
  const completedGWs=gameweeksInMonth.filter(g=>g.status==='completed')
  const upcomingGWs=gameweeksInMonth.filter(g=>g.status==='upcoming')
  return (
    <div>
      <Select value={sel?.key || ''} onChange={e => setSel(months.find(m => m.key === e.target.value) || null)} className="mb-4" style={{ maxWidth: 200 }}>
        {[...months].reverse().map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
      </Select>
      <Card raised className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>{sel?.label} — gameweeks</p>
          <span className="text-xs" style={{ color:upcomingGWs.length===0&&completedGWs.length>0?'var(--green)':'var(--amber)' }}>
            {completedGWs.length===gameweeksInMonth.length&&gameweeksInMonth.length>0?'Complete':'In progress'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {gameweeksInMonth.map(gw=>(
            <span key={gw.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded"
              style={{ background:gw.status==='completed'?'var(--green-dim)':gw.status==='active'?'var(--amber-dim)':'var(--bg-elevated)', color:gw.status==='completed'?'var(--green)':gw.status==='active'?'var(--amber)':'var(--txt-muted)' }}>
              {gw.status==='completed'&&<i className="ti ti-check" style={{ fontSize:10 }}/>}
              {gw.status==='active'&&<i className="ti ti-player-play" style={{ fontSize:10 }}/>}
              {gw.status==='upcoming'&&<i className="ti ti-clock" style={{ fontSize:10 }}/>}
              {gw.number}
            </span>
          ))}
          {gameweeksInMonth.length===0&&<span className="text-xs" style={{ color:'var(--txt-muted)' }}>No gameweeks assigned yet</span>}
        </div>
        <p className="text-xs" style={{ color:'var(--txt-muted)' }}>
          {gameweeksInMonth.length} gameweek{gameweeksInMonth.length!==1?'s':''} · {completedGWs.length} complete{upcomingGWs.length>0?` · ${upcomingGWs.length} remaining`:''}
        </p>
      </Card>
      {loading ? <div className="flex justify-center py-16"><Spinner size="lg"/></div>
        : monthly.length===0 ? <EmptyState icon="ti-calendar" title="No scores yet" description="Monthly scores accumulate as gameweeks complete"/>
        : <>
          <WinnerBanner player={winner} label={sel?.label}/>
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            <StatCard label="Current leader" value={winner?.display_name?.split(' ')[0]||'—'} sub={`${winner?.total_points||0} pts`}/>
            <StatCard label="Your position" value={`#${monthly.findIndex(p=>p.user_id===userId)+1||'—'}`} sub={`${monthly.find(p=>p.user_id===userId)?.total_points||0} pts`}/>
            <StatCard label="GWs remaining" value={upcomingGWs.length} sub="still to play"/>
          </div>
          <Podium rankings={monthly.slice(0,3)} userId={userId}/>
          <SectionLabel className="mb-2">Full monthly standings</SectionLabel>
          <Card className="overflow-hidden p-0 mb-4">
            <div className="overflow-x-auto">
              <table className="data-table w-full" style={{ minWidth:400 }}>
                <thead><tr>
                  <th style={{ width:36,paddingLeft:14 }}>#</th><th>Player</th>
                  {gameweeksInMonth.map(gw=><th key={gw.id} style={{ width:40,textAlign:'right',fontSize:10 }}>{gw.number}</th>)}
                  <th style={{ width:54,textAlign:'right',paddingRight:14 }}>Total</th>
                </tr></thead>
                <tbody>
                  {monthly.map((p,i)=>(
                    <tr key={p.user_id} className={p.user_id===userId?'highlight':''}>
                      <td style={{ paddingLeft:14 }}><span style={{ fontSize:12,fontWeight:500,color:i===0?'var(--gold)':i===1?'#b4b2a9':i===2?'#f0997b':'var(--txt-muted)' }}>{i+1}</span></td>
                      <td><p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>{p.display_name}{p.user_id===userId&&<span className="ml-1 text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}</p></td>
                      {gameweeksInMonth.map(gw=><td key={gw.id} className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{p.gw_breakdown?.[gw.id]??'—'}</td>)}
                      <td style={{ textAlign:'right',paddingRight:14 }}><span className="text-sm font-medium" style={{ color:'var(--accent)' }}>{p.total_points}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <button className="wa-btn" onClick={()=>openWhatsApp(buildMonthlyMessage(sel?.label,monthly,gameweeksInMonth.length,window.location.origin))}>
            <i className="ti ti-brand-whatsapp text-base" aria-hidden="true"/>Share {sel?.label} standings to WhatsApp
          </button>
        </>
      }
    </div>
  )
}

export default function Leaderboards() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [mode, setMode] = useState('weekly')
  const [gameweeks, setGameweeks] = useState([])
  const [months, setMonths] = useState([])
  useEffect(() => { if(comp) loadMeta(comp) }, [comp])

  async function loadMeta(id) {
    // Gameweeks linked to this competition — whether created here or linked
    // in from another competition — via the join table, not just ones
    // originally created under this competition_id.
    const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', id)
    const gwIds = (links || []).map(l => l.gameweek_id)
    const { data: gws } = gwIds.length
      ? await supabase.from('gameweeks').select('*').in('id', gwIds).in('status',['completed','active']).order('number')
      : { data: [] }
    setGameweeks(gws||[])
    const keys = [...new Set((gws||[]).map(g=>g.month_key).filter(Boolean))]
    setMonths(keys.map(k=>({ key:k, label:format(new Date(k+'-01'),'MMM yyyy') })))
  }

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp}/>
      <div className="seg-control mb-5">
        <button className={`seg-btn ${mode==='weekly'?'active':''}`} onClick={()=>setMode('weekly')}>
          <i className="ti ti-calendar-week text-sm mr-1" aria-hidden="true"/>Weekly top scores
        </button>
        <button className={`seg-btn ${mode==='monthly'?'active':''}`} onClick={()=>setMode('monthly')}>
          <i className="ti ti-calendar-month text-sm mr-1" aria-hidden="true"/>Monthly top scores
        </button>
      </div>
      {mode==='weekly'&&comp&&<WeeklyPane competitionId={comp} gameweeks={gameweeks} userId={user?.id}/>}
      {mode==='monthly'&&comp&&<MonthlyPane competitionId={comp} months={months} userId={user?.id}/>}
    </div>
  )
}
