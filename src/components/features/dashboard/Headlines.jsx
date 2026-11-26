import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { sortGameweeks } from '../../../lib/gameweeks'

const label = n => (/^\d+$/.test(String(n)) ? `GW${n}` : n)
const short = name => {
  const [first, ...rest] = String(name || 'Someone').trim().split(/\s+/)
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first
}
const list = names => names.length <= 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * A scrolling strip of headlines across the top of the Dashboard: who has
 * played Triple Points this gameweek, last gameweek's top scorer, biggest
 * climber, most exact scores and any full house.
 *
 * Triple Points plays are only shown once the gameweek's first match has
 * kicked off. They can't be changed after that, and nobody gets a heads-up
 * on someone else's plan before the deadline.
 */
export default function Headlines({ competitionId, isLeague }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!competitionId) { setItems([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', competitionId)
        const ids = (links || []).map(l => l.gameweek_id)
        if (!ids.length) { setItems([]); return }
        const { data: gwsRaw } = await supabase.from('gameweeks').select('id, number, status').in('id', ids)
        const gws = sortGameweeks(gwsRaw || [])
        const current = [...gws].reverse().find(g => g.status === 'active')
        const done = gws.filter(g => g.status === 'completed')
        const last = done[done.length - 1]

        const [{ data: parts }, { data: scores }] = await Promise.all([
          supabase.from('participants').select('user_id, profiles(display_name)').eq('competition_id', competitionId),
          supabase.from('gameweek_scores').select('user_id, gameweek_id, points, exact_scores, full_house_results, full_house_scores')
            .eq('competition_id', competitionId).in('gameweek_id', done.map(g => g.id)),
        ])
        const name = new Map((parts || []).map(p => [p.user_id, short(p.profiles?.display_name)]))
        const out = []

        // Triple Points this gameweek, once it has kicked off.
        if (isLeague && current) {
          const { data: fx } = await supabase.from('fixtures').select('kickoff_time').eq('gameweek_id', current.id)
          const first = (fx || []).map(f => f.kickoff_time).sort()[0]
          if (first && new Date(first) <= new Date()) {
            const { data: tp } = await supabase.from('triple_points_plays').select('user_id')
              .eq('competition_id', competitionId).eq('gameweek_id', current.id)
            const who = (tp || []).map(t => name.get(t.user_id)).filter(Boolean)
            if (who.length) out.push({ icon: '⚡', text: `${list(who)} ${who.length === 1 ? 'has' : 'have'} played Triple Points in ${label(current.number)}` })
          }
        }

        if (last) {
          const rows = (scores || []).filter(s => s.gameweek_id === last.id)
          // Who played Triple Points last gameweek, and what it got them.
          const { data: lastTp } = isLeague
            ? await supabase.from('triple_points_plays').select('user_id').eq('competition_id', competitionId).eq('gameweek_id', last.id)
            : { data: [] }
          const tripled = new Set((lastTp || []).map(t => t.user_id))
          const top = Math.max(0, ...rows.map(r => r.points || 0))
          const topRows = rows.filter(r => (r.points || 0) === top && top > 0)
          const toppers = topRows.map(r => name.get(r.user_id)).filter(Boolean)
          if (toppers.length) {
            const boosted = topRows.length === 1 && tripled.has(topRows[0].user_id)
            out.push({ icon: '🏆', text: `${list(toppers)} topped ${label(last.number)} with ${top} pts${boosted ? ', thanks to Triple Points ⚡' : ''}` })
          }
          const tpRows = rows.filter(r => tripled.has(r.user_id) && name.get(r.user_id))
          if (tpRows.length) {
            out.push({ icon: '⚡', text: `Triple Points in ${label(last.number)}: ${list(tpRows.map(r => `${name.get(r.user_id)} ${r.points || 0} pts`))}` })
          }

          const exact = Math.max(0, ...rows.map(r => r.exact_scores || 0))
          const sharp = rows.filter(r => (r.exact_scores || 0) === exact && exact > 1).map(r => name.get(r.user_id)).filter(Boolean)
          if (sharp.length && sharp.length <= 3) out.push({ icon: '🎯', text: `${list(sharp)} got ${exact} exact scores in ${label(last.number)}` })

          rows.filter(r => r.full_house_scores).forEach(r => out.push({ icon: '💯', text: `Full house! ${name.get(r.user_id)} got every score exactly right in ${label(last.number)}` }))
          rows.filter(r => r.full_house_results && !r.full_house_scores).forEach(r => out.push({ icon: '✅', text: `${name.get(r.user_id)} got every result right in ${label(last.number)}` }))

          // Biggest climber: season positions before and after the last gameweek.
          if (done.length > 1) {
            const totalTo = upto => {
              const keep = new Set(done.slice(0, upto).map(g => g.id)), t = {}
              ;(scores || []).forEach(s => { if (keep.has(s.gameweek_id)) t[s.user_id] = (t[s.user_id] || 0) + (s.points || 0) })
              return t
            }
            const before = totalTo(done.length - 1), after = totalTo(done.length)
            const place = (t, u) => Object.values(t).filter(v => v > (t[u] || 0)).length + 1
            let best = null
            Object.keys(after).forEach(u => {
              const up = place(before, u) - place(after, u)
              if (up > 0 && (!best || up > best.up)) best = { u, up, now: place(after, u) }
            })
            if (best && best.up >= 2) {
              const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th')
              out.push({ icon: '📈', text: `${name.get(best.u)} climbed ${best.up} places to ${ord(best.now)}` })
            }
          }
        }
        if (!cancelled) setItems(out)
      } catch { if (!cancelled) setItems([]) }
    })()
    return () => { cancelled = true }
  }, [competitionId, isLeague])

  if (!items.length) return null
  const line = items.map((h, i) => (
    <span key={i} className="inline-flex items-center gap-1.5 px-4 text-xs" style={{ color: 'var(--txt-second)' }}>
      <span aria-hidden="true">{h.icon}</span>{h.text}
      <span aria-hidden="true" className="pl-4" style={{ color: 'var(--txt-muted)' }}>•</span>
    </span>
  ))
  return (
    <div className="headline-strip mb-3 rounded-lg overflow-hidden flex items-stretch"
      style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}
      aria-label={items.map(h => h.text).join('. ')} role="marquee">
      <span className="flex items-center px-2.5 text-[10px] font-bold tracking-wider flex-shrink-0"
        style={{ background: 'var(--accent)', color: '#fff', zIndex: 1 }}>HEADLINES</span>
      <div className="overflow-hidden py-2 flex-1" style={{ minWidth: 0 }}>
        <div className="headline-track" style={{ '--headline-secs': `${Math.max(18, items.length * 9)}s` }}>
          {line}{line}
        </div>
      </div>
    </div>
  )
}
