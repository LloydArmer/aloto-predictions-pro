import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useLeaderboard } from '../../../hooks/useLeaderboard'
import { supabase } from '../../../lib/supabase'
import { StatCard, Badge, Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import { outcomeLabel } from '../../../lib/scoring'
import { buildWeeklyMessage, openWhatsApp } from '../../../lib/whatsapp'
import CompetitionSelector from '../../layout/CompetitionSelector'
import { format } from 'date-fns'

export default function Dashboard() {
  const { user, isAdmin } = useAuth()
  const { competitions, loading: compsLoading } = useCompetitions()
  const [comp,    setComp]    = useState(null)
  const [results, setResults] = useState([])
  const [gw,      setGW]      = useState(null)
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(false)
  const { overall } = useLeaderboard(comp)

  useEffect(() => { if (competitions.length && !comp) setComp(competitions[0]?.id) }, [competitions])
  useEffect(() => { if (comp && user) load(); else setLoading(false) }, [comp, user])

  async function load() {
    setLoading(true)
    try {
      const { data: gws } = await supabase.from('gameweeks').select('*').eq('competition_id', comp).in('status',['active','completed']).order('number',{ascending:false}).limit(1)
      const latestGW = gws?.[0]; setGW(latestGW)
      if (latestGW) {
        const { data: fx }    = await supabase.from('fixtures').select('*').eq('gameweek_id', latestGW.id).order('kickoff_time')
        const { data: preds } = await supabase.from('predictions').select('*').eq('gameweek_id', latestGW.id).eq('user_id', user.id)
        const pm = {}; (preds||[]).forEach(p => { pm[p.fixture_id] = p })
        setResults((fx||[]).map(f => ({ ...f, myPrediction: pm[f.id]||null, outcome: pm[f.id] ? outcomeLabel(pm[f.id], f) : null })))
      }
      const { data: gwIds }  = await supabase.from('gameweeks').select('id').eq('competition_id', comp)
      const { data: scores } = await supabase.from('gameweek_scores').select('*').eq('user_id', user.id).in('gameweek_id', (gwIds||[]).map(g=>g.id))
      if (scores?.length) setStats({ total: scores.reduce((a,b)=>a+(b.points||0),0), exact: scores.reduce((a,b)=>a+(b.exact_scores||0),0), correct: scores.reduce((a,b)=>a+(b.correct_results||0),0) })
    } finally { setLoading(false) }
  }

  const myRank = overall.findIndex(p => p.user_id === user?.id) + 1
  const ocfg = {
    exact:    { label: 'Exact score!',    variant: 'exact'    },
    result:   { label: 'Correct result',  variant: 'result'   },
    miss:     { label: 'Missed',          variant: 'miss'     },
    upcoming: { label: 'Upcoming',        variant: 'upcoming' },
  }
  const medals = ['🥇','🥈','🥉']
  const ptColors = ['var(--gold)','#b4b2a9','#f0997b']

  // Still checking whether the account belongs to any competition at all
  if (compsLoading) {
    return <div className="flex justify-center py-20"><Spinner size="lg"/></div>
  }

  // Confirmed: this account isn't part of any competition yet (e.g. brand new install,
  // or a player account that hasn't been added to one). This is the normal first-run
  // state, not an error, so show guidance instead of an empty dashboard shell.
  if (competitions.length === 0) {
    return (
      <Card className="p-6 text-center">
        <EmptyState
          icon="ti-trophy"
          title="No competitions yet"
          description={isAdmin
            ? "Create your first competition in Admin to get started."
            : "You haven't been added to a competition yet. Ask your admin to add you."}
          action={isAdmin ? <Link to="/admin" className="btn btn-primary btn-sm">Go to Admin</Link> : null}
        />
      </Card>
    )
  }

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp} />
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg"/></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
            <StatCard label="Your rank"       value={myRank ? `#${myRank}` : '—'} sub={`of ${overall.length} players`}/>
            <StatCard label="Total points"    value={stats?.total ?? 0}  sub="this season"/>
            <StatCard label="Exact scores"    value={stats?.exact ?? 0}  sub="bonus pts earned"/>
            <StatCard label="Correct results" value={stats?.correct ?? 0} sub="correct predictions"/>
          </div>

          <Card className="p-4 mb-4">
            <SectionLabel className="mb-3">{gw ? `GW${gw.number} — your predictions` : 'Recent predictions'}</SectionLabel>
            {results.length === 0
              ? <EmptyState icon="ti-calendar-off" title="No fixtures yet" action={<Link to="/predict" className="btn btn-primary btn-sm">Go to predictions</Link>}/>
              : results.map(f => {
                  const cfg = ocfg[f.outcome || 'upcoming']
                  const hasResult = f.home_score !== null
                  return (
                    <div key={f.id} className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                      <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
                          {f.home_team} {hasResult ? `${f.home_score} – ${f.away_score}` : 'vs'} {f.away_team}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--txt-muted)' }}>
                          {f.myPrediction
                            ? `You predicted: ${f.myPrediction.predicted_home}–${f.myPrediction.predicted_away}`
                            : hasResult ? 'No prediction' : format(new Date(f.kickoff_time),'EEE HH:mm')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        {f.outcome && f.outcome !== 'upcoming' && (
                          <span className="text-xs font-medium" style={{ color: f.outcome==='exact'?'var(--green)':f.outcome==='miss'?'var(--red)':'var(--accent)' }}>
                            {f.outcome==='exact'?'+5':f.outcome==='result'?'+2':'0'} pts
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })
            }
          </Card>

          <Card className="p-4 mb-4">
            <SectionLabel className="mb-3">Current top 3</SectionLabel>
            {overall.slice(0,3).map((p,i) => (
              <div key={p.user_id} className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{medals[i]}</span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
                      {p.display_name}
                      {p.user_id === user?.id && <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--accent)' }}>(you)</span>}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>{p.exact_scores||0} exact · {p.correct_results||0} results</p>
                  </div>
                </div>
                <span className="text-base font-medium" style={{ color: ptColors[i] }}>{p.total_points} pts</span>
              </div>
            ))}
          </Card>

          <button className="wa-btn" onClick={() => {
            if (gw && overall.length) openWhatsApp(buildWeeklyMessage(gw, overall.slice(0,3).map(p=>({ display_name: p.display_name, points: p.total_points })), window.location.origin))
          }}>
            <i className="ti ti-brand-whatsapp text-base" aria-hidden="true"/>
            Share {gw ? `GW${gw.number}` : 'latest'} standings to WhatsApp
          </button>
        </>
      )}
    </div>
  )
}
