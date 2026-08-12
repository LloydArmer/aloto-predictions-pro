import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
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
  const [comp,    setComp]    = useSelectedCompetition(competitions)
  const [results, setResults] = useState([])
  const [gw,      setGW]      = useState(null)
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [groupStanding, setGroupStanding] = useState(null)
  const [groupTop3, setGroupTop3] = useState([])
  const { overall } = useLeaderboard(comp)
  const compObj = competitions.find(c => c.id === comp)

  useEffect(() => { if (comp && user) load(); else setLoading(false) }, [comp, user])
  useEffect(() => {
    if (comp && user && compObj?.format === 'group_knockout') loadGroupStanding()
    else setGroupStanding(null)
  }, [comp, user, compObj?.format])

  async function loadGroupStanding() {
    // group_standings is a database VIEW, not a table — PostgREST's
    // automatic foreign-key embedding isn't reliable against views, so
    // fetch and merge the names separately instead.
    const { data: rows } = await supabase.from('group_standings').select('*').eq('competition_id', comp)
    const userIds = [...new Set((rows || []).map(r => r.user_id))]
    const { data: profs } = userIds.length ? await supabase.from('profiles').select('id, display_name').in('id', userIds) : { data: [] }
    const nameMap = {}; (profs || []).forEach(p => { nameMap[p.id] = p.display_name })
    const merged = (rows || []).map(r => ({ ...r, profiles: { display_name: nameMap[r.user_id] || 'Unknown' } }))
    const sorted = merged.sort((a,b) => b.league_points - a.league_points || b.points_diff - a.points_diff || b.points_for - a.points_for)
    const myIndex = sorted.findIndex(s => s.user_id === user.id)
    const mine = sorted[myIndex]
    setGroupStanding(mine ? { rank: myIndex + 1, total: sorted.length, points: mine.league_points, wins: mine.wins, pointsFor: mine.points_for } : null)
    setGroupTop3(sorted.slice(0,3))
  }

  async function load() {
    setLoading(true)
    try {
      const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', comp)
      const linkedGwIds = (links || []).map(l => l.gameweek_id)
      const { data: gws } = linkedGwIds.length
        ? await supabase.from('gameweeks').select('*').in('id', linkedGwIds).in('status',['active','completed']).order('number',{ascending:false}).limit(1)
        : { data: [] }
      const latestGW = gws?.[0]; setGW(latestGW)
      if (latestGW) {
        const { data: fx }    = await supabase.from('fixtures').select('*').eq('gameweek_id', latestGW.id).order('kickoff_time')
        const { data: preds } = await supabase.from('predictions').select('*').eq('gameweek_id', latestGW.id).eq('user_id', user.id)
        const pm = {}; (preds||[]).forEach(p => { pm[p.fixture_id] = p })
        setResults((fx||[]).map(f => ({ ...f, myPrediction: pm[f.id]||null, outcome: outcomeLabel(pm[f.id], f) })))
      }
      // gameweek_scores is now scoped per-competition directly, so filter
      // by competition_id rather than by a gameweek_id list — this also
      // correctly separates a shared gameweek's scores per competition.
      const { data: scores } = await supabase.from('gameweek_scores').select('*').eq('user_id', user.id).eq('competition_id', comp)
      if (scores?.length) setStats({ total: scores.reduce((a,b)=>a+(b.points||0),0), exact: scores.reduce((a,b)=>a+(b.exact_scores||0),0), correct: scores.reduce((a,b)=>a+(b.correct_results||0),0) })
    } finally { setLoading(false) }
  }

  const myRank = overall.findIndex(p => p.user_id === user?.id) + 1
  const pendingCount = results.filter(f => !f.myPrediction && f.home_score === null && new Date(f.kickoff_time) > new Date()).length
  const ocfg = {
    exact:         { label: 'Exact score!',       variant: 'exact'    },
    result:        { label: 'Correct result',     variant: 'result'   },
    miss:          { label: 'No points',          variant: 'miss'     },
    no_prediction: { label: 'No prediction entered', variant: 'miss' },
    upcoming:      { label: 'Upcoming',           variant: 'upcoming' },
  }
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

          {groupStanding && (
            <div className="mb-5">
              <SectionLabel className="mb-2">Group stage</SectionLabel>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <StatCard label="Group rank"   value={`#${groupStanding.rank}`} sub={`of ${groupStanding.total} in group`}/>
                <StatCard label="Group points" value={groupStanding.points} sub="league points"/>
                <StatCard label="Games won"    value={groupStanding.wins} sub="in the group"/>
                <StatCard label="Points for"   value={groupStanding.pointsFor} sub="cumulative"/>
              </div>
            </div>
          )}

          {pendingCount > 0 && (
            <Link to="/predict" className="block mb-4">
              <Card className="p-3.5 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'var(--amber-dim)', borderColor: 'rgba(245,166,35,0.35)' }}>
                <div className="flex items-center gap-2.5">
                  <i className="ti ti-clock-exclamation text-lg" style={{ color: 'var(--amber)' }} aria-hidden="true"/>
                  <span className="text-sm font-medium" style={{ color: 'var(--amber)' }}>
                    {pendingCount} prediction{pendingCount !== 1 ? 's' : ''} waiting {gw ? `for ${gw.number}` : ''}
                  </span>
                </div>
                <span className="text-xs font-medium px-3 py-1.5 rounded-md" style={{ background: 'var(--amber)', color: 'var(--bg-base)' }}>Predict now</span>
              </Card>
            </Link>
          )}

          <Card className="p-4 mb-4">
            <SectionLabel className="mb-3">{gw ? `${gw.number} — your predictions` : 'Recent predictions'}</SectionLabel>
            {results.length === 0
              ? <EmptyState icon="ti-calendar-off" title="No fixtures yet" action={<Link to="/predict" className="btn btn-primary btn-sm">Go to predictions</Link>}/>
              : results.map(f => {
                  const cfg = ocfg[f.outcome || 'upcoming']
                  const hasResult = f.home_score !== null
                  return (
                    <Card key={f.id} className="p-3.5 mb-2.5" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>
                        {f.home_team} <span style={{ color: 'var(--txt-muted)', fontWeight: 400 }}>vs</span> {f.away_team}
                      </p>
                      {hasResult && <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--green)' }}>Result: {f.home_score}–{f.away_score}</p>}
                      <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                        <p className="text-xs" style={{ color: 'var(--txt-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.myPrediction
                            ? `You predicted: ${f.myPrediction.predicted_home}–${f.myPrediction.predicted_away}`
                            : hasResult ? '' : format(new Date(f.kickoff_time),'EEE HH:mm')}
                        </p>
                        <div className="flex items-center gap-2" style={{ flexShrink: 0, marginLeft: 'auto' }}>
                          <Badge variant={cfg.variant}>{cfg.label}</Badge>
                          {f.outcome && f.outcome !== 'upcoming' && f.outcome !== 'no_prediction' && (
                            <span className="text-xs font-medium" style={{ color: f.outcome==='exact'?'var(--green)':f.outcome==='miss'?'var(--red)':'var(--accent)' }}>
                              {f.outcome==='exact'?'+5':f.outcome==='result'?'+2':'0'} pts
                            </span>
                          )}
                        </div>
                      </div>
                    </Card>
                  )
                })
            }
          </Card>

          <Card className="p-4 mb-4">
            <SectionLabel className="mb-3">Current top 3</SectionLabel>
            {compObj?.format === 'group_knockout' ? (
              groupTop3.length === 0
                ? <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>No group games completed yet — points appear once a gameweek is marked completed and its group fixtures are resolved.</p>
                : groupTop3.map((p,i) => (
                    <div key={p.user_id} className="flex items-center justify-between py-2.5 border-b last:border-0 flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center gap-2.5" style={{ minWidth: 0 }}>
                        <span className="text-sm font-semibold flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-elevated)', color: ptColors[i] }}>{i+1}</span>
                        <div style={{ minWidth: 0 }}>
                          <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
                            {p.profiles?.display_name}
                            {p.user_id === user?.id && <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--accent)' }}>(you)</span>}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>{p.wins||0}W {p.draws||0}D {p.losses||0}L · {p.points_for||0} pts for</p>
                        </div>
                      </div>
                      <span className="text-base font-medium" style={{ color: ptColors[i] }}>{p.league_points} pts</span>
                    </div>
                  ))
            ) : overall.slice(0,3).map((p,i) => (
              <div key={p.user_id} className="flex items-center justify-between py-2.5 border-b last:border-0 flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2.5" style={{ minWidth: 0 }}>
                  <span className="text-sm font-semibold flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-elevated)', color: ptColors[i] }}>{i+1}</span>
                  <div style={{ minWidth: 0 }}>
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
            Share {gw ? gw.number : 'latest'} standings to WhatsApp
          </button>
        </>
      )}
    </div>
  )
}
