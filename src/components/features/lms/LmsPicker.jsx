import { useState, useMemo } from 'react'
import { formatUK } from '../../../lib/time'
import {
  roundName, teamForm, teamResults, teamUpcoming, ordinal, difficulty, DIFFICULTY_STYLE, FORM_STYLE, VOID, teamCode,
} from '../../../lib/lms'
import { FormChips, TeamCode, Sheet } from './LmsStats'

const SORTS = [
  { key: 'kickoff', label: 'Kick-off' },
  { key: 'table',   label: 'Table' },
  { key: 'form',    label: 'Form' },
]

/**
 * The gameweek's teams to pick from, one row each: opponent, home or away,
 * kick-off, league position and last five results. Used teams are struck
 * through. Tapping a team opens a confirm sheet with its recent and next games.
 */
export function TeamPicker({ data, used, myPick, planned, saving, onPick }) {
  const { game, current, seasonFixtures, standings, teamCount } = data
  const [sort, setSort] = useState('kickoff')
  const [confirm, setConfirm] = useState(null)
  const rn = r => roundName(game, r)

  const rows = useMemo(() => {
    const list = []
    current.forEach(f => {
      const off = VOID.includes(f.status)
      ;[[f.home_team_id, f.home_team, f.away_team_id, f.away_team, true], [f.away_team_id, f.away_team, f.home_team_id, f.home_team, false]]
        .forEach(([id, name, oppId, opp, home]) => list.push({
          id, name, oppId, opp, home, off, kickoff: f.kickoff,
          position: standings.get(id)?.position ?? null,
          form: teamForm(seasonFixtures, id),
          diff: difficulty(standings, id, oppId, teamCount),
        }))
    })
    const pts = r => r.form.reduce((s, f) => s + (f.res === 'W' ? 3 : f.res === 'D' ? 1 : 0), 0)
    const by = {
      kickoff: (a, b) => new Date(a.kickoff) - new Date(b.kickoff) || a.name.localeCompare(b.name),
      table: (a, b) => (a.position ?? 999) - (b.position ?? 999),
      form: (a, b) => pts(b) - pts(a) || (a.position ?? 999) - (b.position ?? 999),
    }[sort]
    // Teams you can pick first, used and called-off ones at the bottom.
    return list.sort((a, b) => (used.has(a.id) || a.off) - (used.has(b.id) || b.off) || by(a, b))
  }, [current, seasonFixtures, standings, teamCount, sort, used])

  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>Last 5: oldest → latest</span>
        <div className="flex gap-1">
          {SORTS.map(s => (
            <button key={s.key} type="button" onClick={() => setSort(s.key)}
              className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ background: sort === s.key ? 'var(--accent-dim)' : 'var(--bg-raised)', color: sort === s.key ? 'var(--accent)' : 'var(--txt-second)', border: '0.5px solid var(--border-med)' }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {rows.map(t => {
        const chosen = myPick?.team_id === t.id
        const usedRound = used.get(t.id)
        const disabled = t.off || usedRound != null || saving != null
        const isPlanned = planned?.team_id === t.id
        return (
          <button key={`${t.id}-${t.kickoff}`} type="button" disabled={disabled}
            onClick={() => !chosen && setConfirm(t)}
            className="w-full text-left rounded-xl px-3 py-2.5 mb-1.5 flex items-center gap-2.5 transition-colors"
            style={{
              background: chosen ? 'var(--accent)' : 'var(--bg-surface)',
              border: `0.5px solid ${chosen ? 'var(--accent)' : isPlanned ? 'var(--accent-line, var(--accent))' : 'var(--border-med)'}`,
              opacity: usedRound != null || t.off ? 0.5 : saving === t.id ? 0.6 : 1,
            }}>
            <TeamCode sport={game.sport} name={t.name} />
            <span className="flex-1" style={{ minWidth: 0 }}>
              <span className="block text-sm font-semibold truncate" style={{
                color: chosen ? 'var(--on-accent)' : 'var(--txt-primary)',
                textDecoration: usedRound != null ? 'line-through' : 'none',
              }}>
                {t.name}
                {isPlanned && !chosen && <span className="text-[9px] font-bold ml-1.5 px-1 py-px rounded" style={{ color: 'var(--accent)', background: 'var(--accent-dim)', textDecoration: 'none' }}>PLANNED</span>}
              </span>
              <span className="block text-[11px] truncate" style={{ color: chosen ? 'var(--on-accent)' : 'var(--txt-muted)' }}>
                {t.home ? 'v' : '@'} {t.opp} ({t.home ? 'H' : 'A'})
                {t.position ? ` · ${ordinal(t.position)}` : ''}
                {usedRound != null ? ` · used ${rn(usedRound)}` : ''}
                {chosen ? ' · your pick ✓' : ''}
              </span>
            </span>
            <span className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-[11px] font-semibold" style={{ color: chosen ? 'var(--on-accent)' : 'var(--txt-second)' }}>
                {t.off ? 'Postponed' : formatUK(t.kickoff, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <FormChips form={t.form} />
            </span>
          </button>
        )
      })}

      {confirm && (
        <ConfirmPick data={data} team={confirm} onClose={() => setConfirm(null)}
          onConfirm={() => { onPick(confirm.id, confirm.name); setConfirm(null) }} />
      )}
    </div>
  )
}

/** Recent results and the next few games for a team, then confirm. */
function ConfirmPick({ data, team, onClose, onConfirm }) {
  const { game, seasonFixtures, standings, teamCount } = data
  const rn = r => roundName(game, r)
  const recent = teamResults(seasonFixtures, team.id).slice(-3)
  const next = teamUpcoming(seasonFixtures, team.id, game.current_round, 3)

  return (
    <Sheet onClose={onClose}>
      <div className="text-center mb-3">
        <TeamCode sport={game.sport} name={team.name} size="lg" />
        <p className="text-lg font-bold mt-2" style={{ color: 'var(--txt-primary)' }}>{team.name}</p>
        <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
          {team.position ? `${ordinal(team.position)} in the table · ` : ''}{team.home ? 'v' : '@'} {team.opp} ({team.home ? 'H' : 'A'})
        </p>
      </div>

      <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--txt-second)' }}>Recent results and what's next</p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {recent.map((r, i) => (
          <div key={`r${i}`} className="rounded-lg p-1.5 text-center" style={{ background: FORM_STYLE[r.res].bg }}>
            <p className="text-[10px]" style={{ color: 'var(--txt-muted)' }}>{rn(r.round)}</p>
            <p className="text-xs font-bold" style={{ color: 'var(--txt-primary)' }}>{teamCode(game.sport, r.opp)} ({r.home ? 'H' : 'A'})</p>
            <p className="text-[11px] font-semibold" style={{ color: FORM_STYLE[r.res].color }}>{r.res} {r.score}</p>
          </div>
        ))}
        {next.map((n, i) => {
          const d = DIFFICULTY_STYLE[difficulty(standings, team.id, n.oppId, teamCount)]
          return (
            <div key={`n${i}`} className="rounded-lg p-1.5 text-center" style={{ background: 'var(--bg-raised)', border: `0.5px solid ${n.round === game.current_round ? 'var(--accent)' : d.line}` }}>
              <p className="text-[10px]" style={{ color: n.round === game.current_round ? 'var(--accent)' : 'var(--txt-muted)' }}>{rn(n.round)}{n.round === game.current_round ? ' · now' : ''}</p>
              <p className="text-xs font-bold" style={{ color: 'var(--txt-primary)' }}>{teamCode(game.sport, n.opp)} ({n.home ? 'H' : 'A'})</p>
              <p className="text-[10px]" style={{ color: d.color }}>{d.label}</p>
            </div>
          )
        })}
      </div>

      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--txt-primary)' }}>Pick {team.name} for {rn(game.current_round)}?</p>
      <p className="text-xs mb-4" style={{ color: 'var(--amber)' }}>
        Win and you're through; draw or lose and this entry is out. Once picks lock you can't use {team.name} again in this game until you've used every team.
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary flex-1" onClick={onConfirm}>Pick {team.name}</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
      <p className="text-[10px] text-center mt-2" style={{ color: 'var(--txt-muted)' }}>You can change your pick until the first kick-off.</p>
    </Sheet>
  )
}

