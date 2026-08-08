import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { supabase } from '../../../lib/supabase'
import { Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'

const ROUND_LABELS = { playoff:'Playoff', r64:'Round of 64', r32:'Round of 32', r16:'Round of 16', qf:'Quarter-finals', sf:'Semi-finals', f:'Final' }

function MatchCard({ match, userId }) {
  const isCompleted = match.status === 'completed'
  const rows = [
    { name: match.home?.display_name, uid: match.home_user_id, pts: match.home_points },
    { name: match.away_user_id ? match.away?.display_name : null, uid: match.away_user_id, pts: match.away_points },
  ]
  return (
    <div className="rounded-md overflow-hidden mb-2" style={{ border: '0.5px solid var(--border-med)', background: 'var(--bg-surface)' }}>
      {rows.map((r, i) => !r.uid && i === 1
        ? <div key={i} className="flex items-center px-3 py-2.5" style={{ opacity: 0.4 }}><span className="text-xs" style={{ color: 'var(--txt-muted)' }}>Bye</span></div>
        : <div key={i} className="flex items-center justify-between px-3 py-2.5 gap-2"
            style={{ borderBottom: i === 0 ? '0.5px solid var(--border)' : '', background: isCompleted && match.winner_user_id === r.uid ? 'var(--accent-dim)' : r.uid === userId ? 'rgba(79,142,247,0.06)' : '' }}>
            <span className="text-sm" style={{ color: 'var(--txt-primary)', fontWeight: match.winner_user_id === r.uid ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {r.name || 'TBD'}{r.uid === userId && <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--accent)' }}>(you)</span>}
            </span>
            <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
              {r.pts != null && <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>{r.pts} pts</span>}
              {match.winner_user_id === r.uid && <i className="ti ti-star text-xs" style={{ color: 'var(--gold)' }} />}
            </div>
          </div>
      )}
    </div>
  )
}

export default function Bracket() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useState(null)
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (competitions.length && !comp) {
      const ko = competitions.find(c => c.format === 'knockout' || c.format === 'group_knockout')
      setComp(ko?.id || competitions[0]?.id)
    }
  }, [competitions])
  useEffect(() => { if (comp) load(); else setLoading(false) }, [comp])

  async function load() {
    setLoading(true)
    try {
      const { data: matches } = await supabase.from('bracket_matches')
        .select('*, home:home_user_id(display_name), away:away_user_id(display_name), winner:winner_user_id(display_name)')
        .eq('competition_id', comp).order('round_order')
      const rm = {}; (matches || []).forEach(m => { if (!rm[m.round]) rm[m.round] = []; rm[m.round].push(m) })
      setRounds(Object.entries(rm).map(([round, ms]) => ({ round, matches: ms })))
    } finally { setLoading(false) }
  }

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp} />
      {loading ? <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        : rounds.length === 0 ? <EmptyState icon="ti-tournament" title="No bracket yet" description="The admin will set up bracket matches when the knockout stage begins" />
        : <>
          <div className="mb-4 p-3 rounded-md text-xs" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}>
            <span style={{ color: 'var(--txt-second)' }}>Matchups are decided automatically by prediction points earned in the gameweek(s) assigned to each round — no separate prediction needed here.</span>
          </div>
          {rounds.map(({ round, matches }) => (
            <div key={round} className="mb-5">
              <SectionLabel className="mb-2">{ROUND_LABELS[round] || round}</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {matches.map(m => <MatchCard key={m.id} match={m} userId={user?.id} />)}
              </div>
            </div>
          ))}
        </>
      }
    </div>
  )
}
