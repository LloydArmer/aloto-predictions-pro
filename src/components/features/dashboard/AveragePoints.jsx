import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../ui'
import { triplePointsBonus } from '../../../lib/scoring'

/**
 * Your average points per gameweek in this competition, next to everyone's
 * average and your best week. Only finished gameweeks count, so a gameweek
 * still being played doesn't drag the number down on a Saturday afternoon.
 * A finished gameweek you didn't predict counts as 0. Triple Points is left
 * out: a tripled week counts at its normal score, because the chip is a
 * one-off bonus, not part of anyone's weekly total.
 */
export default function AveragePoints({ competitionId, userId }) {
  const [avg, setAvg] = useState(null)

  useEffect(() => {
    if (!competitionId || !userId) { setAvg(null); return }
    let cancelled = false
    ;(async () => {
      const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', competitionId)
      const ids = (links || []).map(l => l.gameweek_id)
      const { data: gws } = ids.length
        ? await supabase.from('gameweeks').select('id, number').in('id', ids).eq('status', 'completed')
        : { data: [] }
      if (!gws?.length) { if (!cancelled) setAvg(null); return }
      const { data: scores } = await supabase.from('gameweek_scores')
        .select('user_id, gameweek_id, points, triple_points').eq('competition_id', competitionId).in('gameweek_id', gws.map(g => g.id))
      if (cancelled) return
      const rows = (scores || []).map(r => ({ ...r, points: r.triple_points ? (r.points || 0) - triplePointsBonus(r.points) : (r.points || 0) }))
      const mine = rows.filter(r => r.user_id === userId)
      const myTotal = mine.reduce((s, r) => s + (r.points || 0), 0)
      const best = mine.reduce((b, r) => (!b || r.points > b.points ? r : b), null)
      const players = new Set(rows.map(r => r.user_id)).size
      setAvg({
        mine: myTotal / gws.length,
        everyone: players ? rows.reduce((s, r) => s + (r.points || 0), 0) / (players * gws.length) : null,
        weeks: gws.length,
        best: best ? { points: best.points, number: gws.find(g => g.id === best.gameweek_id)?.number } : null,
      })
    })()
    return () => { cancelled = true }
  }, [competitionId, userId])

  if (!avg) return null
  const one = n => (Math.round(n * 10) / 10).toString()
  const ahead = avg.everyone != null ? avg.mine - avg.everyone : null
  return (
    <Card className="p-3 mb-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs mb-0.5" style={{ color: 'var(--txt-muted)' }}>Average per gameweek</p>
          <p className="text-2xl font-medium" style={{ color: 'var(--txt-primary)' }}>
            {one(avg.mine)} <span className="text-sm" style={{ color: 'var(--txt-muted)' }}>pts</span>
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--txt-second)' }}>
            over {avg.weeks} finished gameweek{avg.weeks === 1 ? '' : 's'}
          </p>
        </div>
        <div className="text-right text-xs space-y-1 flex-shrink-0">
          {avg.everyone != null && (
            <p style={{ color: 'var(--txt-second)' }}>
              Everyone: <strong style={{ color: 'var(--txt-primary)' }}>{one(avg.everyone)}</strong>
              {ahead !== 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded"
                  style={{ background: ahead > 0 ? 'var(--green-dim)' : 'var(--red-dim)', color: ahead > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {ahead > 0 ? '+' : ''}{one(ahead)}
                </span>
              )}
            </p>
          )}
          {avg.best && (
            <p style={{ color: 'var(--txt-second)' }}>
              Best: <strong style={{ color: 'var(--txt-primary)' }}>{avg.best.points}</strong> in GW{avg.best.number}
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}
