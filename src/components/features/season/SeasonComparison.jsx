import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Select, SectionLabel, EmptyState, Spinner } from '../../ui'

/**
 * Everyone's season predictions, side by side, once they are locked.
 *
 * Deliberately shows NOTHING until the deadline has passed or the admin has
 * closed entries — the whole point of a sealed prediction is that it is sealed.
 * The database enforces the same rule: before the deadline a participant can
 * only read their own rows, so there is nothing here to leak even if this
 * component were rendered early.
 *
 * Two ways of looking at the table, because they answer different questions:
 *   Grid       — every player at once. "Who else has City winning it?"
 *   Side by side — one player against you. "Where do we actually differ?"
 */
export default function SeasonComparison({ competitionId, userId, tableConfig, pickConfig, tableLocked, picksLocked }) {
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('grid')
  const [against, setAgainst] = useState('')

  const [people, setPeople] = useState([])       // { id, name }
  const [teams, setTeams] = useState({})         // teamId -> { name, short }
  const [tableRows, setTableRows] = useState([]) // { user_id, team_id, position }
  const [results, setResults] = useState({})     // position -> teamId

  const [picks, setPicks] = useState([])
  const [options, setOptions] = useState({})     // optionId -> name
  const [answers, setAnswers] = useState([])

  const showTable = !!tableConfig && tableLocked
  const showPicks = !!pickConfig && picksLocked

  useEffect(() => {
    if (!competitionId || (!showTable && !showPicks)) { setLoading(false); return }
    let cancelled = false

    ;(async () => {
      try {
        const { data: parts } = await supabase.from('participants')
          .select('user_id, profiles(display_name)').eq('competition_id', competitionId)

        if (showTable) {
          const [{ data: tm }, { data: preds }, { data: res }] = await Promise.all([
            supabase.from('season_table_teams').select('id, name, short_name').eq('config_id', tableConfig.id),
            supabase.from('season_table_predictions').select('user_id, team_id, position').eq('config_id', tableConfig.id),
            supabase.from('season_table_results').select('team_id, position').eq('config_id', tableConfig.id),
          ])
          if (cancelled) return
          setTeams(Object.fromEntries((tm || []).map(t => [t.id, { name: t.name, short: t.short_name || abbreviate(t.name) }])))
          setTableRows(preds || [])
          setResults(Object.fromEntries((res || []).map(r => [r.position, r.team_id])))
        }

        if (showPicks) {
          const { data: pk } = await supabase.from('season_picks')
            .select('id, label, points, correct_option_id, correct_answer, allow_free_text')
            .eq('config_id', pickConfig.id).order('sort_order')

          const ids = (pk || []).map(p => p.id)
          const [{ data: opts }, { data: ans }] = await Promise.all([
            ids.length ? supabase.from('season_pick_options').select('id, name').in('pick_id', ids) : { data: [] },
            ids.length ? supabase.from('season_pick_answers').select('pick_id, user_id, option_id, answer_text, is_correct').in('pick_id', ids) : { data: [] },
          ])
          if (cancelled) return
          setPicks(pk || [])
          setOptions(Object.fromEntries((opts || []).map(o => [o.id, o.name])))
          setAnswers(ans || [])
        }

        if (!cancelled) {
          // You first, then everyone else by name. Your own column is the one
          // every comparison is read against, so it belongs on the left.
          const list = (parts || []).map(p => ({ id: p.user_id, name: p.profiles?.display_name || 'Player' }))
          list.sort((a, b) => a.id === userId ? -1 : b.id === userId ? 1 : a.name.localeCompare(b.name))
          setPeople(list)
        }
      } catch (err) {
        console.warn('Could not load the comparison:', err?.message || err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [competitionId, userId, tableConfig?.id, pickConfig?.id, showTable, showPicks])

  if (!showTable && !showPicks) return null
  if (loading) return <div className="flex justify-center py-10"><Spinner/></div>

  // Only people who actually entered something. A player who never predicted
  // would otherwise be an empty column twelve rows wide.
  const tablePlayers = people.filter(p => tableRows.some(r => r.user_id === p.id))
  const pickPlayers  = people.filter(p => answers.some(a => a.user_id === p.id))

  const positionOf = (uid, pos) => tableRows.find(r => r.user_id === uid && r.position === pos)?.team_id || null
  const count = tableConfig?.team_count || 20
  const positions = Array.from({ length: count }, (_, i) => i + 1)
  const haveResults = Object.keys(results).length > 0

  const others = tablePlayers.filter(p => p.id !== userId)
  const opponent = others.find(p => p.id === against) || others[0] || null

  return (
    <div className="mb-6">
      <SectionLabel>Everyone's predictions</SectionLabel>

      {showTable && (
        tablePlayers.length === 0 ? (
          <Card className="p-4 mb-4">
            <EmptyState icon="ti-table" title="No tables were entered"
              description="Nobody submitted a predicted final table before it locked"/>
          </Card>
        ) : (
          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
                {tableConfig.league_name} — final table
              </p>
              <div className="flex items-center gap-1.5">
                <ViewButton active={view === 'grid'} onClick={() => setView('grid')}>Everyone</ViewButton>
                <ViewButton active={view === 'head'} onClick={() => setView('head')}>Side by side</ViewButton>
              </div>
            </div>

            {haveResults && (
              <p className="text-xs mb-2" style={{ color: 'var(--txt-muted)' }}>
                Green means the team finished in that exact position.
              </p>
            )}

            {view === 'grid' ? (
              /* Scrolls sideways on a phone with the position column pinned,
                 so it is always clear which row you are reading. */
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr>
                      <th style={{ ...headCell, position: 'sticky', left: 0, background: 'var(--bg-card, var(--bg-elevated))', zIndex: 1 }}>#</th>
                      {haveResults && <th style={headCell}>Actual</th>}
                      {tablePlayers.map(p => (
                        <th key={p.id} style={{ ...headCell, color: p.id === userId ? 'var(--accent)' : 'var(--txt-second)' }}>
                          {p.id === userId ? 'You' : firstName(p.name)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(pos => (
                      <tr key={pos}>
                        <td style={{ ...bodyCell, position: 'sticky', left: 0, background: 'var(--bg-card, var(--bg-elevated))', color: 'var(--txt-muted)', fontWeight: 600 }}>{pos}</td>
                        {haveResults && (
                          <td style={{ ...bodyCell, color: 'var(--txt-second)', fontWeight: 600 }}>
                            {teams[results[pos]]?.short || '—'}
                          </td>
                        )}
                        {tablePlayers.map(p => {
                          const teamId = positionOf(p.id, pos)
                          const right = haveResults && teamId && results[pos] === teamId
                          return (
                            <td key={p.id} style={{
                              ...bodyCell,
                              color: right ? 'var(--green)' : 'var(--txt-primary)',
                              background: right ? 'var(--green-dim)' : 'transparent',
                              fontWeight: right ? 600 : 400,
                            }}>
                              {teams[teamId]?.short || '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                {others.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                    Nobody else entered a table.
                  </p>
                ) : (
                  <>
                    <Select className="w-full mb-3" value={opponent?.id || ''}
                      onChange={e => setAgainst(e.target.value)}>
                      {others.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>

                    <div className="flex text-xs font-medium mb-1" style={{ color: 'var(--txt-muted)' }}>
                      <span style={{ width: 28 }}>#</span>
                      <span style={{ flex: 1 }}>You</span>
                      <span style={{ flex: 1 }}>{firstName(opponent.name)}</span>
                    </div>

                    {positions.map(pos => {
                      const mine = positionOf(userId, pos)
                      const theirs = positionOf(opponent.id, pos)
                      const same = mine && theirs && mine === theirs
                      return (
                        <div key={pos} className="flex text-xs py-1"
                          style={{ borderBottom: '0.5px solid var(--border)', color: same ? 'var(--txt-muted)' : 'var(--txt-primary)' }}>
                          <span style={{ width: 28, color: 'var(--txt-muted)', fontWeight: 600 }}>{pos}</span>
                          <span style={{ flex: 1 }}>{teams[mine]?.name || '—'}</span>
                          <span style={{ flex: 1 }}>{teams[theirs]?.name || '—'}</span>
                        </div>
                      )
                    })}

                    <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>
                      Rows you both called the same way are greyed out, so what stands out is where you disagree.
                    </p>
                  </>
                )}
              </>
            )}
          </Card>
        )
      )}

      {showPicks && picks.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--txt-primary)' }}>Individual predictions</p>

          {pickPlayers.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>Nobody answered these.</p>
          )}

          {pickPlayers.length > 0 && picks.map(pick => (
            <div key={pick.id} className="mb-3 pb-3" style={{ borderBottom: '0.5px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{pick.label}</span>
                <span className="text-xs" style={{ color: 'var(--accent)' }}>{pick.points}pts</span>
              </div>

              {answerFor(pick) && (
                <p className="text-xs mb-1.5" style={{ color: 'var(--green)' }}>
                  Answer: {answerFor(pick)}
                </p>
              )}

              {pickPlayers.map(p => {
                const a = answers.find(x => x.pick_id === pick.id && x.user_id === p.id)
                const text = a ? (options[a.option_id] || a.answer_text || '—') : '—'
                const right = a?.is_correct === true
                return (
                  <div key={p.id} className="flex items-center justify-between text-xs py-0.5">
                    <span style={{ color: p.id === userId ? 'var(--accent)' : 'var(--txt-second)' }}>
                      {p.id === userId ? 'You' : p.name}
                    </span>
                    <span style={{ color: right ? 'var(--green)' : 'var(--txt-primary)', fontWeight: right ? 600 : 400 }}>
                      {text}{right ? ' ✓' : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </Card>
      )}
    </div>
  )

  /** The correct answer, once the admin has settled the question. */
  function answerFor(pick) {
    if (pick.correct_option_id) return options[pick.correct_option_id] || null
    return pick.correct_answer || null
  }
}

function ViewButton({ active, onClick, children }) {
  return (
    <button onClick={onClick} className="text-xs px-2 py-1 rounded"
      style={{
        background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
        color: active ? 'var(--accent)' : 'var(--txt-muted)',
        fontWeight: active ? 600 : 400,
      }}>
      {children}
    </button>
  )
}

const headCell = {
  padding: '4px 8px',
  textAlign: 'left',
  fontWeight: 600,
  borderBottom: '0.5px solid var(--border)',
  color: 'var(--txt-second)',
}

const bodyCell = {
  padding: '3px 8px',
  borderBottom: '0.5px solid var(--border)',
}

/** "Manchester United" -> "MAN", for a column narrow enough to fit twelve of. */
function abbreviate(name) {
  const words = String(name || '').trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase()
}

function firstName(name) {
  return String(name || '').split(' ')[0]
}
