import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { sortGameweeks } from '../../../lib/gameweeks'

const ROUND = { playoff: 'Playoff round', r64: 'Round of 64', r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-finals', sf: 'Semi-finals', f: 'Final' }
// "ALOTO Carabao Cup - 26/27" -> "Carabao Cup"
const cupName = n => String(n || 'Cup').replace(/^ALOTO\s+/i, '').replace(/\s*[-–]\s*\d{2}\/\d{2}\s*$/, '').trim()
const label = n => (/^\d+$/.test(String(n)) ? `GW${n}` : n)
const short = name => {
  const [first, ...rest] = String(name || 'Someone').trim().split(/\s+/)
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first
}
const list = names => names.length <= 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * A scrolling strip of headlines across the top of the Dashboard: who has
 * played Triple Points this gameweek, last gameweek's top scorer, biggest
 * climber, most exact scores and any full house, plus the knockout rounds
 * of the viewer's cups being played this gameweek and who went through last.
 *
 * League news comes from the viewer's league, even on a cup's Dashboard.
 * Triple Points plays are only shown once the gameweek's first match has
 * kicked off. They can't be changed after that, and nobody gets a heads-up
 * on someone else's plan before the deadline.
 */
export default function Headlines({ competitionId, isLeague, userId }) {
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!competitionId) { setItems([]); return }
    let cancelled = false
    ;(async () => {
      try {
        // League news (top scorer, Triple Points, climbers) always comes from
        // the LEAGUE: on a cup's Dashboard it uses the viewer's league that
        // plays the same gameweeks, because Triple Points only exists there
        // and a cup's own gameweek scores leave it out.
        let src = competitionId, srcLeague = isLeague
        if (!isLeague && userId) {
          const { data: myLeagues } = await supabase.from('participants')
            .select('competition_id, competitions!inner(format)').eq('user_id', userId).eq('competitions.format', 'league')
          const { data: cupGws } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', competitionId)
          const leagueIds = (myLeagues || []).map(l => l.competition_id)
          if (leagueIds.length && cupGws?.length) {
            const { data: shared } = await supabase.from('competition_gameweeks').select('competition_id')
              .in('competition_id', leagueIds).in('gameweek_id', cupGws.map(g => g.gameweek_id)).limit(1)
            if (shared?.[0]) { src = shared[0].competition_id; srcLeague = true }
          }
        }
        const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', src)
        const ids = (links || []).map(l => l.gameweek_id)
        if (!ids.length) { setItems([]); return }
        const { data: gwsRaw } = await supabase.from('gameweeks').select('id, number, status').in('id', ids)
        const gws = sortGameweeks(gwsRaw || [])
        const current = [...gws].reverse().find(g => g.status === 'active')
        const done = gws.filter(g => g.status === 'completed')
        const last = done[done.length - 1]

        const [{ data: parts }, { data: scores }] = await Promise.all([
          supabase.from('participants').select('user_id, profiles(display_name)').eq('competition_id', src),
          supabase.from('gameweek_scores').select('user_id, gameweek_id, points, exact_scores, full_house_results, full_house_scores')
            .eq('competition_id', src).in('gameweek_id', done.map(g => g.id)),
        ])
        const name = new Map((parts || []).map(p => [p.user_id, short(p.profiles?.display_name)]))
        const out = []

        // Triple Points this gameweek, once it has kicked off.
        if (srcLeague && current) {
          const { data: fx } = await supabase.from('fixtures').select('kickoff_time').eq('gameweek_id', current.id)
          const first = (fx || []).map(f => f.kickoff_time).sort()[0]
          if (first && new Date(first) <= new Date()) {
            const { data: tp } = await supabase.from('triple_points_plays').select('user_id')
              .eq('competition_id', src).eq('gameweek_id', current.id)
            const who = (tp || []).map(t => name.get(t.user_id)).filter(Boolean)
            if (who.length) out.push({ icon: '⚡', text: `${list(who)} ${who.length === 1 ? 'has' : 'have'} played Triple Points in ${label(current.number)}` })
          }
        }

        if (last) {
          const rows = (scores || []).filter(s => s.gameweek_id === last.id)
          // Who played Triple Points last gameweek, and what it got them.
          const { data: lastTp } = srcLeague
            ? await supabase.from('triple_points_plays').select('user_id').eq('competition_id', src).eq('gameweek_id', last.id)
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
        // Cups the viewer is in: rounds played this gameweek, and who went
        // through in the last one.
        try {
          const { data: mine } = userId
            ? await supabase.from('participants').select('competition_id, competitions!inner(name, format)')
                .eq('user_id', userId).eq('competitions.format', 'knockout')
            : { data: [] }
          const { data: mineGk } = userId
            ? await supabase.from('participants').select('competition_id, competitions!inner(name, format)')
                .eq('user_id', userId).eq('competitions.format', 'group_knockout')
            : { data: [] }
          const cups = [...(mine || []), ...(mineGk || [])]
          const cupIds = cups.map(c => c.competition_id)
          const cupName_ = new Map(cups.map(c => [c.competition_id, cupName(c.competitions?.name)]))
          const gwIds = [current?.id, last?.id].filter(Boolean)
          if (cupIds.length && gwIds.length) {
            const [{ data: ties }, { data: roundGws }] = await Promise.all([
              supabase.from('bracket_matches')
                .select('competition_id, round, gameweek_id, status, home_user_id, away_user_id, winner_user_id, is_replay')
                .in('competition_id', cupIds),
              supabase.from('bracket_round_gameweeks').select('competition_id, round, gameweek_id').in('competition_id', cupIds),
            ])
            const rgw = new Map((roundGws || []).map(r => [`${r.competition_id}:${r.round}`, r.gameweek_id]))
            const gwOf = t => t.gameweek_id || rgw.get(`${t.competition_id}:${t.round}`)
            const real = (ties || []).filter(t => t.home_user_id && t.away_user_id)
            const groups = (gwId, pick) => {
              const m = new Map()
              real.filter(t => gwOf(t) === gwId && pick(t)).forEach(t => {
                const k = `${t.competition_id}:${t.round}`
                m.set(k, [...(m.get(k) || []), t])
              })
              return m
            }
            if (current) {
              groups(current.id, () => true).forEach((tieList, k) => {
                const [cid, round] = k.split(':')
                out.push({ icon: '🏆', text: `${cupName_.get(cid)} ${ROUND[round] || round} in ${label(current.number)}: ${tieList.length} tie${tieList.length === 1 ? '' : 's'}` })
              })
            }
            if (last && last.id !== current?.id) {
              const done_ = groups(last.id, t => t.status === 'completed' && t.winner_user_id)
              const winners = [...done_.values()].flat().map(t => t.winner_user_id).filter(u => !name.has(u))
              if (winners.length) {
                const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', [...new Set(winners)])
                ;(profs || []).forEach(p => name.set(p.id, short(p.display_name)))
              }
              done_.forEach((tieList, k) => {
                const [cid, round] = k.split(':')
                const through = tieList.map(t => name.get(t.winner_user_id)).filter(Boolean)
                if (through.length) out.push({ icon: '🏆', text: `${cupName_.get(cid)} ${ROUND[round] || round}: ${list(through)} through` })
              })
            }
          }
        } catch { /* cups are a bonus */ }

        if (!cancelled) setItems(out)
      } catch { if (!cancelled) setItems([]) }
    })()
    return () => { cancelled = true }
  }, [competitionId, isLeague, userId])

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
