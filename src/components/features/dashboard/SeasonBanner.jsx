import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../ui'
import { daysUntil, deadlineLabel } from '../../../lib/seasonScoring'

/**
 * Reminds a participant about season prediction deadlines, and disappears once
 * they're done.
 *
 * Deliberately mirrors the pending-gameweek cards: same amber, same shape, same
 * position. A second visual language for "you owe us something" would just make
 * both easier to ignore. Urgency is carried by the countdown chip turning red,
 * not by the card changing colour.
 *
 * Shows nothing at all when there is nothing outstanding — a card saying
 * "you're up to date" is clutter on a screen someone opens twice a day.
 */
export default function SeasonBanner({ competitionId, userId }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!competitionId || !userId) { setItems([]); return }
    let cancelled = false

    ;(async () => {
      const pending = []

      // ---- Final league table ----
      const { data: tc } = await supabase.from('season_table_configs')
        .select('id, league_name, team_count, deadline, is_open')
        .eq('competition_id', competitionId).maybeSingle()

      if (tc?.is_open && isStillOpen(tc.deadline)) {
        const { count } = await supabase.from('season_table_predictions')
          .select('id', { count: 'exact', head: true })
          .eq('config_id', tc.id).eq('user_id', userId)

        // Complete means every position filled. A part-finished table is still
        // outstanding — that's precisely when a reminder is worth having.
        if ((count ?? 0) < tc.team_count) {
          pending.push({
            key: 'table',
            label: `${tc.league_name} final table`,
            detail: (count ?? 0) === 0
              ? `${tc.team_count} teams to place`
              : `${tc.team_count - (count ?? 0)} of ${tc.team_count} still to place`,
            deadline: tc.deadline,
          })
        }
      }

      // ---- Individual picks ----
      const { data: pc } = await supabase.from('season_pick_configs')
        .select('id, deadline, is_open').eq('competition_id', competitionId).maybeSingle()

      if (pc?.is_open && isStillOpen(pc.deadline)) {
        const { data: picks } = await supabase.from('season_picks')
          .select('id').eq('config_id', pc.id)
        const ids = (picks || []).map(p => p.id)

        if (ids.length) {
          const { count } = await supabase.from('season_pick_answers')
            .select('id', { count: 'exact', head: true }).in('pick_id', ids).eq('user_id', userId)

          if ((count ?? 0) < ids.length) {
            pending.push({
              key: 'picks',
              label: 'Individual Predictions',
              detail: `${ids.length - (count ?? 0)} of ${ids.length} unanswered`,
              deadline: pc.deadline,
            })
          }
        }
      }

      if (!cancelled) setItems(pending)
    })()

    return () => { cancelled = true }
  }, [competitionId, userId])

  if (!items.length) return null

  return (
    <>
      {items.map(item => {
        const days = daysUntil(item.deadline)
        const urgent = days !== null && days <= 3

        return (
          <Link key={item.key} to="/predict" className="block mb-3">
            <Card className="p-3.5 flex items-center justify-between gap-3 flex-wrap"
              style={{ background: 'var(--amber-dim)', borderColor: 'rgba(245,166,35,0.35)' }}>
              <div className="flex items-center gap-2.5" style={{ minWidth: 0 }}>
                <i className="ti ti-calendar-star text-base flex-shrink-0"
                  style={{ color: 'var(--amber)' }} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {item.label}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>{item.detail}</p>
                </div>
              </div>

              {/* The countdown is the point of the card — someone with three
                  weeks left behaves very differently from someone with one day. */}
              {/* Urgency shows in the countdown chip alone — red inside an
                  amber card, rather than changing the whole card and losing the
                  match with the gameweek reminders above it. */}
              <span className="text-xs font-semibold px-2 py-1 rounded flex-shrink-0"
                style={{
                  background: urgent ? 'var(--red-dim)' : 'rgba(245,166,35,0.18)',
                  color: urgent ? 'var(--red)' : 'var(--amber)',
                }}>
                {deadlineLabel(item.deadline)}
              </span>
            </Card>
          </Link>
        )
      })}
    </>
  )
}

/** A missing deadline means open-ended, not closed. */
function isStillOpen(deadline) {
  return !deadline || new Date(deadline) > new Date()
}
