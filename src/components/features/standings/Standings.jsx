import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import CompetitionSelector from '../../layout/CompetitionSelector'
import Table from '../table/Table'
import Bracket from '../bracket/Bracket'
import SeasonResults from '../season/SeasonResults'
import { Spinner, EmptyState } from '../../ui'

/**
 * One home for every "how is everyone doing" view.
 *
 * These were spread across two nav items and a tab inside Predict, which meant
 * three places to look for what is essentially the same question. Bringing them
 * together also frees a slot in the bottom bar — four tabs on a 390px screen
 * give noticeably wider tap targets than five, and no truncated labels.
 *
 * The dividing line with Predict is what you DO versus what you LOOK AT.
 * Entering a season prediction is doing; seeing how everyone got on is looking.
 */
export default function Standings() {
  const { user } = useAuth()
  const { competitions, loading } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [view, setView] = useState('overall')
  const [available, setAvailable] = useState({ cup: false, season: false })

  const compObj = competitions.find(c => c.id === comp)
  const isCup = compObj?.format === 'knockout' || compObj?.format === 'group_knockout'
  const isLeagueLike = compObj?.format === 'league' || compObj?.format === 'group_knockout'

  // Only offer views this competition actually has. A tab that opens an empty
  // state is worse than no tab — it looks broken rather than inapplicable.
  useEffect(() => {
    if (!comp) { setAvailable({ cup: false, season: false }); return }
    let cancelled = false

    ;(async () => {
      const { count } = await supabase.from('season_scores')
        .select('id', { count: 'exact', head: true }).eq('competition_id', comp)
      if (!cancelled) setAvailable({ cup: isCup, season: (count ?? 0) > 0 })
    })()

    return () => { cancelled = true }
  }, [comp, isCup])

  // Keep the selected view valid when switching competition — a League has no
  // Cup tab, so landing there from a Knockout would show nothing.
  useEffect(() => {
    if (view === 'cup' && !available.cup) setView('overall')
    if (view === 'season' && !available.season) setView('overall')
    if ((view === 'overall' || view === 'monthly') && !isLeagueLike && available.cup) setView('cup')
  }, [available, isLeagueLike])

  const tabs = [
    ...(isLeagueLike ? [['overall', 'Overall'], ['monthly', 'Monthly']] : []),
    ...(available.cup ? [['cup', 'Cup']] : []),
    ...(available.season ? [['season', 'Season']] : []),
  ]

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg"/></div>
  if (!competitions.length) {
    return <EmptyState icon="ti-list-numbers" title="No competitions yet"
      description="Join one with a code, or ask your admin to add you"/>
  }

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp}/>

      {tabs.length > 1 && (
        <div className="tab-strip mb-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setView(key)}
              ref={el => { if (el && view === key) el.scrollIntoView({ inline: 'center', block: 'nearest' }) }}
              className="text-sm pb-2 px-3"
              style={{
                color: view === key ? 'var(--accent)' : 'var(--txt-muted)',
                fontWeight: view === key ? 600 : 400,
                borderBottom: view === key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Table already handles Overall and Monthly internally, so it's given the
          view rather than duplicating its logic here. */}
      {(view === 'overall' || view === 'monthly') && <Table embeddedView={view}/>}
      {view === 'cup' && <Bracket embedded/>}
      {view === 'season' && <SeasonResults competitionId={comp} userId={user?.id}/>}
    </div>
  )
}
