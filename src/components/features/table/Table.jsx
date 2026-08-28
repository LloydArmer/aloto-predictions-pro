import { useState, useEffect, Fragment } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { useLeaderboard, useMonthlyLeaderboard } from '../../../hooks/useLeaderboard'
import { supabase } from '../../../lib/supabase'
import { resolvePointRules } from '../../../lib/scoring'
import { fitName } from '../../../lib/names'
import { Card, SectionLabel, StatCard, Spinner, EmptyState, Select } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import { buildMonthlyMessage, openWhatsApp } from '../../../lib/whatsapp'
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
            {/* Truncated rather than wrapped: a long name used to push the
                points total down and leave the three podium cards misaligned. */}
            <p className="text-sm font-medium mb-0.5" title={p.display_name}
              style={{ color:'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {p.display_name}
            </p>
            {/* Rendered for everyone, blank when it isn't you, so all three
                podium cards keep their totals on the same line. */}
            <p className="text-xs font-normal mb-0.5" style={{ color:'var(--accent)', minHeight: '1em' }}>
              {p.user_id===userId ? '(you)' : '\u00a0'}
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
        <p className="text-sm font-medium" style={{ color:'var(--gold)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {player.display_name||player.profiles?.display_name} wins {label}
        </p>
        <p className="text-xs" style={{ color:'var(--amber)' }}>
          {player.exact_scores??0} exact · {player.correct_results??0} correct · {player.total_points??player.points} pts
        </p>
      </div>
    </div>
  )
}

function OverallPane({ competitionId, userId }) {
  const { overall, loading } = useLeaderboard(competitionId)
  // Season predictions are optional per competition, so the column only appears
  // where they've actually been scored.
  const hasSeasonPoints = overall.some(p => (p.season_points || 0) > 0)
  const [rules, setRules] = useState(null)
  const [badgesByUser, setBadgesByUser] = useState({})
  const [gwNumbers, setGwNumbers] = useState({})
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
      if (!grouped[row.user_id]) grouped[row.user_id] = { results: [], scores: [], all: [] }
      const g = grouped[row.user_id]
      if (row.full_house_results) g.results.push(row.gameweeks.number)
      if (row.full_house_scores)  g.scores.push(row.gameweeks.number)
      // Distinct gameweeks. An all-scores full house is also an all-results one
      // — getting every score exact means getting every result right — so the
      // same gameweek would otherwise be counted twice.
      if (!g.all.includes(row.gameweeks.number)) g.all.push(row.gameweeks.number)
    })
    setBadgesByUser(grouped)
    const { data: gws } = await supabase.from('gameweeks').select('id, number')
    const m = {}; (gws||[]).forEach(g => { m[g.id] = g.number })
    setGwNumbers(m)
  }

  return (
    <div>
      {loading ? <div className="flex justify-center py-20"><Spinner size="lg"/></div>
        : overall.length === 0 ? <EmptyState icon="ti-list-numbers" title="No scores yet" description="Table will populate once the first gameweek is scored"/>
        : <>
          {/* Mobile: no horizontal scrolling at all.
              Nine columns can't fit 390px, and the minWidth needed to hold them
              pushed Total — the one number people open this screen for — off the
              right-hand edge. So the phone gets rank, name and total, and a tap
              reveals the breakdown for that player. */}
          <div className="sm:hidden">
            <MobileOverall
              overall={overall} userId={userId} rules={rules}
              badgesByUser={badgesByUser} gwNumbers={gwNumbers} hasSeasonPoints={hasSeasonPoints}
            />
          </div>

          <Card className="overflow-hidden p-0 hidden sm:block">
            <div className="overflow-x-auto">
              <table className="data-table w-full" style={{ minWidth:900 }}>
                <thead><tr>
                  <th style={{ width:32, paddingLeft:14 }}>#</th>
                  <th>Player</th>
                  {/* Nine columns will not fit a phone. On mobile the two bonus
                      columns collapse into one combined figure, and the two chips
                      into one, leaving the player name enough width to be read
                      rather than truncated to three letters. Desktop is
                      unchanged — every column shown separately. */}
                  <th style={{ width:72, textAlign:'right' }}>Results</th>
                  <th style={{ width:72, textAlign:'right' }}>Scores</th>
                  <th className="hidden sm:table-cell" style={{ width:66, textAlign:'right' }}>Results Bonus</th>
                  <th className="hidden sm:table-cell" style={{ width:62, textAlign:'right' }}>Scores Bonus</th>
                  <th className="sm:hidden" style={{ width:52, textAlign:'right' }}>Bonus</th>
                  <th className="hidden sm:table-cell" style={{ width:80, textAlign:'right' }}>⚡ TP 1</th>
                  <th className="hidden sm:table-cell" style={{ width:80, textAlign:'right' }}>⚡ TP 2</th>
                  <th className="sm:hidden" style={{ width:44, textAlign:'right' }}>⚡</th>
                  {/* Only rendered once season points exist, so a competition
                      that doesn't run season predictions keeps the table it
                      already had. */}
                  {hasSeasonPoints && <th style={{ width:60, textAlign:'right' }}>Season</th>}
                  <th style={{ width:60, textAlign:'right', paddingRight:14 }}>Total</th>
                </tr></thead>
                <tbody>
                  {overall.map((p,i) => {
                    const isMe = p.user_id === userId
                    const correctResults = p.correct_results || 0
                    const correctScores  = p.exact_scores || 0
                    const resultsBonusPts = (p.full_house_results_count || 0) * (rules?.full_house_results_bonus || 0)
                    const scoresBonusPts  = (p.full_house_scores_count || 0) * (rules?.full_house_scores_bonus || 0)
                    const fh = badgesByUser[p.user_id] || { results: [], scores: [], all: [] }
                    const tp1Label = p.tp1_gameweek_id ? `GW${gwNumbers[p.tp1_gameweek_id]||'?'} +${p.tp1_points||0}` : '–'
                    const tp2Label = p.tp2_gameweek_id ? `GW${gwNumbers[p.tp2_gameweek_id]||'?'} +${p.tp2_points||0}` : '–'
                    return (
                      <Fragment key={p.user_id}>
                        <tr className={isMe?'highlight':''}>
                          <td style={{ paddingLeft:14 }}><Pos n={i+1}/></td>
                          <td className="name-cell">
                            <p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>
                              {p.display_name}{isMe&&<span className="ml-1.5 text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}
                            </p>
                          </td>
                          <td className="text-xs text-right" style={{ color:'var(--accent)' }}>{correctResults}</td>
                          <td className="text-xs text-right" style={{ color:'var(--green)' }}>{correctScores}</td>
                          <td className="text-xs text-right hidden sm:table-cell" style={{ color: resultsBonusPts > 0 ? 'var(--amber)' : 'var(--txt-muted)' }}>{resultsBonusPts > 0 ? `+${resultsBonusPts}` : '–'}</td>
                          <td className="text-xs text-right hidden sm:table-cell" style={{ color: scoresBonusPts > 0 ? '#c88bfa' : 'var(--txt-muted)' }}>{scoresBonusPts > 0 ? `+${scoresBonusPts}` : '–'}</td>
                          <td className="text-xs text-right sm:hidden" style={{ color: (resultsBonusPts + scoresBonusPts) > 0 ? 'var(--amber)' : 'var(--txt-muted)' }}>{(resultsBonusPts + scoresBonusPts) > 0 ? `+${resultsBonusPts + scoresBonusPts}` : '–'}</td>
                          <td className="text-xs text-right hidden sm:table-cell" style={{ color: p.tp1_gameweek_id ? 'var(--gold)' : 'var(--txt-muted)' }}>{tp1Label}</td>
                          <td className="text-xs text-right hidden sm:table-cell" style={{ color: p.tp2_gameweek_id ? 'var(--gold)' : 'var(--txt-muted)' }}>{tp2Label}</td>
                          {/* Chips played, as a count — the gameweek detail is on
                              the wider layout and in the gameweek view. */}
                          <td className="text-xs text-right sm:hidden" style={{ color: (p.tp1_gameweek_id || p.tp2_gameweek_id) ? 'var(--gold)' : 'var(--txt-muted)' }}>
                            {(p.tp1_gameweek_id ? 1 : 0) + (p.tp2_gameweek_id ? 1 : 0) || '–'}
                          </td>
                          {hasSeasonPoints && (
                            <td className="text-xs text-right" style={{ color: p.season_points > 0 ? 'var(--gold)' : 'var(--txt-muted)' }}>
                              {p.season_points > 0 ? `+${p.season_points}` : '–'}
                            </td>
                          )}
                          <td style={{ textAlign:'right', paddingRight:14 }}><span className="text-sm font-medium" style={{ color:'var(--accent)' }}>{p.total_points||0}</span></td>
                        </tr>
                        {fh.all.length > 0 && (
                          <tr className={isMe?'highlight':''}>
                            <td></td>
                            <td colSpan={8} style={{ paddingBottom: 8, paddingTop: 0 }}>
                              {/* Labelled by type, so the gameweeks tie to the
                                  Results Bonus and Scores Bonus columns above
                                  rather than floating free of them. */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {fh.results.length > 0 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                                    style={{ background:'var(--amber-dim)', color:'var(--amber)' }}>
                                    <i className="ti ti-star-filled" style={{ fontSize:10 }} aria-hidden="true"/>
                                    All results: {fh.results.join(', ')}
                                  </span>
                                )}
                                {fh.scores.length > 0 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                                    style={{ background:'rgba(200,139,250,0.14)', color:'#c88bfa' }}>
                                    <i className="ti ti-star-filled" style={{ fontSize:10 }} aria-hidden="true"/>
                                    All scores: {fh.scores.join(', ')}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          </>
      }
      {overall.length > 0 && <p className="text-xs text-center mt-3" style={{ color:'var(--txt-muted)' }}>Your row highlighted in blue</p>}
    </div>
  )
}

// Monthly view for Group + Knockout. The month picker sits here; the table
// itself is the same group standings component, scoped to the chosen month —
// the prediction-points monthly table is the wrong shape for this format, since
// group placings are decided by head-to-head results, not points totals.
function GroupMonthlyPane({ competitionId, months, userId }) {
  const [sel, setSel] = useState(months[months.length-1] || null)
  useEffect(() => { if (months.length) setSel(months[months.length-1]) }, [months])
  return (
    <div>
      <Select value={sel?.key || ''} onChange={e => setSel(months.find(m => m.key === e.target.value) || null)} className="mb-4" style={{ maxWidth: 200 }}>
        {[...months].reverse().map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
      </Select>
      <SectionLabel className="mb-2">{sel?.label} group standings</SectionLabel>
      <GroupStandingsPane competitionId={competitionId} userId={userId} monthKey={sel?.key || null}/>
    </div>
  )
}

function MonthlyPane({ competitionId, months, userId }) {
  const [sel, setSel] = useState(months[months.length-1]||null)
  const { monthly, gameweeksInMonth, loading } = useMonthlyLeaderboard(competitionId, sel?.key)
  const [closedMonths, setClosedMonths] = useState([])
  const [tpPlaysByUser, setTpPlaysByUser] = useState({})
  // Needed to turn full house COUNTS into points, same as the overall table.
  const [rules, setRules] = useState(null)
  useEffect(() => { if(months.length) setSel(months[months.length-1]) }, [months])
  useEffect(() => {
    if (!competitionId) { setClosedMonths([]); return }
    supabase.from('closed_months').select('month_key').eq('competition_id', competitionId)
      .then(({ data }) => setClosedMonths((data || []).map(c => c.month_key)))
    supabase.from('triple_points_plays').select('user_id, gameweek_id').eq('competition_id', competitionId)
      .then(({ data }) => {
        const m = {}
        ;(data||[]).forEach(p => { if (!m[p.user_id]) m[p.user_id] = []; m[p.user_id].push(p.gameweek_id) })
        setTpPlaysByUser(m)
      })
    resolvePointRules(supabase, competitionId).then(setRules)
  }, [competitionId])
  const winner = monthly[0]
  const isMonthClosed = sel && closedMonths.includes(sel.key)
  const completedGWs = gameweeksInMonth.filter(g=>g.status==='completed')
  const winnerUsedTp = winner && (tpPlaysByUser[winner.user_id] || []).some(gwId => gameweeksInMonth.some(g => g.id === gwId))
  return (
    <div>
      <Select value={sel?.key || ''} onChange={e => setSel(months.find(m => m.key === e.target.value) || null)} className="mb-4" style={{ maxWidth: 200 }}>
        {[...months].reverse().map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
      </Select>
      <Card raised className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium" style={{ color:'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sel?.label} — gameweeks</p>
          <span className="text-xs" style={{ color: completedGWs.length===gameweeksInMonth.length&&gameweeksInMonth.length>0?'var(--green)':'var(--amber)' }}>
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
          {gameweeksInMonth.length} gameweek{gameweeksInMonth.length!==1?'s':''} · {completedGWs.length} complete
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
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <StatCard label="Current leader" value={winner?.display_name?.split(' ')[0]||'—'} sub={`${winner?.total_points||0} pts${winnerUsedTp?' ⚡':''}`}/>
            <StatCard label="Your position" value={`#${monthly.findIndex(p=>p.user_id===userId)+1||'—'}`} sub={`${monthly.find(p=>p.user_id===userId)?.total_points||0} pts`}/>
          </div>
          <Podium rankings={monthly.slice(0,3)} userId={userId}/>
          <SectionLabel className="mb-2">Full monthly standings</SectionLabel>
          <Card className="overflow-hidden p-0 mb-4">
            <div className="overflow-x-auto">
              {/* min-width applies from sm upward only. On a phone the columns
                  already collapse to fit; forcing 400px just reintroduced the
                  sideways scroll they were collapsed to avoid. */}
              <table className="data-table w-full sm:min-w-[400px]">
                <thead><tr>
                  <th style={{ width:36,paddingLeft:14 }}>#</th><th>Player</th>
                  <th style={{ width:44,textAlign:'right',fontSize:10 }}>Res</th>
                  <th style={{ width:44,textAlign:'right',fontSize:10 }}>Exact</th>
                  <th className="hidden sm:table-cell" style={{ width:52,textAlign:'right',fontSize:10 }}>FH Res</th>
                  <th className="hidden sm:table-cell" style={{ width:52,textAlign:'right',fontSize:10 }}>FH Sc</th>
                  <th className="sm:hidden" style={{ width:48,textAlign:'right',fontSize:10 }}>Bonus</th>
                  <th style={{ width:80,textAlign:'right',fontSize:10 }}>⚡ TP</th>
                  <th style={{ width:54,textAlign:'right',paddingRight:14 }}>Total</th>
                </tr></thead>
                <tbody>
                  {monthly.map((p,i)=>{
                    // Triple Points played on a gameweek within THIS month, with
                    // the points it earned — the overall table shows this per
                    // chip, so the monthly view shows whichever fell in the month.
                    const tpGwThisMonth = (tpPlaysByUser[p.user_id] || [])
                      .filter(gwId => gameweeksInMonth.some(g => g.id === gwId))
                    const tpLabel = tpGwThisMonth.length
                      ? tpGwThisMonth.map(gwId => {
                          const gw = gameweeksInMonth.find(g => g.id === gwId)
                          // Middle dot rather than a space: keeps it to one line
                          // in a narrow column on a phone.
                          return `${gw?.number || 'GW?'}\u00b7${p.gw_breakdown?.[gwId] ?? 0}`
                        }).join(', ')
                      : '\u2013'
                    const resultsBonusPts = (p.full_house_results_count || 0) * (rules?.full_house_results_bonus || 0)
                    const scoresBonusPts  = (p.full_house_scores_count  || 0) * (rules?.full_house_scores_bonus  || 0)
                    return (
                    <tr key={p.user_id} className={p.user_id===userId?'highlight':''}>
                      <td style={{ paddingLeft:14 }}><span style={{ fontSize:12,fontWeight:500,color:i===0?'var(--gold)':i===1?'#b4b2a9':i===2?'#f0997b':'var(--txt-muted)' }}>{i+1}</span></td>
                      <td className="name-cell"><p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>{p.display_name}{p.user_id===userId&&<span className="ml-1 text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}</p></td>
                      <td className="text-xs text-right" style={{ color:'var(--accent)' }}>{p.correct_results||0}</td>
                      <td className="text-xs text-right" style={{ color:'var(--green)' }}>{p.exact_scores||0}</td>
                      <td className="text-xs text-right hidden sm:table-cell" style={{ color: resultsBonusPts>0?'var(--amber)':'var(--txt-muted)' }}>{resultsBonusPts>0?`+${resultsBonusPts}`:'\u2013'}</td>
                      <td className="text-xs text-right hidden sm:table-cell" style={{ color: scoresBonusPts>0?'#c88bfa':'var(--txt-muted)' }}>{scoresBonusPts>0?`+${scoresBonusPts}`:'\u2013'}</td>
                      <td className="text-xs text-right sm:hidden" style={{ color: (resultsBonusPts+scoresBonusPts)>0?'var(--amber)':'var(--txt-muted)' }}>{(resultsBonusPts+scoresBonusPts)>0?`+${resultsBonusPts+scoresBonusPts}`:'\u2013'}</td>
                      <td className="text-xs text-right" style={{ color: tpGwThisMonth.length?'var(--gold)':'var(--txt-muted)' }}>{tpLabel}</td>
                      <td style={{ textAlign:'right',paddingRight:14 }}><span className="text-sm font-medium" style={{ color:'var(--accent)' }}>{p.total_points}</span></td>
                    </tr>
                  )})}
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

// Group-stage league table. With no monthKey this is the all-time table; with
// one it is rebuilt from just that month's group fixtures.
//
// The month-scoped version can't use the group_standings view — the view
// aggregates every fixture in the competition and has no month to filter on —
// so it recomputes the same figures from group_fixtures directly.
/**
 * The overall table on a phone.
 *
 * Three things on the closed row — position, name, total — because that is what
 * a standings table is for. Everything else is one tap away rather than one
 * sideways scroll away, and a tap is far easier to discover: a horizontally
 * scrolling table gives no hint that anything exists to the right of it.
 */
function MobileOverall({ overall, userId, rules, badgesByUser, gwNumbers, hasSeasonPoints }) {
  const [expanded, setExpanded] = useState(null)

  return (
    <div>
      {/* Column labels. The list dropped the table's headings along with the
          table, leaving a bare number on the right with nothing to say what it
          was. Aligned to the same padding as the rows below. */}
      <div className="flex items-center gap-3 px-3 pb-1.5">
        <span className="flex-shrink-0" style={{ width: 20 }}>
          <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>#</span>
        </span>
        <span style={{ flex: '1 1 auto' }}>
          <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>Player</span>
        </span>
        <span className="text-xs flex-shrink-0 text-right" style={{ color: 'var(--txt-muted)', minWidth: 46 }}>Pts</span>
        {/* Matches the chevron's width so "Pts" sits over the number, not over
            the chevron. */}
        <span className="flex-shrink-0" style={{ width: 13 }} aria-hidden="true"/>
      </div>

      {overall.map((p, i) => {
        const isMe = p.user_id === userId
        // One open at a time. A set would let every card be expanded at once,
        // turning a six-row standings table into a page of scrolling — which is
        // the problem this layout exists to solve.
        const open = expanded === p.user_id
        const resultsBonusPts = (p.full_house_results_count || 0) * (rules?.full_house_results_bonus || 0)
        const scoresBonusPts  = (p.full_house_scores_count  || 0) * (rules?.full_house_scores_bonus  || 0)
        const fh = badgesByUser[p.user_id] || { results: [], scores: [], all: [] }

        // A full house and its bonus are one event, not two. Showing "Results
        // bonus +15" on one line and "Full houses: GW3, GW7" on another
        // described the same thing twice and made it look like separate
        // scoring. Each line now names the achievement, which gameweeks, and
        // what it was worth.
        const detail = [
          ['Correct results', p.correct_results || 0, 'var(--accent)'],
          ['Correct scores',  p.exact_scores || 0,    'var(--green)'],
          ...(fh.results.length ? [[
            `Full house — all results (${fh.results.length})`,
            `${fh.results.join(', ')}  +${resultsBonusPts}`,
            'var(--amber)',
          ]] : []),
          ...(fh.scores.length ? [[
            `Full house — all scores (${fh.scores.length})`,
            `${fh.scores.join(', ')}  +${scoresBonusPts}`,
            '#c88bfa',
          ]] : []),
          ...(p.tp1_gameweek_id ? [['Triple Points 1', `GW${gwNumbers[p.tp1_gameweek_id] || '?'} +${p.tp1_points || 0}`, 'var(--gold)']] : []),
          ...(p.tp2_gameweek_id ? [['Triple Points 2', `GW${gwNumbers[p.tp2_gameweek_id] || '?'} +${p.tp2_points || 0}`, 'var(--gold)']] : []),
          ...(hasSeasonPoints && p.season_points > 0 ? [['Season predictions', `+${p.season_points}`, 'var(--gold)']] : []),
        ]

        return (
          <Card key={p.user_id} className="mb-2 p-0 overflow-hidden"
            style={isMe ? { borderColor: 'var(--accent)', background: 'var(--accent-dim)' } : {}}>
            <button onClick={() => setExpanded(open ? null : p.user_id)}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-left">
              <span className="flex-shrink-0" style={{ width: 20 }}><Pos n={i + 1}/></span>

              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span className="text-sm font-medium block" style={{ color: 'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {p.display_name}{isMe && <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--accent)' }}>(you)</span>}
                  {/* A COUNT, not one chip per full house. Someone with a good
                      season could have a dozen, and a dozen chips would push the
                      name off the row entirely. The gameweeks themselves are in
                      the expanded detail, where there's room for them. */}
                  {fh.all.length > 0 && (
                    <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded"
                      title={`${fh.all.length} full house${fh.all.length !== 1 ? 's' : ''}`}
                      style={{ background: 'var(--gold-dim)', color: 'var(--gold)', whiteSpace: 'nowrap' }}>
                      ★ {fh.all.length}
                    </span>
                  )}
                </span>
              </span>

              {/* Fixed width and tabular figures so every total occupies the
                  same space and the digits line up down the column — otherwise
                  a 96 and a 186 sit at different offsets and look like
                  different sizes. */}
              <span className="text-base font-semibold flex-shrink-0 text-right"
                style={{ color: 'var(--accent)', minWidth: 46, fontVariantNumeric: 'tabular-nums' }}>
                {p.total_points || 0}
              </span>
              <i className={`ti ti-chevron-${open ? 'up' : 'down'} text-sm flex-shrink-0`}
                style={{ color: 'var(--txt-muted)' }} aria-hidden="true"/>
            </button>

            {open && (
              <div className="px-3 pb-3" style={{ borderTop: '0.5px solid var(--border)' }}>
                {detail.map(([label, value, colour]) => (
                  <div key={label} className="flex items-start justify-between gap-3 py-1.5">
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--txt-muted)' }}>{label}</span>
                    {/* Wraps rather than truncating — a long list of gameweeks
                        here means a good season, and is worth reading. */}
                    <span className="text-xs font-medium text-right" style={{ color: colour }}>{value}</span>
                  </div>
                ))}

              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function GroupStandingsPane({ competitionId, userId, monthKey = null }) {
  const [standings, setStandings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!competitionId) { setLoading(false); return }
    setLoading(true)
    if (monthKey) loadForMonth(); else load()
  }, [competitionId, monthKey])

  async function withNames(rows) {
    const userIds = [...new Set(rows.map(r => r.user_id))]
    const { data: profs } = userIds.length ? await supabase.from('profiles').select('id, display_name').in('id', userIds) : { data: [] }
    const nameMap = {}; (profs || []).forEach(p => { nameMap[p.id] = p.display_name })
    return rows.map(r => ({ ...r, profiles: { display_name: nameMap[r.user_id] || 'Unknown' } }))
  }

  // Same columns as the all-time table, counting only group fixtures whose
  // gameweek falls in the selected month. points_for / points_against are the
  // prediction points the two participants scored in that head-to-head.
  async function loadForMonth() {
    const { data: fixtures } = await supabase.from('group_fixtures')
      .select('home_user_id, away_user_id, home_points, away_points, result, gameweeks!inner(month_key)')
      .eq('competition_id', competitionId)
      .eq('status', 'completed')
      .eq('gameweeks.month_key', monthKey)

    const tally = {}
    const seed = uid => {
      if (!tally[uid]) tally[uid] = { user_id: uid, played: 0, wins: 0, draws: 0, losses: 0, points_for: 0, points_against: 0, points_diff: 0, league_points: 0 }
      return tally[uid]
    }

    for (const fx of (fixtures || [])) {
      const home = seed(fx.home_user_id), away = seed(fx.away_user_id)
      const hp = fx.home_points || 0, ap = fx.away_points || 0
      home.played++; away.played++
      home.points_for += hp; home.points_against += ap
      away.points_for += ap; away.points_against += hp
      if (fx.result === 'home')      { home.wins++;  away.losses++; home.league_points += 3 }
      else if (fx.result === 'away') { away.wins++;  home.losses++; away.league_points += 3 }
      else                           { home.draws++; away.draws++;  home.league_points++; away.league_points++ }
    }

    const rows = Object.values(tally)
    rows.forEach(r => { r.points_diff = r.points_for - r.points_against })
    const merged = await withNames(rows)
    setStandings(merged.sort((a,b) => b.league_points - a.league_points || b.points_diff - a.points_diff || b.points_for - a.points_for))
    setLoading(false)
  }

  async function load() {
    // group_standings is a database VIEW, not a table — PostgREST's
    // automatic foreign-key embedding (profiles(display_name)) isn't
    // reliable against views, since they don't carry the same FK
    // metadata as base tables. Fetching separately and merging here
    // avoids that silently-failing join entirely.
    const { data: rows } = await supabase.from('group_standings').select('*').eq('competition_id', competitionId)
    const merged = await withNames(rows || [])
    const sorted = merged.sort((a,b) => b.league_points - a.league_points || b.points_diff - a.points_diff || b.points_for - a.points_for)
    setStandings(sorted); setLoading(false)
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg"/></div>
  if (!standings.length) return <EmptyState icon="ti-list-numbers" title={monthKey ? 'No group games this month' : 'No group games played yet'} description={monthKey ? 'Group fixtures assigned to a gameweek this month will appear here once resolved' : 'The table will populate once group fixtures have results'}/>

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        {/* Eight numeric columns can't be collapsed without losing the point of
            a league table, so this one still scrolls — but the name column is
            pinned, so a row of numbers always has a player attached to it. */}
        <table className="data-table w-full" style={{ minWidth: 560 }}>
          <thead><tr>
            <th className="sticky-col" style={{ width: 118, paddingLeft: 12 }}>Participant</th>
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
                {/* Position folded into the pinned cell — a separate # column
                    would eat a third of the width that stays on screen. */}
                <td className="sticky-col" style={{ paddingLeft: 12, maxWidth: 0 }}>
                  {/* Shortened, and no "(you)" label — the row is already
                      highlighted in blue, so the label was costing four
                      characters to repeat something you can see. That's what
                      pushed "Lloyd Armer (you)" into "Lloyd Armer (…". */}
                  <p className="text-sm font-medium" title={s.profiles?.display_name}
                    style={{ color:'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    <span className="mr-1.5" style={{ color:'var(--txt-muted)', fontSize:11 }}>{i+1}</span>
                    {fitName(s.profiles?.display_name)}
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

/**
 * @param embeddedView  when set, this renders inside Standings: its own
 *                      competition selector and Overall/Monthly switch are
 *                      suppressed, because the parent already provides both.
 *                      Standalone use (no prop) is unchanged.
 */
export default function Table({ embeddedView = null }) {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [ownTab, setTab] = useState('overall')
  const embedded = embeddedView !== null
  const tab = embedded ? embeddedView : ownTab
  const [gameweeks, setGameweeks] = useState([])
  const [months, setMonths] = useState([])
  const compFmt = competitions.find(c => c.id === comp)?.format

  useEffect(() => { if (comp) loadMeta(comp); else { setGameweeks([]); setMonths([]) } }, [comp])
  useEffect(() => {
    // If the current tab no longer applies when switching competition, fall back safely
    if (compFmt === 'knockout') setTab('monthly')
  }, [comp, compFmt])

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

  // Pure Knockout — no table concept applies
  if (compFmt === 'knockout') return (
    <div>
      {!embedded && <CompetitionSelector value={comp} onChange={setComp}/>}
      <EmptyState icon="ti-list-numbers" title="No table for Knockout competitions" description="Open the Cup tab to see the bracket and results"/>
    </div>
  )

  return (
    <div>
      {!embedded && <CompetitionSelector value={comp} onChange={setComp}/>}
      {!embedded && (
        <div className="seg-control mb-5">
          <button className={`seg-btn ${tab==='overall'?'active':''}`} onClick={()=>setTab('overall')}>
            <i className="ti ti-list-numbers text-sm mr-1" aria-hidden="true"/>Overall
          </button>
          <button className={`seg-btn ${tab==='monthly'?'active':''}`} onClick={()=>setTab('monthly')}>
            <i className="ti ti-calendar-month text-sm mr-1" aria-hidden="true"/>Monthly
          </button>
        </div>
      )}
      {tab==='overall'&&comp&&(
        compFmt === 'group_knockout'
          ? <GroupStandingsPane competitionId={comp} userId={user?.id}/>
          : <OverallPane competitionId={comp} userId={user?.id}/>
      )}
      {tab==='monthly'&&comp&&(
        compFmt === 'group_knockout'
          ? <GroupMonthlyPane competitionId={comp} months={months} userId={user?.id}/>
          : <MonthlyPane competitionId={comp} months={months} userId={user?.id}/>
      )}
    </div>
  )
}
