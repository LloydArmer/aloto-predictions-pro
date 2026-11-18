import { useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import {
  roundName, leagueTeams, usedTeams, difficulty, DIFFICULTY_STYLE, teamCode, lastRound, VOID, FINISHED,
} from '../../../lib/lms'
import { Card, SectionLabel } from '../../ui'
import { TeamCode } from './LmsStats'

/**
 * Pick planner: plan which team an entry will use in each gameweek ahead.
 *
 *   Fixtures  every team down the side, every gameweek across; each square is
 *             that team's opponent, coloured easier / even / harder from the
 *             league table. Tap one to plan that team for that gameweek.
 *   My route  the plan as a list, gameweek by gameweek.
 *
 * A plan is private. At the deadline a missed pick uses the planned team (migration 136).
 */
export default function LmsPlanner({ data, entry, entryPicks, onSaved }) {
  const { game, seasonFixtures, standings, teamCount, locked, plans, plannerReady } = data
  const [view, setView] = useState('fixtures')
  const [busy, setBusy] = useState(false)
  const rn = r => roundName(game, r)
  const short = r => rn(r).replace('Week ', 'W')

  const firstRound = locked ? game.current_round + 1 : game.current_round
  const finalRound = lastRound(seasonFixtures)
  const rounds = []
  for (let r = firstRound; r <= finalRound; r++) rounds.push(r)

  const teams = useMemo(() => leagueTeams(seasonFixtures, standings), [seasonFixtures, standings])
  // A team's game in each gameweek (the first if it has two).
  const gameOf = useMemo(() => {
    const m = new Map()
    seasonFixtures.forEach(f => {
      if (f.round < firstRound || VOID.includes(f.status) || FINISHED.includes(f.status)) return
      ;[[f.home_team_id, f.away_team_id, f.away_team, true], [f.away_team_id, f.home_team_id, f.home_team, false]].forEach(([id, oppId, opp, home]) => {
        const k = `${id}:${f.round}`
        if (!m.has(k)) m.set(k, { oppId, opp, home })
      })
    })
    return m
  }, [seasonFixtures, firstRound])

  const myPlans = plans.filter(p => p.entry_id === entry?.id)
  const planByRound = new Map(myPlans.map(p => [p.round, p]))
  const roundByTeam = new Map(myPlans.map(p => [p.team_id, p.round]))
  // Teams this entry has already used (this gameweek's pick counts once it is locked).
  const used = usedTeams(entryPicks, locked ? game.current_round + 1 : game.current_round, teamCount)

  if (!['open', 'running'].includes(game.status)) return <Note text="This game has finished, so there's nothing left to plan." />
  if (!entry) return <Note text="You're not in this game, so there's nothing to plan." />
  if (entry.status !== 'alive') return <Note text="This entry is out, so there's nothing left to plan." />
  if (!plannerReady) return <Note text="The planner is being switched on. Try again shortly." />
  if (!rounds.length || !teams.length) return <Note text="Future fixtures aren't loaded yet. They appear automatically." />

  async function plan(team, round) {
    if (busy) return
    setBusy(true)
    try {
      const current = planByRound.get(round)
      if (current?.team_id === team.id) {
        const { error } = await supabase.from('lms_plans').delete().eq('entry_id', entry.id).eq('round', round)
        if (error) throw error
      } else {
        // A team goes in one gameweek of the plan only: move it if it was elsewhere.
        const was = roundByTeam.get(team.id)
        if (was != null) {
          const { error } = await supabase.from('lms_plans').delete().eq('entry_id', entry.id).eq('round', was)
          if (error) throw error
        }
        const { error } = await supabase.from('lms_plans').upsert({
          entry_id: entry.id, game_id: game.id, user_id: entry.user_id,
          round, team_id: team.id, team_name: team.name, updated_at: new Date().toISOString(),
        }, { onConflict: 'entry_id,round' })
        if (error) throw error
      }
      await onSaved()
    } catch (err) {
      toast.error(err.message || 'Could not save your plan')
    } finally { setBusy(false) }
  }

  async function clearAll() {
    if (!myPlans.length || !window.confirm('Clear your whole plan for this entry?')) return
    setBusy(true)
    const { error } = await supabase.from('lms_plans').delete().eq('entry_id', entry.id)
    if (error) toast.error(error.message)
    await onSaved()
    setBusy(false)
  }

  const placed = rounds.filter(r => planByRound.has(r)).length

  return (
    <div>
      <div className="tab-strip mb-3">
        {[['fixtures', 'Fixtures'], ['route', 'My route']].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)}
            className="px-3 py-1.5 rounded-md text-xs"
            style={{ background: view === k ? 'var(--accent-dim)' : 'transparent', color: view === k ? 'var(--accent)' : 'var(--txt-second)', fontWeight: view === k ? 600 : 400 }}>
            {label}
          </button>
        ))}
      </div>

      {/* The route so far, as a strip. */}
      <Card className="p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <SectionLabel>Your route{entry.entry_no > 1 ? ` · entry ${entry.entry_no}` : ''}</SectionLabel>
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>{placed} of {rounds.length} planned</span>
            {myPlans.length > 0 && <button type="button" className="text-[11px]" style={{ color: 'var(--txt-muted)' }} onClick={clearAll} disabled={busy}>Clear</button>}
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {rounds.map(r => {
            const p = planByRound.get(r)
            return (
              <div key={r} className="flex flex-col items-center gap-1 flex-shrink-0" style={{ minWidth: 40 }}>
                <span className="text-[9px] font-semibold" style={{ color: 'var(--txt-muted)' }}>{short(r)}</span>
                {p ? <TeamCode sport={game.sport} name={p.team_name} />
                   : <span className="text-[10px] rounded px-1.5 py-0.5" style={{ minWidth: 32, textAlign: 'center', border: '0.5px dashed var(--border-med)', color: 'var(--txt-muted)' }}>–</span>}
              </div>
            )
          })}
        </div>
      </Card>

      {view === 'fixtures' ? <>
        <div className="flex flex-wrap items-center gap-1.5 mb-2 px-1">
          {Object.entries(DIFFICULTY_STYLE).map(([k, d]) => (
            <span key={k} className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: d.bg, color: d.color, border: `0.5px solid ${d.line}` }}>{d.label}</span>
          ))}
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: 'var(--accent)', border: '1px solid var(--accent)' }}>Planned</span>
          <span className="text-[10px]" style={{ color: 'var(--txt-muted)' }}>Tap a game to plan it, tap again to remove.</span>
        </div>
        <Card className="mb-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-[10px]" style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10" style={{ background: 'var(--bg-surface)', minWidth: 44 }} />
                  {rounds.map(r => <th key={r} className="px-1 py-1 font-semibold whitespace-nowrap" style={{ color: 'var(--accent)' }}>{short(r)}</th>)}
                </tr>
              </thead>
              <tbody>
                {teams.map(t => {
                  const usedIn = used.get(t.id)
                  return (
                    <tr key={t.id} style={{ opacity: usedIn != null ? 0.35 : 1 }}>
                      <td className="sticky left-0 z-10 pr-1" style={{ background: 'var(--bg-surface)' }} title={usedIn != null ? `${t.name} · used ${rn(usedIn)}` : t.name}>
                        <TeamCode sport={game.sport} name={t.name} />
                      </td>
                      {rounds.map(r => {
                        const g = gameOf.get(`${t.id}:${r}`)
                        if (!g) return <td key={r} className="text-center" style={{ color: 'var(--txt-muted)' }}>–</td>
                        const d = DIFFICULTY_STYLE[difficulty(standings, t.id, g.oppId, teamCount)]
                        const on = planByRound.get(r)?.team_id === t.id
                        return (
                          <td key={r} className="p-0">
                            <button type="button" disabled={usedIn != null || busy} onClick={() => plan(t, r)}
                              className="rounded-md text-center leading-tight"
                              style={{ width: 44, padding: '4px 0', background: d.bg, color: d.color, border: on ? '2px solid var(--accent)' : `0.5px solid ${d.line}`, boxShadow: on ? '0 0 10px -2px var(--accent-glow)' : 'none' }}>
                              <span className="block font-bold" style={{ color: on ? 'var(--txt-primary)' : d.color }}>{teamCode(game.sport, g.opp)}</span>
                              <span className="block" style={{ fontSize: 9 }}>{g.home ? 'H' : 'A'}</span>
                            </button>
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
        <p className="text-[10px] px-1" style={{ color: 'var(--txt-muted)' }}>
          Easier and harder come from the league table: an opponent well below or well above. Faded teams have been used by this entry. Your plan is private. If you forget to pick, your planned team is used as your pick at the deadline.
        </p>
      </> : (
        <Card className="mb-3 overflow-hidden">
          {rounds.map(r => {
            const p = planByRound.get(r)
            const g = p ? gameOf.get(`${p.team_id}:${r}`) : null
            const d = g ? DIFFICULTY_STYLE[difficulty(standings, p.team_id, g.oppId, teamCount)] : null
            return (
              <div key={r} className="flex items-center gap-3 px-4 py-2" style={{ borderTop: '0.5px solid var(--border)' }}>
                <span className="w-12 text-xs font-semibold" style={{ color: 'var(--txt-muted)' }}>{rn(r)}</span>
                {p ? <>
                  <TeamCode sport={game.sport} name={p.team_name} />
                  <span className="flex-1 text-sm truncate" style={{ color: 'var(--txt-primary)' }}>
                    {p.team_name}
                    {g && <span className="text-[11px] ml-1.5" style={{ color: 'var(--txt-muted)' }}>{g.home ? 'v' : '@'} {g.opp} ({g.home ? 'H' : 'A'})</span>}
                  </span>
                  {d && <span className="text-[10px] font-semibold" style={{ color: d.color }}>{d.label}</span>}
                </> : <span className="flex-1 text-xs" style={{ color: 'var(--txt-muted)' }}>Not planned</span>}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}

function Note({ text }) {
  return <Card className="p-4"><p className="text-sm" style={{ color: 'var(--txt-muted)' }}>{text}</p></Card>
}
