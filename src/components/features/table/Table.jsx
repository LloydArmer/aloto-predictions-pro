import { useState, useEffect, Fragment } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { useLeaderboard, useWeeklyLeaderboard, useMonthlyLeaderboard } from '../../../hooks/useLeaderboard'
import { supabase } from '../../../lib/supabase'
import { resolvePointRules } from '../../../lib/scoring'
import { Card, SectionLabel, StatCard, Spinner, EmptyState, Select } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import { buildWeeklyMessage, buildMonthlyMessage, openWhatsApp } from '../../../lib/whatsapp'
import { format } from 'date-fns'

function Pos({ n }) {
  const colors = { 1:'var(--gold)', 2:'#b4b2a9', 3:'#f0997b' }
  return <span style={{ fontSize:12, fontWeight:500, color:colors[n]||'var(--txt-muted)' }}>{n}</span>
}

function Podium({ rankings, userId }) {
  const medals=['🥇','🥈','🥉']; const badgeV=['gold','silver','bronze']; const order=[1,0,2]
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

function OverallPane({ competitionId, userId }) {
  const { overall, loading } = useLeaderboard(competitionId)
  const [rules, setRules] = useState(null)
  const [badgesByUser, setBadgesByUser] = useState({})
  useEffect(() => { if (competitionId) load(); else { setRules(null); setBadgesByUser({}) } }, [competitionId])

  async function load() {
    const r = await resolvePointRules(supabase, competitionId)
    setRules(r)
    const { data: rows } = await supabase.from('gameweek_scores')
      .select('user_id, full_house_results, full_house_scores, gameweeks!inner(number, competition_id)')
      .eq('gameweeks.competition_id', competitionId)
      .or('full_house_results.eq.true,full_house_scores.eq.true')
    const grouped = {}
    ;(rows || []).forEach(row => {
      if (!row.gameweeks) return
      if (!grouped[row.user_id]) grouped[row.user_id] = []
      grouped[row.user_id].push(row.gameweeks.number)
    })
    setBadgesByUser(grouped)
  }

  return (
    <div>
      {loading ? <div className="flex justify-center py-20"><Spinner size="lg"/></div>
        : overall.length === 0 ? <EmptyState icon="ti-list-numbers" title="No scores yet" description="Table will populate once the first gameweek is scored"/>
        : <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="data-table w-full" style={{ minWidth:680 }}>
                <thead><tr>
                  <th style={{ width:32, paddingLeft:14 }}>#</th>
                  <th>Player</th>
                  <th style={{ width:76, textAlign:'right' }}>Correct Results</th>
                  <th style={{ width:76, textAlign:'right' }}>Correct Scores</th>
                  <th style={{ width:70, textAlign:'right' }}>Results Bonus</th>
                  <th style={{ width:66, textAlign:'right' }}>Scores Bonus</th>
                  <th style={{ width:70, textAlign:'right', paddingRight:14 }}>Total Points</th>
                </tr></thead>
                <tbody>
                  {overall.map((p,i) => {
                    const isMe = p.user_id === userId
                    const correctResults = p.correct_results || 0
                    const correctScores  = p.exact_scores || 0
                    const resultsBonusPts = (p.full_house_results_count || 0) * (rules?.full_house_results_bonus || 0)
                    const scoresBonusPts  = (p.full_house_scores_count || 0) * (rules?.full_house_scores_bonus || 0)
                    const resultPts = correctResults * (rules?.correct_result_points || 0)
                    const scorePts  = correctScores * (rules?.exact_score_points || 0)
                    const badges = badgesByUser[p.user_id] || []
                    const breakdown = [`${resultPts}pts results`, `${scorePts}pts scores`, resultsBonusPts > 0 && `${resultsBonusPts} results bonus`, scoresBonusPts > 0 && `${scoresBonusPts} scores bonus`].filter(Boolean).join(' + ')
                    return (
                      <Fragment key={p.user_id}>
                        <tr className={isMe?'highlight':''}>
                          <td style={{ paddingLeft:14 }}><Pos n={i+1}/></td>
                          <td>
                            <p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>
                              {p.display_name}{isMe&&<span className="ml-1.5 text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}
                            </p>
                          </td>
                          <td className="text-xs text-right" style={{ color:'var(--accent)' }}>{correctResults}</td>
                          <td className="text-xs text-right" style={{ color:'var(--green)' }}>{correctScores}</td>
                          <td className="text-xs text-right" style={{ color: resultsBonusPts > 0 ? 'var(--amber)' : 'var(--txt-muted)' }}>{resultsBonusPts > 0 ? `+${resultsBonusPts}` : '–'}</td>
                          <td className="text-xs text-right" style={{ color: scoresBonusPts > 0 ? '#c88bfa' : 'var(--txt-muted)' }}>{scoresBonusPts > 0 ? `+${scoresBonusPts}` : '–'}</td>
                          <td style={{ textAlign:'right', paddingRight:14 }}><span className="text-sm font-medium" style={{ color:'var(--accent)' }}>{p.total_points||0}</span></td>
                        </tr>
                        <tr className={isMe?'highlight':''}>
                          <td></td>
                          <td colSpan={6} style={{ paddingBottom: 10, paddingTop: 0 }}>
                            <div className="flex items-center justify-between flex-wrap gap-1.5">
                              <span className="text-xs" style={{ color:'var(--txt-muted)' }}>{breakdown}</span>
                              {badges.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap">
                                  {badges.map((n,j) => (
                                    <span key={j} className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background:'var(--gold-dim)', color:'var(--gold)' }}>
                                      <i className="ti ti-star-filled" style={{ fontSize:10 }} aria-hidden="true"/>{n}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
      }
      {overall.length > 0 && <p className="text-xs text-center mt-3" style={{ color:'var(--txt-muted)' }}>Your row highlighted in blue</p>}
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
          {sel?.status === 'completed' && <WinnerBanner player={{...winner, display_name:winner.profiles?.display_name}} label={`${sel?.number}`}/>}
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
  const [closedMonths, setClosedMonths] = useState([])
  useEffect(() => { if(months.length) setSel(months[months.length-1]) }, [months])
  useEffect(() => {
    if (!competitionId) { setClosedMonths([]); return }
    supabase.from('closed_months').select('month_key').eq('competition_id', competitionId)
      .then(({ data }) => setClosedMonths((data || []).map(c => c.month_key)))
  }, [competitionId])
  const winner=monthly[0]
  const isMonthClosed = sel && closedMonths.includes(sel.key)
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
          {isMonthClosed
            ? <WinnerBanner player={winner} label={sel?.label}/>
            : <div className="mb-4 p-3 rounded-md text-xs" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)', color: 'var(--txt-muted)' }}>
                {sel?.label} is still open — a winner will show once the admin closes this month.
              </div>
          }
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

function GroupStandingsPane({ competitionId, userId }) {
  const [standings, setStandings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!competitionId) { setLoading(false); return }
    setLoading(true)
    load()
  }, [competitionId])

  async function load() {
    // group_standings is a database VIEW, not a table — PostgREST's
    // automatic foreign-key embedding (profiles(display_name)) isn't
    // reliable against views, since they don't carry the same FK
    // metadata as base tables. Fetching separately and merging here
    // avoids that silently-failing join entirely.
    const { data: rows } = await supabase.from('group_standings').select('*').eq('competition_id', competitionId)
    const userIds = [...new Set((rows || []).map(r => r.user_id))]
    const { data: profs } = userIds.length ? await supabase.from('profiles').select('id, display_name').in('id', userIds) : { data: [] }
    const nameMap = {}; (profs || []).forEach(p => { nameMap[p.id] = p.display_name })
    const merged = (rows || []).map(r => ({ ...r, profiles: { display_name: nameMap[r.user_id] || 'Unknown' } }))
    const sorted = merged.sort((a,b) => b.league_points - a.league_points || b.points_diff - a.points_diff || b.points_for - a.points_for)
    setStandings(sorted); setLoading(false)
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg"/></div>
  if (!standings.length) return <EmptyState icon="ti-list-numbers" title="No group games played yet" description="The table will populate once group fixtures have results"/>

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="data-table w-full" style={{ minWidth: 560 }}>
          <thead><tr>
            <th style={{ width: 32, paddingLeft: 14 }}>#</th>
            <th>Participant</th>
            <th style={{ width: 40, textAlign: 'right' }}>P</th>
            <th style={{ width: 36, textAlign: 'right' }}>W</th>
            <th style={{ width: 36, textAlign: 'right' }}>D</th>
            <th style={{ width: 36, textAlign: 'right' }}>L</th>
            <th style={{ width: 50, textAlign: 'right' }}>PF</th>
            <th style={{ width: 50, textAlign: 'right' }}>PA</th>
            <th style={{ width: 56, textAlign: 'right' }}>Diff</th>
            <th style={{ width: 50, textAlign: 'right', paddingRight: 14 }}>Pts</th>
          </tr></thead>
          <tbody>
            {standings.map((s,i) => (
              <tr key={s.user_id} className={s.user_id === userId ? 'highlight' : ''}>
                <td style={{ paddingLeft: 14 }}><Pos n={i+1}/></td>
                <td>
                  <p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>
                    {s.profiles?.display_name}{s.user_id === userId && <span className="ml-1.5 text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}
                  </p>
                </td>
                <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{s.played}</td>
                <td className="text-xs text-right" style={{ color:'var(--green)' }}>{s.wins}</td>
                <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{s.draws}</td>
                <td className="text-xs text-right" style={{ color:'var(--red)' }}>{s.losses}</td>
                <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{s.points_for}</td>
                <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{s.points_against}</td>
                <td className="text-xs text-right" style={{ color: s.points_diff >= 0 ? 'var(--green)' : 'var(--red)' }}>{s.points_diff > 0 ? '+' : ''}{s.points_diff}</td>
                <td style={{ textAlign:'right', paddingRight:14 }}><span className="text-sm font-medium" style={{ color:'var(--accent)' }}>{s.league_points}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default function Table() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [tab, setTab] = useState('overall')
  const [gameweeks, setGameweeks] = useState([])
  const [months, setMonths] = useState([])

  useEffect(() => { if (comp) loadMeta(comp); else { setGameweeks([]); setMonths([]) } }, [comp])
  useEffect(() => {
    // Overall doesn't apply to pure Knockout competitions — if it was
    // selected and the user switches to one, fall back to Weekly rather
    // than land on a tab that's no longer shown.
    const fmt = competitions.find(c => c.id === comp)?.format
    if (fmt === 'knockout' && tab === 'overall') setTab('weekly')
  }, [comp, competitions])

  async function loadMeta(id) {
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
        {competitions.find(c=>c.id===comp)?.format !== 'knockout' && (
          <button className={`seg-btn ${tab==='overall'?'active':''}`} onClick={()=>setTab('overall')}>
            <i className="ti ti-list-numbers text-sm mr-1" aria-hidden="true"/>Overall
          </button>
        )}
        <button className={`seg-btn ${tab==='weekly'?'active':''}`} onClick={()=>setTab('weekly')}>
          <i className="ti ti-calendar-week text-sm mr-1" aria-hidden="true"/>Weekly
        </button>
        <button className={`seg-btn ${tab==='monthly'?'active':''}`} onClick={()=>setTab('monthly')}>
          <i className="ti ti-calendar-month text-sm mr-1" aria-hidden="true"/>Monthly
        </button>
      </div>
      {tab==='overall'&&comp&&competitions.find(c=>c.id===comp)?.format !== 'knockout' &&(
        competitions.find(c=>c.id===comp)?.format === 'group_knockout'
          ? <GroupStandingsPane competitionId={comp} userId={user?.id}/>
          : <OverallPane competitionId={comp} userId={user?.id}/>
      )}
      {tab==='weekly'&&comp&&<WeeklyPane competitionId={comp} gameweeks={gameweeks} userId={user?.id}/>}
      {tab==='monthly'&&comp&&<MonthlyPane competitionId={comp} months={months} userId={user?.id}/>}
    </div>
  )
}
