import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useLeaderboard } from '../../../hooks/useLeaderboard'
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
  useEffect(() => { if (competitions.length && !comp) setComp(competitions[0]?.id) }, [competitions])

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp}/>
      {loading ? <div className="flex justify-center py-20"><Spinner size="lg"/></div>
        : overall.length === 0 ? <EmptyState icon="ti-list-numbers" title="No scores yet" description="Table will populate once the first gameweek is scored"/>
        : <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="data-table w-full" style={{ minWidth:640 }}>
                <thead><tr>
                  <th style={{ width:32, paddingLeft:14 }}>#</th>
                  <th>Player</th>
                  <th style={{ width:36, textAlign:'right' }}>P</th>
                  <th style={{ width:64, textAlign:'right' }}>Pts for Results</th>
                  <th style={{ width:60, textAlign:'right' }}>Correct Scores</th>
                  <th style={{ width:56, textAlign:'right' }}>FH Results</th>
                  <th style={{ width:52, textAlign:'right' }}>FH Scores</th>
                  <th style={{ width:56, textAlign:'right', paddingRight:14 }}>Pts</th>
                </tr></thead>
                <tbody>
                  {overall.map((p,i) => {
                    const isMe = p.user_id === user?.id
                    return (
                      <tr key={p.user_id} className={isMe?'highlight':''}>
                        <td style={{ paddingLeft:14 }}><Pos n={i+1}/></td>
                        <td>
                          <p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>
                            {p.display_name}{isMe&&<span className="ml-1.5 text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}
                          </p>
                        </td>
                        <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{p.games_played||0}</td>
                        <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{p.correct_results||0}</td>
                        <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{p.exact_scores||0}</td>
                        <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{p.full_house_results_count||0}</td>
                        <td className="text-xs text-right" style={{ color:'var(--txt-second)' }}>{p.full_house_scores_count||0}</td>
                        <td style={{ textAlign:'right', paddingRight:14 }}><span className="text-sm font-medium" style={{ color:'var(--accent)' }}>{p.total_points||0}</span></td>
                      </tr>
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
