import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, SectionLabel, EmptyState, Spinner } from '../../ui'
import { looksCorrect } from '../../../lib/fuzzyMatch'

/**
 * Who got what right, once the season predictions have been scored.
 *
 * The layout problem here is real: 20 positions against 10 participants is a
 * 200-cell grid, and a phone is 390px wide. Three decisions follow from that.
 *
 *   A summary first. Most people want the standing, not the detail — so the
 *   totals are a normal vertical list that needs no scrolling at all, and the
 *   grid is below for anyone who wants to pick over it.
 *
 *   The grid scrolls sideways with the position column pinned. Without the pin
 *   you scroll right and lose track of which position you're looking at, which
 *   is exactly the fault we fixed on the Predictions & Points grid.
 *
 *   Cells are the team, coloured. Not a tick — you want to see WHAT someone
 *   said, not merely whether it was right.
 */
export default function SeasonResults({ competitionId, userId }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => { if (competitionId) load(); else setLoading(false) }, [competitionId])

  async function load() {
    setLoading(true)
    try {
      const [{ data: parts }, { data: scores }] = await Promise.all([
        supabase.from('participants').select('user_id, profiles(display_name)').eq('competition_id', competitionId),
        supabase.from('season_scores').select('*').eq('competition_id', competitionId),
      ])

      const people = (parts || []).map(p => ({
        user_id: p.user_id,
        name: p.profiles?.display_name || 'Unknown',
      }))
      const scoreBy = Object.fromEntries((scores || []).map(s => [s.user_id, s]))

      // ---- Final table ----
      const { data: tc } = await supabase.from('season_table_configs')
        .select('*').eq('competition_id', competitionId).maybeSingle()

      let table = null
      if (tc?.results_entered) {
        const [{ data: teams }, { data: results }, { data: preds }] = await Promise.all([
          supabase.from('season_table_teams').select('id, name').eq('config_id', tc.id),
          supabase.from('season_table_results').select('position, team_id').eq('config_id', tc.id),
          supabase.from('season_table_predictions').select('user_id, position, team_id').eq('config_id', tc.id),
        ])

        const teamName = Object.fromEntries((teams || []).map(t => [t.id, t.name]))
        const actual = Object.fromEntries((results || []).map(r => [r.position, r.team_id]))

        const byUser = {}
        ;(preds || []).forEach(p => {
          if (!byUser[p.user_id]) byUser[p.user_id] = {}
          byUser[p.user_id][p.position] = p.team_id
        })

        table = { config: tc, teamName, actual, byUser }
      }

      // ---- Individual picks ----
      const { data: pc } = await supabase.from('season_pick_configs')
        .select('*').eq('competition_id', competitionId).maybeSingle()

      let picksBlock = null
      if (pc) {
        const { data: picks } = await supabase.from('season_picks')
          .select('*, season_pick_options!season_pick_options_pick_id_fkey(id, name)')
          .eq('config_id', pc.id).order('sort_order')

        const ids = (picks || []).map(p => p.id)
        const { data: answers } = ids.length
          ? await supabase.from('season_pick_answers')
              .select('pick_id, user_id, option_id, answer_text, is_correct').in('pick_id', ids)
          : { data: [] }

        const byPick = {}
        ;(answers || []).forEach(a => {
          if (!byPick[a.pick_id]) byPick[a.pick_id] = {}
          byPick[a.pick_id][a.user_id] = a
        })

        picksBlock = { config: pc, picks: picks || [], byPick }
      }

      // Ordered by what they scored — this is a results table, so the person who
      // did best belongs at the top.
      people.sort((a, b) => {
        const total = s => (s?.table_points || 0) + (s?.picks_points || 0)
        return total(scoreBy[b.user_id]) - total(scoreBy[a.user_id]) || a.name.localeCompare(b.name)
      })

      setData({ people, scoreBy, table, picksBlock })
    } finally { setLoading(false) }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner size="lg"/></div>
  if (!data) return null

  const { people, scoreBy, table, picksBlock } = data
  const anyScored = Object.keys(scoreBy).length > 0

  if (!anyScored) {
    return <EmptyState icon="ti-calendar-star" title="Not scored yet"
      description="Results appear once your admin has entered the final table and calculated the points"/>
  }

  return (
    <div>
      {/* ---------------- Summary ---------------- */}
      <SectionLabel className="mb-2">Season points</SectionLabel>
      <Card className="p-0 mb-5 overflow-hidden">
        <table className="data-table">
          <thead><tr>
            <th style={{ width: 30, paddingLeft: 12 }}>#</th>
            <th className="name-cell">Player</th>
            {table && <th style={{ width: 58, textAlign: 'right' }}>Table</th>}
            {picksBlock && <th style={{ width: 58, textAlign: 'right' }}>Picks</th>}
            <th style={{ width: 56, textAlign: 'right', paddingRight: 12 }}>Total</th>
          </tr></thead>
          <tbody>
            {people.map((p, i) => {
              const s = scoreBy[p.user_id]
              const total = (s?.table_points || 0) + (s?.picks_points || 0)
              return (
                <tr key={p.user_id} className={p.user_id === userId ? 'highlight' : ''}>
                  <td style={{ paddingLeft: 12 }}>
                    <span className="text-xs font-medium" style={{ color: i === 0 ? 'var(--gold)' : 'var(--txt-muted)' }}>{i + 1}</span>
                  </td>
                  <td className="name-cell">
                    <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
                      {p.name}{p.user_id === userId && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--accent)' }}>(you)</span>}
                    </p>
                  </td>
                  {table && (
                    <td className="text-xs text-right" style={{ color: 'var(--txt-second)' }}>
                      {s?.table_correct || 0}<span style={{ color: 'var(--txt-muted)' }}>/{table.config.team_count}</span>
                    </td>
                  )}
                  {picksBlock && (
                    <td className="text-xs text-right" style={{ color: 'var(--txt-second)' }}>
                      {s?.picks_correct || 0}<span style={{ color: 'var(--txt-muted)' }}>/{picksBlock.picks.length}</span>
                    </td>
                  )}
                  <td style={{ textAlign: 'right', paddingRight: 12 }}>
                    <span className="text-sm font-semibold" style={{ color: 'var(--gold)' }}>{total}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      {/* ---------------- Final table detail ---------------- */}
      {table && (
        <div className="mb-5">
          <SectionLabel className="mb-2">{table.config.league_name} — everyone's table</SectionLabel>
          <p className="text-xs mb-2" style={{ color: 'var(--txt-muted)' }}>
            Green means the right team in the right position. Scroll sideways for more players.
          </p>
          <Card className="p-0 overflow-hidden">
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 130 + people.length * 96 }}>
                <thead><tr>
                  <th className="sticky-col" style={{ width: 130, paddingLeft: 10 }}>Actual</th>
                  {people.map(p => (
                    <th key={p.user_id} style={{ width: 96, textAlign: 'center', fontSize: 10 }}>
                      {p.name.split(' ')[0]}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {Array.from({ length: table.config.team_count }, (_, i) => i + 1).map(pos => (
                    <tr key={pos}>
                      <td className="sticky-col" style={{ paddingLeft: 10, maxWidth: 0 }}>
                        <p className="text-xs" style={{ color: 'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          <span style={{ color: 'var(--txt-muted)', marginRight: 5 }}>{pos}</span>
                          {table.teamName[table.actual[pos]] || '—'}
                        </p>
                      </td>
                      {people.map(p => {
                        const guess = table.byUser[p.user_id]?.[pos]
                        const right = guess && guess === table.actual[pos]
                        return (
                          <td key={p.user_id} style={{
                            textAlign: 'center',
                            background: right ? 'var(--green-dim)' : 'transparent',
                          }}>
                            <span className="text-xs" style={{
                              color: right ? 'var(--green)' : 'var(--txt-muted)',
                              fontWeight: right ? 600 : 400,
                            }}>
                              {table.teamName[guess] || '–'}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ---------------- Individual predictions detail ---------------- */}
      {picksBlock && picksBlock.picks.length > 0 && (
        <div className="mb-4">
          <SectionLabel className="mb-2">Individual Predictions — everyone's answers</SectionLabel>
          <Card className="p-0 overflow-hidden">
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 150 + people.length * 100 }}>
                <thead><tr>
                  <th className="sticky-col" style={{ width: 150, paddingLeft: 10 }}>Question</th>
                  {people.map(p => (
                    <th key={p.user_id} style={{ width: 100, textAlign: 'center', fontSize: 10 }}>
                      {p.name.split(' ')[0]}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {picksBlock.picks.map(pick => {
                    const optionName = Object.fromEntries((pick.season_pick_options || []).map(o => [o.id, o.name]))
                    const correctName = pick.allow_free_text
                      ? (pick.correct_answer || '—')
                      : (optionName[pick.correct_option_id] || '—')

                    return (
                      <tr key={pick.id}>
                        <td className="sticky-col" style={{ paddingLeft: 10, maxWidth: 0 }}>
                          <p className="text-xs font-medium" style={{ color: 'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {pick.label}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--green)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {correctName} · {pick.points}pts
                          </p>
                        </td>
                        {people.map(p => {
                          const ans = picksBlock.byPick[pick.id]?.[p.user_id]
                          const shown = ans
                            ? (pick.allow_free_text ? ans.answer_text : optionName[ans.option_id])
                            : null

                          // Free-text verdicts are the admin's, recorded when
                          // they marked the answers. Option questions need no
                          // judgement — the ids either match or they don't.
                          const right = ans && (pick.allow_free_text
                            ? ans.is_correct === true
                            : (pick.correct_option_id && ans.option_id === pick.correct_option_id))

                          return (
                            <td key={p.user_id} style={{
                              textAlign: 'center',
                              background: right ? 'var(--green-dim)' : 'transparent',
                            }}>
                              <span className="text-xs" style={{
                                color: right ? 'var(--green)' : 'var(--txt-muted)',
                                fontWeight: right ? 600 : 400,
                              }}>
                                {shown || '–'}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
