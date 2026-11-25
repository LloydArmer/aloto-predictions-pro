import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { triplePointsBonus } from '../../../lib/scoring'
import { Card, Spinner, EmptyState } from '../../ui'
import { PlayerMark } from '../../ui/Shirt'

const COLS = [
  { key: 'avg',     label: 'Avg',   title: 'Average points per finished gameweek' },
  { key: 'best',    label: 'Best',  title: 'Best gameweek' },
  { key: 'exact',   label: 'Exact', title: 'Exact scores' },
  { key: 'correct', label: 'Res',   title: 'Correct results' },
]

/**
 * Every player's average points per gameweek, best week, exact scores and
 * correct results. Finished gameweeks only; a finished week someone missed
 * counts as 0; Triple Points weeks count at their normal score, the same as
 * the Dashboard's own average.
 */
export default function PlayerAverages({ competitionId, userId }) {
  const [rows, setRows] = useState(null)
  const [weeks, setWeeks] = useState(0)
  const [sort, setSort] = useState('avg')

  useEffect(() => {
    if (!competitionId) return
    let cancelled = false
    setRows(null)
    ;(async () => {
      const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', competitionId)
      const ids = (links || []).map(l => l.gameweek_id)
      const [{ data: gws }, { data: parts }] = await Promise.all([
        ids.length ? supabase.from('gameweeks').select('id, number').in('id', ids).eq('status', 'completed') : { data: [] },
        supabase.from('participants').select('user_id, profiles(display_name, badge_kit)').eq('competition_id', competitionId),
      ])
      const done = gws || []
      const { data: scores } = done.length
        ? await supabase.from('gameweek_scores')
            .select('user_id, gameweek_id, points, exact_scores, correct_results, triple_points')
            .eq('competition_id', competitionId).in('gameweek_id', done.map(g => g.id))
        : { data: [] }
      if (cancelled) return
      const numberOf = new Map(done.map(g => [g.id, g.number]))
      const list = (parts || []).map(p => {
        const mine = (scores || []).filter(s => s.user_id === p.user_id)
          .map(s => ({ ...s, points: s.triple_points ? (s.points || 0) - triplePointsBonus(s.points) : (s.points || 0) }))
        const best = mine.reduce((b, s) => (!b || s.points > b.points ? s : b), null)
        return {
          userId: p.user_id,
          name: p.profiles?.display_name || 'Player',
          kit: p.profiles?.badge_kit,
          avg: done.length ? mine.reduce((t, s) => t + s.points, 0) / done.length : 0,
          best: best?.points ?? 0,
          bestGw: best ? numberOf.get(best.gameweek_id) : null,
          exact: mine.reduce((t, s) => t + (s.exact_scores || 0), 0),
          correct: mine.reduce((t, s) => t + (s.correct_results || 0), 0),
        }
      })
      setWeeks(done.length)
      setRows(list)
    })()
    return () => { cancelled = true }
  }, [competitionId])

  if (!rows) return <div className="flex justify-center py-12"><Spinner/></div>
  if (!weeks) return <EmptyState icon="ti-chart-bar" title="No finished gameweeks yet" description="Averages appear once the first gameweek is finished"/>

  const sorted = [...rows].sort((a, b) => b[sort] - a[sort] || b.avg - a.avg || a.name.localeCompare(b.name))
  const everyone = rows.reduce((t, r) => t + r.avg, 0) / (rows.length || 1)
  const one = n => (Math.round(n * 10) / 10).toFixed(1)

  return (
    <>
      <p className="text-xs mb-2" style={{ color: 'var(--txt-muted)' }}>
        Over {weeks} finished gameweek{weeks === 1 ? '' : 's'} · everyone averages <strong style={{ color: 'var(--txt-primary)' }}>{one(everyone)}</strong> · Triple Points counted at normal score · tap a heading to sort
      </p>
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center px-3 py-2 text-[11px]" style={{ color: 'var(--txt-muted)', borderBottom: '0.5px solid var(--border)' }}>
          <span className="w-6">#</span>
          <span className="flex-1">Player</span>
          {COLS.map(c => (
            <button key={c.key} title={c.title} onClick={() => setSort(c.key)} className="w-12 text-right"
              style={{ color: sort === c.key ? 'var(--accent)' : 'var(--txt-muted)', fontWeight: sort === c.key ? 600 : 400 }}>
              {c.label}{sort === c.key ? ' ↓' : ''}
            </button>
          ))}
        </div>
        {sorted.map((r, i) => {
          const me = r.userId === userId
          return (
            <div key={r.userId} className="flex items-center px-3 py-2.5 text-sm"
              style={{ borderBottom: '0.5px solid var(--border)', background: me ? 'var(--accent-dim, rgba(124,77,255,0.12))' : undefined }}>
              <span className="w-6 text-xs" style={{ color: 'var(--txt-muted)' }}>{i + 1}</span>
              <span className="flex-1 flex items-center gap-2 min-w-0">
                <PlayerMark kit={r.kit} displayName={r.name} size={20}/>
                <span className="truncate" style={{ color: 'var(--txt-primary)', fontWeight: me ? 600 : 400 }}>{r.name}</span>
              </span>
              <span className="w-12 text-right font-semibold" style={{ color: sort === 'avg' ? 'var(--accent)' : 'var(--txt-primary)' }}>{one(r.avg)}</span>
              <span className="w-12 text-right" style={{ color: 'var(--txt-second)' }}>
                {r.best}{r.bestGw ? <span className="block text-[10px]" style={{ color: 'var(--txt-muted)' }}>GW{r.bestGw}</span> : null}
              </span>
              <span className="w-12 text-right" style={{ color: 'var(--txt-second)' }}>{r.exact}</span>
              <span className="w-12 text-right" style={{ color: 'var(--txt-second)' }}>{r.correct}</span>
            </div>
          )
        })}
      </Card>
    </>
  )
}
