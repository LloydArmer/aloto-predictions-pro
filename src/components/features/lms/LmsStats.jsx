import { useState } from 'react'
import { formatUK } from '../../../lib/time'
import {
  roundName, pickState, STATE_STYLE, entryTag, teamCode, FORM_STYLE, fixtureStatus,
  leagueTeams, usedTeams, VOID,
} from '../../../lib/lms'
import { Card, SectionLabel } from '../../ui'

/**
 * Last Man Standing stats: the pick grid, a gameweek's pick breakdown,
 * everyone's games live and the teams an entry has left. Everything here only
 * reads what loadLms returns; picks the database hides (other people's, before
 * the gameweek locks) never reach the screen.
 */

const GOOD = ['won', 'void', 'winning']
const BAD = ['lost', 'drew', 'losing']

export const playerLabel = (e, entries) => {
  const t = e ? entryTag(e, entries) : ''
  return `${e?.profile?.display_name || 'Player'}${t ? ` ${t}` : ''}`
}

/** A small badge with a team's three-letter code. */
export function TeamCode({ sport, name, faded, size = 'sm' }) {
  return (
    <span className={`inline-flex items-center justify-center rounded font-bold ${size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'}`}
      style={{
        minWidth: size === 'sm' ? 32 : 40, letterSpacing: '0.03em',
        background: 'var(--bg-raised)', border: '0.5px solid var(--border-med)',
        color: faded ? 'var(--txt-muted)' : 'var(--txt-primary)', opacity: faded ? 0.5 : 1,
      }}>{teamCode(sport, name)}</span>
  )
}

/** Last five results as W/D/L squares, oldest on the left. */
export function FormChips({ form }) {
  if (!form.length) return <span className="text-[10px]" style={{ color: 'var(--txt-muted)' }}>No games yet</span>
  return (
    <span className="inline-flex gap-0.5" aria-label={`Form ${form.map(f => f.res).join(' ')}`}>
      {form.map((f, i) => (
        <span key={i} title={`${f.res} ${f.score} v ${f.opp} (${f.home ? 'H' : 'A'})`}
          className="inline-flex items-center justify-center rounded-sm text-[9px] font-bold"
          style={{ width: 15, height: 15, background: FORM_STYLE[f.res].bg, color: FORM_STYLE[f.res].color }}>{f.res}</span>
      ))}
    </span>
  )
}

/** A centred sheet over the page; tap outside to close. */
export function Sheet({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-xl p-4 overflow-y-auto"
        style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-med)', maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// ───────────────────────── Pick grid ─────────────────────────

/**
 * Every entry down the side, every gameweek across: green through, red out,
 * amber still playing. This gameweek shows ✓ or ? until picks lock.
 */
export function PickGrid({ data, userId }) {
  const { game, entries, picks, locked, hasPick, fixturesById } = data
  const [breakdown, setBreakdown] = useState(null)
  const running = ['open', 'running'].includes(game.status)
  const last = running ? game.current_round : (game.ended_round ?? game.current_round)
  const rounds = []
  for (let r = game.start_round; r <= last; r++) rounds.push(r)
  const lockedRound = r => r < game.current_round || locked || !running

  const pickOf = new Map(picks.map(p => [`${p.entry_id}:${p.round}`, p]))
  const rank = e => (e.status === 'winner' ? 0 : e.status === 'alive' ? 1 : 2)
  const rows = [...entries].sort((a, b) =>
    rank(a) - rank(b) || (b.out_round ?? 0) - (a.out_round ?? 0) || playerLabel(a, entries).localeCompare(playerLabel(b, entries)))

  if (!rounds.length) return <Card className="p-4"><p className="text-sm" style={{ color: 'var(--txt-muted)' }}>The grid fills in from the first gameweek.</p></Card>

  return (
    <div>
      <Card className="p-3 mb-3">
        <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>
          Tap a {game.sport === 'nfl' ? 'week' : 'gameweek'} at the top to see how everyone picked. Other players' picks show once that {game.sport === 'nfl' ? 'week' : 'gameweek'} locks.
        </p>
      </Card>
      <Card className="mb-3 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-[11px]" style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%' }}>
            <thead>
              <tr>
                <th className="text-left px-3 py-2 sticky left-0 z-10" style={{ background: 'var(--bg-surface, var(--bg-elevated))', color: 'var(--txt-muted)', fontWeight: 600, minWidth: 110 }}>Player</th>
                {rounds.map(r => (
                  <th key={r} className="px-1 py-2 text-center" style={{ fontWeight: 600 }}>
                    <button type="button" disabled={!lockedRound(r)} onClick={() => setBreakdown(r)}
                      className="rounded px-1.5 py-0.5 whitespace-nowrap"
                      style={{ color: lockedRound(r) ? 'var(--accent)' : 'var(--txt-muted)', background: lockedRound(r) ? 'var(--accent-dim)' : 'transparent' }}>
                      {roundName(game, r).replace('Week ', 'W')}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(e => {
                const mine = e.user_id === userId
                return (
                  <tr key={e.id}>
                    <td className="px-3 py-1 sticky left-0 z-10 truncate" style={{
                      maxWidth: 140, background: mine ? 'var(--accent-dim)' : 'var(--bg-surface, var(--bg-elevated))',
                      color: e.status === 'out' ? 'var(--txt-muted)' : mine ? 'var(--accent)' : 'var(--txt-primary)',
                      fontWeight: mine ? 700 : 500, borderTop: '0.5px solid var(--border)',
                    }}>
                      {e.status === 'winner' && '🏆 '}{playerLabel(e, entries)}
                    </td>
                    {rounds.map(r => <GridCell key={r} game={game} entry={e} round={r} pick={pickOf.get(`${e.id}:${r}`)}
                      fixturesById={fixturesById} hidden={!lockedRound(r) && !mine} picked={hasPick.get(e.id)} running={running} />)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[10px] px-1" style={{ color: 'var(--txt-muted)' }}>
        <span style={{ color: 'var(--green)' }}>■</span> through · <span style={{ color: 'var(--red)' }}>■</span> out · <span style={{ color: 'var(--amber)' }}>■</span> playing now · * given automatically · ✓ picked, ? not yet (hidden until lock)
      </p>
      {breakdown != null && <RoundBreakdown data={data} round={breakdown} onRound={setBreakdown} onClose={() => setBreakdown(null)} canShow={lockedRound} />}
    </div>
  )
}

function GridCell({ game, entry, round, pick, fixturesById, hidden, picked, running }) {
  const base = { borderTop: '0.5px solid var(--border)' }
  const box = (text, bg, color, title) => (
    <td className="px-0.5 py-1 text-center" style={base} title={title}>
      <span className="inline-block rounded font-bold py-1" style={{ minWidth: 38, background: bg, color, letterSpacing: '0.03em' }}>{text}</span>
    </td>
  )

  if (entry.out_round != null && round > entry.out_round) return <td style={base} />
  if (hidden) {
    if (entry.status !== 'alive' || round !== game.current_round || !running) return <td style={base} />
    return picked ? box('✓', 'var(--bg-raised)', 'var(--green)', 'Picked') : box('?', 'var(--bg-raised)', 'var(--txt-muted)', 'Not picked yet')
  }
  if (!pick) {
    if (entry.out_round === round && entry.out_reason === 'no_pick') return box('NP', 'var(--red-dim)', 'var(--red)', 'No team left')
    if (entry.status === 'alive' && round === game.current_round && running) return box('?', 'var(--bg-raised)', 'var(--txt-muted)', 'Not picked yet')
    return <td style={base} />
  }
  const state = pickState(pick, fixturesById.get(pick.api_fixture_id))
  const [bg, color] = ['won', 'void'].includes(state) ? ['var(--green-dim)', 'var(--green)']
    : ['lost', 'drew'].includes(state) ? ['var(--red-dim)', 'var(--red)']
    : ['winning', 'drawing', 'losing'].includes(state) ? ['var(--amber-dim)', 'var(--amber)']
    : ['var(--bg-raised)', 'var(--txt-primary)']
  return box(`${teamCode(game.sport, pick.team_name)}${pick.auto ? '*' : ''}`, bg, color, `${pick.team_name} · ${STATE_STYLE[state].label}`)
}

// ───────────────────────── Gameweek breakdown ─────────────────────────

/** What share of entries picked each team in a gameweek, and how each team did. */
export function RoundBreakdown({ data, round, onRound, onClose, canShow }) {
  const { game, picks, fixturesById } = data
  const list = picks.filter(p => p.round === round)
  const byTeam = new Map()
  list.forEach(p => {
    const t = byTeam.get(p.team_id) || { name: p.team_name, count: 0, pick: p }
    t.count++
    byTeam.set(p.team_id, t)
  })
  const teams = [...byTeam.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const hasPrev = round > game.start_round
  const hasNext = canShow(round + 1) && round + 1 <= game.current_round

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center justify-between mb-3">
        <button type="button" aria-label="Previous" disabled={!hasPrev} onClick={() => onRound(round - 1)}
          className="w-8 h-8 rounded-full" style={{ background: 'var(--bg-raised)', color: hasPrev ? 'var(--txt-primary)' : 'var(--txt-muted)', opacity: hasPrev ? 1 : 0.4 }}>
          <i className="ti ti-chevron-left" aria-hidden="true" />
        </button>
        <p className="text-base font-bold" style={{ color: 'var(--txt-primary)' }}>{roundName(game, round)} picks</p>
        <div className="flex gap-1">
          <button type="button" aria-label="Next" disabled={!hasNext} onClick={() => onRound(round + 1)}
            className="w-8 h-8 rounded-full" style={{ background: 'var(--bg-raised)', color: hasNext ? 'var(--txt-primary)' : 'var(--txt-muted)', opacity: hasNext ? 1 : 0.4 }}>
            <i className="ti ti-chevron-right" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-full" style={{ background: 'var(--bg-raised)', color: 'var(--txt-primary)' }}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--txt-muted)' }}>
        {list.length} entr{list.length === 1 ? 'y' : 'ies'} · <span style={{ color: 'var(--green)' }}>✓ through</span> · <span style={{ color: 'var(--red)' }}>✗ out</span> · <span>… still to finish</span>
      </p>
      {teams.length === 0 && <p className="text-sm" style={{ color: 'var(--txt-muted)' }}>No picks this {game.sport === 'nfl' ? 'week' : 'gameweek'}.</p>}
      {teams.map(t => {
        const state = pickState(t.pick, fixturesById.get(t.pick.api_fixture_id))
        const good = ['won', 'void'].includes(state), bad = ['lost', 'drew'].includes(state)
        const color = good ? 'var(--green)' : bad ? 'var(--red)' : 'var(--accent)'
        const pct = Math.round((t.count / list.length) * 100)
        return (
          <div key={t.name} className="flex items-center gap-2 mb-2">
            <span className="w-24 flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold truncate" style={{ color: 'var(--txt-primary)' }}>
              <TeamCode sport={game.sport} name={t.name} />
              <span style={{ color }}>{good ? '✓' : bad ? '✗' : '…'}</span>
            </span>
            <span className="flex-1 h-4 rounded" style={{ background: 'var(--bg-raised)' }}>
              <span className="block h-4 rounded" style={{ width: `${Math.max(pct, 3)}%`, background: color, opacity: 0.85 }} />
            </span>
            <span className="w-16 text-right text-xs" style={{ color: 'var(--txt-second)' }}>{pct}% · {t.count}</span>
          </div>
        )
      })}
    </Sheet>
  )
}

// ───────────────────────── Everyone's games ─────────────────────────

/**
 * This gameweek's fixtures with the live score and who is on each side, once
 * picks have locked. Before that, the fixtures and when picks will show.
 */
export function LiveGames({ data, userId }) {
  const { game, entries, picks, locked, lock, current } = data
  const fixtures = current
  const running = ['open', 'running'].includes(game.status)
  const byId = new Map(entries.map(e => [e.id, e]))
  const roundPicks = picks.filter(p => p.round === game.current_round)
  const states = roundPicks.map(p => ({ p, state: pickState(p, data.fixturesById.get(p.api_fixture_id)) }))
  const atRisk = states.filter(s => BAD.includes(s.state)).length
  const safe = states.filter(s => GOOD.includes(s.state)).length

  if (!running) return <Card className="p-4"><p className="text-sm" style={{ color: 'var(--txt-muted)' }}>This game has finished. See the Grid for every pick.</p></Card>
  if (!fixtures.length) return <Card className="p-4"><p className="text-sm" style={{ color: 'var(--txt-muted)' }}>The {roundName(game, game.current_round)} fixtures aren't loaded yet.</p></Card>

  return (
    <div>
      <Card className="p-3 mb-3">
        <div className="flex items-center justify-between">
          <SectionLabel>{roundName(game, game.current_round)} · everyone's games</SectionLabel>
          {locked && <span className="text-[11px] font-semibold">
            <span style={{ color: 'var(--green)' }}>{safe} safe</span>
            <span style={{ color: 'var(--txt-muted)' }}> · </span>
            <span style={{ color: atRisk ? 'var(--red)' : 'var(--txt-muted)' }}>{atRisk} at risk</span>
          </span>}
        </div>
        {!locked && lock && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--txt-muted)' }}>
            Who's on what shows here when picks lock, {formatUK(lock, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.
          </p>
        )}
      </Card>

      {fixtures.map(f => {
        const status = fixtureStatus(f)
        const off = VOID.includes(f.status)
        const side = teamId => roundPicks.filter(p => p.team_id === teamId)
        const home = side(f.home_team_id), away = side(f.away_team_id)
        const mineHere = [...home, ...away].some(p => p.user_id === userId)
        const scoreColor = status && status !== 'Off' ? 'var(--txt-primary)' : 'var(--txt-muted)'
        return (
          <Card key={f.api_fixture_id} className="p-3 mb-2" style={mineHere ? { borderLeft: '3px solid var(--accent)' } : undefined}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt-primary)' }}>
                {f.home_team} <span style={{ color: 'var(--txt-muted)', fontWeight: 400 }}>{game.sport === 'nfl' ? '@' : 'v'}</span> {f.away_team}
              </p>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                {status && <span className="text-[10px] font-semibold" style={{ color: status === 'FT' ? 'var(--txt-muted)' : 'var(--green)' }}>{status}</span>}
                {f.home_goals != null && !off
                  ? <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'var(--bg-raised)', color: scoreColor }}>{f.home_goals} – {f.away_goals}</span>
                  : <span className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>{off ? 'Postponed' : formatUK(f.kickoff, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
              </span>
            </div>
            {locked && (home.length > 0 || away.length > 0) && (
              <div className="mt-1.5 space-y-0.5">
                {[[f.home_team, home], [f.away_team, away]].filter(([, l]) => l.length).map(([team, l]) => {
                  const st = STATE_STYLE[pickState(l[0], f)]
                  const names = l.map(p => p.user_id === userId ? 'You' : playerLabel(byId.get(p.entry_id), entries))
                    .sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : a.localeCompare(b)))
                  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
                  return (
                    <p key={team} className="text-[11px]" style={{ color: 'var(--txt-second)' }}>
                      <span className="font-semibold" style={{ color: st.color }}>{l.length} on {team}</span>: {shown}
                    </p>
                  )
                })}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ───────────────────────── Remaining teams ─────────────────────────

/** The teams an entry can still pick, with the used ones faded. */
export function RemainingTeams({ data, entryPicks }) {
  const { game, seasonFixtures, standings, teamCount } = data
  const teams = leagueTeams(seasonFixtures, standings)
  if (!teams.length) return null
  const used = usedTeams(entryPicks, game.current_round + 1, teamCount)
  // This gameweek's pick counts as used only once picks lock; before that it can still change.
  const left = teams.filter(t => !used.has(t.id))
  return (
    <Card className="p-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>Teams left</SectionLabel>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>{left.length} of {teams.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {teams.map(t => (
          <span key={t.id} title={t.name + (used.has(t.id) ? ` · used ${roundName(game, used.get(t.id))}` : '')}>
            <TeamCode sport={game.sport} name={t.name} faded={used.has(t.id)} />
          </span>
        ))}
      </div>
      <p className="text-[10px] mt-2" style={{ color: 'var(--txt-muted)' }}>
        Faded teams have been used by this entry (including this {game.sport === 'nfl' ? 'week' : 'gameweek'}'s pick). Once every team is used, the list starts again.
      </p>
    </Card>
  )
}
