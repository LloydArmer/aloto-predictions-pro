import { useState, useEffect, Fragment } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useLeaderboard } from '../../../hooks/useLeaderboard'
import { supabase } from '../../../lib/supabase'
import { Card, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'

function Pos({ n }) {
  const colors = { 1:'var(--gold)', 2:'#b4b2a9', 3:'#f0997b' }
  return <span style={{ fontSize:12, fontWeight:500, color:colors[n]||'var(--txt-muted)' }}>{n}</span>
}

export default function Table() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useState(null)
  const { overall, loading } = useLeaderboard(comp)
  const [rules, setRules] = useState(null)
  const [badgesByUser, setBadgesByUser] = useState({})
  useEffect(() => { if (competitions.length && !comp) setComp(competitions[0]?.id) }, [competitions])
  useEffect(() => { if (comp) load(); else { setRules(null); setBadgesByUser({}) } }, [comp])

  async function load() {
    const { data: r } = await supabase.from('point_rules').select('*').eq('competition_id', comp).maybeSingle()
    setRules(r)

    const { data: rows } = await supabase.from('gameweek_scores')
      .select('user_id, full_house_results, full_house_scores, gameweeks!inner(number, competition_id)')
      .eq('gameweeks.competition_id', comp)
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
      <CompetitionSelector value={comp} onChange={setComp}/>

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
                    const isMe = p.user_id === user?.id
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
      <p className="text-xs text-center mt-3" style={{ color:'var(--txt-muted)' }}>Your row highlighted in blue</p>
    </div>
  )
}
