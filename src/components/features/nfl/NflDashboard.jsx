import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { sortGameweeks, latestGameweek } from '../../../lib/gameweeks'
import { nflPointRules, marginScore, bandStyle } from '../../../lib/sports/nfl/scoring'
import { loadNflTable, withRanks } from '../../../lib/sports/nfl/table'
import { nflTeam } from '../../../lib/sports/nfl/teams'
import { StatCard, Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import JoinCompetition from '../competitions/JoinCompetition'
import ReminderBanner from '../dashboard/ReminderBanner'
import SeasonBanner from '../dashboard/SeasonBanner'
import { format, isPast } from 'date-fns'

/**
 * The NFL Dashboard. Entirely separate from football's: every number on it
 * comes from this NFL competition and the NFL scorer, and nothing football
 * specific (Triple Points, kits, head to heads, cups) appears.
 *
 * Top to bottom: this week at a glance, your season numbers, picks still to
 * make, season questions still open, the top of the table, and this week's
 * games with your pick and what it paid.
 *
 * Points for a game show as soon as its final score is confirmed, so the week
 * fills in game by game; the season totals come from the same table as NFL
 * Standings, so the two always agree.
 */
export default function NflDashboard() {
  const { user, isAdmin } = useAuth()
  const { competitions, loading: compsLoading } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [loading, setLoading] = useState(true)
  const [week, setWeek] = useState(null)        // { gw, games: [{ fixture, pick, scored }] }
  const [table, setTable] = useState(null)
  const [pendingGws, setPendingGws] = useState([])

  useEffect(() => { if (comp && user) load(); else setLoading(false) }, [comp, user?.id])

  async function load() {
    setLoading(true)
    try {
      const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', comp)
      const ids = (links || []).map(l => l.gameweek_id)
      const { data: raw } = ids.length
        ? await supabase.from('gameweeks').select('*').in('id', ids).in('status', ['active', 'completed'])
        : { data: [] }
      const weeks = sortGameweeks(raw)
      const gw = weeks.filter(g => g.status === 'active').pop() || latestGameweek(weeks) || null
      const rules = await nflPointRules(supabase, comp)

      if (gw) {
        const { data: fx } = await supabase.from('fixtures').select('*').eq('gameweek_id', gw.id).order('kickoff_time')
        const { data: preds } = await supabase.from('predictions').select('*').eq('gameweek_id', gw.id).eq('user_id', user.id)
        const pm = {}; (preds || []).forEach(p => { pm[p.fixture_id] = p })
        const games = (fx || []).map(f => {
          const pick = pm[f.id] || null
          const final = f.status !== 'void' && f.home_score != null && f.away_score != null
          return { fixture: f, pick, final, scored: pick && final ? marginScore(pick, f, rules) : null }
        })
        setWeek({ gw, games })
      } else setWeek(null)

      // A reminder for each open week with games still to pick before kickoff.
      const pending = []
      for (const agw of weeks.filter(g => g.status === 'active')) {
        const { data: fx } = await supabase.from('fixtures').select('id, kickoff_time, home_score').eq('gameweek_id', agw.id)
        const { data: preds } = await supabase.from('predictions').select('fixture_id').eq('gameweek_id', agw.id).eq('user_id', user.id)
        const have = new Set((preds || []).map(p => p.fixture_id))
        const open = (fx || []).filter(f => !have.has(f.id) && f.home_score === null && new Date(f.kickoff_time) > new Date()).length
        if (open > 0) pending.push({ id: agw.id, number: agw.number, pendingCount: open, totalFixtures: (fx || []).length })
      }
      setPendingGws(pending)

      setTable(await loadNflTable(supabase, comp))
    } finally { setLoading(false) }
  }

  if (compsLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>

  if (!competitions.length) return (
    <div>
      <Card className="p-6 text-center mb-4">
        <EmptyState icon="ti-ball-american-football" title="No NFL competitions yet"
          description={isAdmin ? 'Create one in Admin, or join one with a code.' : 'Enter the code your league admin sent you to join one.'}
          action={isAdmin ? <Link to="/admin" className="btn btn-primary btn-sm">Go to Admin</Link> : null} />
      </Card>
      <JoinCompetition onJoined={() => window.location.reload()} />
    </div>
  )

  const ranked = table ? withRanks(table.list) : []
  const me = ranked.find(r => r.user_id === user?.id)
  const games = week?.games || []
  const picked = games.filter(g => g.pick).length
  const weekPts = games.reduce((sum, g) => sum + (g.scored?.points || 0), 0)
  const finished = games.filter(g => g.final).length
  const nextKick = games.map(g => g.fixture).filter(f => f.home_score == null && !isPast(new Date(f.kickoff_time)))[0]
  const thisWeekPending = pendingGws.find(p => p.id === week?.gw?.id)

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp} />
      {loading ? <div className="flex justify-center py-20"><Spinner size="lg" /></div> : <>

        {/* ── This week ── */}
        <Card className="p-4 mb-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <SectionLabel>{week ? week.gw.number : 'This week'}</SectionLabel>
            {week && <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>{finished} of {games.length} games final</span>}
          </div>
          {!week ? (
            <p className="text-sm" style={{ color: 'var(--txt-muted)' }}>No games yet. They'll appear when the admin adds this week's games.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-3xl font-semibold" style={{ color: 'var(--txt-primary)' }}>{weekPts}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--txt-muted)' }}>{finished === games.length && games.length ? 'points this week' : 'points so far'}</p>
              </div>
              <div>
                <p className="text-3xl font-semibold" style={{ color: picked === games.length ? 'var(--green)' : 'var(--amber)' }}>{picked}/{games.length}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--txt-muted)' }}>picks made</p>
              </div>
              <div>
                <p className="text-sm font-semibold pt-2" style={{ color: 'var(--txt-primary)' }}>{nextKick ? format(new Date(nextKick.kickoff_time), 'EEE HH:mm') : '—'}</p>
                <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>next kickoff</p>
              </div>
            </div>
          )}
        </Card>

        {/* ── Your season ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
          <StatCard label="Your rank" value={me ? `#${me.rank}` : '—'} sub={`of ${ranked.length} player${ranked.length === 1 ? '' : 's'}`} />
          <StatCard label="Total points" value={me?.points ?? 0} sub="this season" />
          <StatCard label="Exact scores" value={me?.exact ?? 0} sub="games called exactly" />
          <StatCard label="Correct winners" value={me?.winners ?? 0} sub="games" />
        </div>

        {/* Picks still to make, and notifications if they're off. */}
        <ReminderBanner userId={user?.id} pendingGws={pendingGws} />
        {thisWeekPending && (
          <Card className="p-4 mb-4" style={{ background: 'var(--amber-dim)', borderColor: 'rgba(245,166,35,0.35)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div style={{ minWidth: 0 }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--amber)' }}>
                  {thisWeekPending.pendingCount} game{thisWeekPending.pendingCount === 1 ? '' : 's'} still to pick
                </p>
                <p className="text-xs" style={{ color: 'var(--txt-second)' }}>Each game locks at its own kickoff</p>
              </div>
              <Link to="/predict" className="btn btn-sm" style={{ background: 'var(--amber)', color: '#1a1400', fontWeight: 600 }}>Pick now</Link>
            </div>
          </Card>
        )}

        {/* Season questions still open (Super Bowl, MVP, divisions). */}
        <SeasonBanner competitionId={comp} userId={user?.id} />

        {/* ── Top of the table ── */}
        {ranked.length > 0 && (
          <Card className="mb-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <SectionLabel>Table</SectionLabel>
              <Link to="/standings" className="text-xs" style={{ color: 'var(--accent)' }}>Full table</Link>
            </div>
            {ranked.slice(0, 3).concat(me && me.rank > 3 ? [me] : []).map(r => {
              const mine = r.user_id === user?.id
              return (
                <div key={r.user_id} className="flex items-center px-4 py-2 text-sm"
                  style={{ borderTop: '0.5px solid var(--border)', background: mine ? 'var(--accent-dim)' : 'transparent' }}>
                  <span className="font-semibold" style={{ width: 28, color: r.rank <= 3 ? 'var(--gold, var(--amber))' : 'var(--txt-muted)' }}>{r.rank}</span>
                  <span className="flex-1 truncate" style={{ color: mine ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: mine ? 700 : 500 }}>{r.name}{mine && ' (you)'}</span>
                  <span className="font-bold" style={{ color: 'var(--txt-primary)' }}>{r.points}</span>
                </div>
              )
            })}
          </Card>
        )}

        {/* ── This week's games ── */}
        {games.length > 0 && (
          <Card className="mb-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <SectionLabel>{week.gw.number} — your picks</SectionLabel>
              <Link to="/predict" className="text-xs" style={{ color: 'var(--accent)' }}>Predict</Link>
            </div>
            {games.map(({ fixture: f, pick, final, scored }) => {
              const away = nflTeam(f.away_team), home = nflTeam(f.home_team)
              const st = scored ? bandStyle(scored.band) : null
              return (
                <div key={f.id} className="flex items-center gap-2 px-4 py-2 text-xs" style={{ borderTop: '0.5px solid var(--border)' }}>
                  <span className="font-semibold" style={{ width: 78, color: 'var(--txt-primary)' }}>{away.abbr} @ {home.abbr}</span>
                  <span style={{ width: 64, color: 'var(--txt-muted)' }}>
                    {final ? `${f.away_score}–${f.home_score}` : f.status === 'void' ? 'Void' : format(new Date(f.kickoff_time), 'EEE HH:mm')}
                  </span>
                  <span className="flex-1" style={{ color: pick ? 'var(--txt-second)' : 'var(--txt-muted)' }}>
                    {pick ? `You: ${pick.predicted_away}–${pick.predicted_home}` : 'No pick'}
                  </span>
                  {scored && (
                    <span className="font-medium px-2 py-0.5 rounded whitespace-nowrap" style={{ background: st.bg, color: st.color }}>
                      {scored.points} pts
                    </span>
                  )}
                </div>
              )
            })}
          </Card>
        )}
      </>}
    </div>
  )
}
