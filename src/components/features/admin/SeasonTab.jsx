import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Button, Input, Select, SectionLabel, EmptyState, Spinner } from '../../ui'
import TableOrderEditor from '../season/TableOrderEditor'
import { calculateSeasonScores, deadlineLabel } from '../../../lib/seasonScoring'
import toast from 'react-hot-toast'

// Suggestions only — the admin can name anything. These exist so the common
// cases are one click rather than typing, not to limit what's possible.
const LEAGUE_SUGGESTIONS = [
  { name: 'English Premier League', teams: 20 },
  { name: 'EFL Championship',       teams: 24 },
  { name: 'EFL League One',         teams: 24 },
  { name: 'EFL League Two',         teams: 24 },
  { name: 'Scottish Premiership',   teams: 12 },
  { name: 'Spanish LaLiga',         teams: 20 },
  { name: 'Italian Serie A',        teams: 20 },
  { name: 'German Bundesliga',      teams: 18 },
]

// The questions from the brief. Adding to this list is the only change needed
// to offer a new one — everything downstream is data.
const PICK_SUGGESTIONS = [
  'Premier League Winners',
  'EFL Championship Winners',
  'Carabao Cup Winners',
  'FA Cup Winners',
  'Champions League Winners',
  'Europa League Winners',
  'Conference League Winners',
  'Premier League Golden Boot',
]

/** Converts a datetime-local value to ISO, and back for display. */
const toLocalInput = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Season points are NOT tied to a gameweek. They're settled once the season's
 * final gameweek has been played and stand as their own strand, with their own
 * column in the overall standings — which is why there is no "which gameweek do
 * these count in" control here.
 */
export default function SeasonTab({ competitionId }) {
  const [loading, setLoading] = useState(true)
  const [tableConfig, setTableConfig] = useState(null)
  const [teams, setTeams] = useState([])
  const [results, setResults] = useState({})       // position -> teamId
  const [pickConfig, setPickConfig] = useState(null)
  const [picks, setPicks] = useState([])
  const [scoring, setScoring] = useState(false)

  useEffect(() => { if (competitionId) load(); else setLoading(false) }, [competitionId])

  async function load() {
    setLoading(true)
    try {
      const { data: tc, error: tcErr } = await supabase.from('season_table_configs')
        .select('*').eq('competition_id', competitionId).maybeSingle()
      if (tcErr) { toast.error('Could not load the table setup'); console.error(tcErr) }
      setTableConfig(tc || null)

      if (tc) {
        const { data: tm } = await supabase.from('season_table_teams')
          .select('*').eq('config_id', tc.id).order('sort_order').order('name')
        setTeams(tm || [])

        const { data: rs } = await supabase.from('season_table_results')
          .select('position, team_id').eq('config_id', tc.id)
        setResults(Object.fromEntries((rs || []).map(r => [r.position, r.team_id])))
      } else {
        setTeams([]); setResults({})
      }

      const { data: pc } = await supabase.from('season_pick_configs')
        .select('*').eq('competition_id', competitionId).maybeSingle()
      setPickConfig(pc || null)

      if (pc) {
        // The embed is disambiguated by constraint name on purpose. There are
        // TWO foreign keys between these tables — options point at their pick,
        // and a pick points at its correct option — so a plain
        // `season_pick_options(*)` is ambiguous and PostgREST refuses it. The
        // failure is silent from the app's point of view: no rows, no error
        // shown, and the questions simply never appear.
        const { data: pk, error: pkErr } = await supabase.from('season_picks')
          .select('*, season_pick_options!season_pick_options_pick_id_fkey(*)')
          .eq('config_id', pc.id).order('sort_order')

        if (pkErr) {
          toast.error('Could not load the questions')
          console.error('season_picks load failed:', pkErr)
          setPicks([])
        } else {
          setPicks(pk || [])
        }
      } else {
        setPicks([])
      }
    } finally { setLoading(false) }
  }

  // ---- Final league table -------------------------------------------------

  async function createTableConfig(leagueName, teamCount) {
    const { error } = await supabase.from('season_table_configs').insert({
      competition_id: competitionId, league_name: leagueName, team_count: teamCount,
    })
    if (error) { toast.error('Could not create the table prediction'); return }
    toast.success('Created — now add the teams')
    load()
  }

  async function updateTableConfig(patch) {
    setTableConfig(prev => ({ ...prev, ...patch }))   // optimistic, so toggles feel instant
    const { error } = await supabase.from('season_table_configs').update(patch).eq('id', tableConfig.id)
    if (error) { toast.error('Could not save'); load() }
  }

  /**
   * Bulk team entry. One per line, pasted straight from a fixture list or
   * Wikipedia — adding 20 teams through a single-field form is tedious enough
   * that it would put an admin off setting this up at all.
   */
  async function addTeamsBulk(text) {
    const names = [...new Set(
      text.split('\n').map(n => n.trim()).filter(Boolean)
    )]
    if (!names.length) { toast.error('Paste one team per line'); return }

    const existing = new Set(teams.map(t => t.name.toLowerCase()))
    const fresh = names.filter(n => !existing.has(n.toLowerCase()))
    if (!fresh.length) { toast.error('Those teams are already on the list'); return }

    const rows = fresh.map((name, i) => ({
      config_id: tableConfig.id, name, sort_order: teams.length + i,
    }))
    const { error } = await supabase.from('season_table_teams').insert(rows)
    if (error) { toast.error('Could not add the teams'); return }
    toast.success(`${fresh.length} team${fresh.length !== 1 ? 's' : ''} added`)
    load()
  }

  async function removeTeam(team) {
    if (!window.confirm(`Remove ${team.name}?\n\nAny prediction or result using it will be removed too.`)) return
    const { error } = await supabase.from('season_table_teams').delete().eq('id', team.id)
    if (error) { toast.error('Could not remove'); return }
    load()
  }

  async function saveResults() {
    const filled = Object.entries(results).filter(([, id]) => id)
    if (filled.length !== tableConfig.team_count) {
      toast.error(`Fill all ${tableConfig.team_count} positions first — ${filled.length} done`)
      return
    }
    // Replaced wholesale rather than patched: a partial update could leave a
    // team in two positions, and the unique constraints would reject it in a
    // way that's hard to explain.
    await supabase.from('season_table_results').delete().eq('config_id', tableConfig.id)
    const { error } = await supabase.from('season_table_results').insert(
      filled.map(([position, team_id]) => ({ config_id: tableConfig.id, position: Number(position), team_id }))
    )
    if (error) { toast.error('Could not save the final table'); return }
    await updateTableConfig({ results_entered: true })
    toast.success('Final table saved')
  }

  // ---- Individual picks ---------------------------------------------------

  async function createPickConfig() {
    const { error } = await supabase.from('season_pick_configs').insert({ competition_id: competitionId })
    if (error) { toast.error('Could not create'); return }
    load()
  }

  async function updatePickConfig(patch) {
    setPickConfig(prev => ({ ...prev, ...patch }))
    const { error } = await supabase.from('season_pick_configs').update(patch).eq('id', pickConfig.id)
    if (error) { toast.error('Could not save'); load() }
  }

  async function addPick(label) {
    // The Golden Boot is typed rather than chosen: hundreds of possible
    // players, and the plausible list shifts mid-season. The admin marks the
    // right answers afterwards, which also credits "Haaland" and
    // "Erling Haaland" alike.
    const freeText = /golden boot|top scorer/i.test(label)
    const { error } = await supabase.from('season_picks').insert({
      config_id: pickConfig.id, label, sort_order: picks.length, allow_free_text: freeText,
    })
    if (error) { toast.error('Could not add'); return }
    toast.success(freeText ? `${label} added — answers are typed` : `${label} added — now add the options`)
    load()
  }

  async function updatePick(id, patch) {
    setPicks(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
    const { error } = await supabase.from('season_picks').update(patch).eq('id', id)
    if (error) { toast.error('Could not save'); load() }
  }

  async function removePick(pick) {
    if (!window.confirm(`Remove "${pick.label}"?\n\nEveryone's answer to it will be removed too.`)) return
    await supabase.from('season_picks').delete().eq('id', pick.id)
    load()
  }

  async function addOptionsBulk(pick, text) {
    const names = [...new Set(text.split('\n').map(n => n.trim()).filter(Boolean))]
    if (!names.length) { toast.error('Paste one option per line'); return }
    const existing = new Set((pick.season_pick_options || []).map(o => o.name.toLowerCase()))
    const fresh = names.filter(n => !existing.has(n.toLowerCase()))
    if (!fresh.length) { toast.error('Those options are already there'); return }

    const { error } = await supabase.from('season_pick_options').insert(
      fresh.map((name, i) => ({ pick_id: pick.id, name, sort_order: (pick.season_pick_options?.length || 0) + i }))
    )
    if (error) { toast.error('Could not add options'); return }
    load()
  }

  // ---- Scoring ------------------------------------------------------------

  async function runScoring() {
    setScoring(true)
    try {
      const result = await calculateSeasonScores(competitionId)
      toast.success(`Scored ${result.scored} participant${result.scored !== 1 ? 's' : ''} — ${result.totalPoints} points awarded`)
    } catch {
      toast.error('Could not calculate season scores')
    } finally { setScoring(false) }
  }

  if (!competitionId) return <EmptyState icon="ti-calendar-star" title="Choose a competition first" />
  if (loading) return <Spinner/>

  return (
    <div>
      {/* ================= FINAL LEAGUE TABLE ================= */}
      <SectionLabel className="mb-2">Final league table</SectionLabel>

      {!tableConfig ? (
        <Card className="p-4 mb-5">
          <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
            Participants predict a league's finishing order. Pick a league to start, or set one up by hand.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {LEAGUE_SUGGESTIONS.map(l => (
              <Button key={l.name} className="btn-sm" onClick={() => createTableConfig(l.name, l.teams)}>
                {l.name} ({l.teams})
              </Button>
            ))}
          </div>
          <CustomLeagueForm onCreate={createTableConfig}/>
        </Card>
      ) : (
        <Card className="p-4 mb-5">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
              {tableConfig.league_name} · {tableConfig.team_count} teams
            </p>
            <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--txt-second)', cursor: 'pointer' }}>
              <input type="checkbox" checked={tableConfig.is_open}
                onChange={e => updateTableConfig({ is_open: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }} />
              Open for predictions
            </label>
          </div>

          <div className="flex flex-wrap gap-3 mb-3">
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Points per correct position</p>
              <Input type="number" min="0" value={tableConfig.points_per_position}
                onChange={e => updateTableConfig({ points_per_position: parseInt(e.target.value, 10) || 0 })}
                style={{ width: 90 }} />
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Deadline</p>
              <input type="datetime-local" value={toLocalInput(tableConfig.deadline)}
                onChange={e => updateTableConfig({ deadline: e.target.value ? new Date(e.target.value).toISOString() : null })}
                style={{ background:'var(--bg-elevated)', border:'0.5px solid var(--border-med)', borderRadius:8, padding:'6px 8px', color:'var(--txt-primary)', fontSize:13, fontFamily:'inherit' }} />
              <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>{deadlineLabel(tableConfig.deadline)}</p>
            </div>
          </div>

          <TeamListEditor teams={teams} onAdd={addTeamsBulk} onRemove={removeTeam} expected={tableConfig.team_count}/>

          {teams.length >= tableConfig.team_count && (
            <div className="mt-4 pt-4" style={{ borderTop: '0.5px solid var(--border)' }}>
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--txt-primary)' }}>
                Final table {tableConfig.results_entered && <span className="text-xs font-normal" style={{ color: 'var(--green)' }}>· saved</span>}
              </p>
              <p className="text-xs mb-2" style={{ color: 'var(--txt-muted)' }}>
                Enter the real finishing order once the season ends, then calculate scores below.
              </p>
              <TableOrderEditor
                teams={teams}
                value={results}
                count={tableConfig.team_count}
                onChange={(pos, teamId) => setResults(prev => ({ ...prev, [pos]: teamId }))}
              />
              <Button variant="primary" className="mt-3" onClick={saveResults}>Save final table</Button>
            </div>
          )}
        </Card>
      )}

      {/* ================= INDIVIDUAL PICKS ================= */}
      <SectionLabel className="mb-2">Individual predictions</SectionLabel>

      {!pickConfig ? (
        <Card className="p-4 mb-5">
          <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
            One-off calls — who wins each competition, the golden boot. Set the questions and the points for each.
          </p>
          <Button variant="primary" onClick={createPickConfig}>Set up individual predictions</Button>
        </Card>
      ) : (
        <Card className="p-4 mb-5">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--txt-second)', cursor: 'pointer' }}>
              <input type="checkbox" checked={pickConfig.is_open}
                onChange={e => updatePickConfig({ is_open: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }} />
              Open for predictions
            </label>
          </div>

          <div className="flex flex-wrap gap-3 mb-4">
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Deadline</p>
              <input type="datetime-local" value={toLocalInput(pickConfig.deadline)}
                onChange={e => updatePickConfig({ deadline: e.target.value ? new Date(e.target.value).toISOString() : null })}
                style={{ background:'var(--bg-elevated)', border:'0.5px solid var(--border-med)', borderRadius:8, padding:'6px 8px', color:'var(--txt-primary)', fontSize:13, fontFamily:'inherit' }} />
              <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>{deadlineLabel(pickConfig.deadline)}</p>
            </div>
          </div>

          <p className="text-xs mb-2" style={{ color: 'var(--txt-muted)' }}>Add a question</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {PICK_SUGGESTIONS
              .filter(label => !picks.some(p => p.label === label))
              .map(label => (
                <Button key={label} className="btn-sm" onClick={() => addPick(label)}>+ {label}</Button>
              ))}
          </div>

          {picks.length === 0
            ? <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>No questions yet.</p>
            : picks.map(pick => (
                <PickEditor key={pick.id} pick={pick}
                  onUpdate={patch => updatePick(pick.id, patch)}
                  onRemove={() => removePick(pick)}
                  onAddOptions={text => addOptionsBulk(pick, text)}
                  onReload={load}
                  teams={teams}
                />
              ))}
        </Card>
      )}

      {/* ================= SCORING ================= */}
      {(tableConfig || pickConfig) && (
        <Card className="p-4 mb-4" style={{ background: 'var(--accent-dim)', borderColor: 'rgba(79,142,247,0.3)' }}>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--accent)' }}>Calculate season points</p>
          <p className="text-xs mb-3" style={{ color: 'var(--txt-second)' }}>
            Run this once the season's final gameweek has been played. It scores everyone against the final
            table and the marked answers, and the totals appear as their own Season column in the overall
            standings. Safe to run again after correcting anything.
          </p>
          <Button variant="primary" onClick={runScoring} disabled={scoring}>
            {scoring ? 'Calculating…' : 'Calculate season points'}
          </Button>
        </Card>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CustomLeagueForm({ onCreate }) {
  const [name, setName] = useState('')
  const [count, setCount] = useState(20)
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <div style={{ flex: '1 1 160px' }}>
        <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Or name your own</p>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="League name" className="w-full"/>
      </div>
      <div>
        <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Teams</p>
        <Input type="number" min="2" max="32" value={count}
          onChange={e => setCount(parseInt(e.target.value, 10) || 20)} style={{ width: 74 }}/>
      </div>
      <Button variant="primary" disabled={!name.trim()} onClick={() => onCreate(name.trim(), count)}>Create</Button>
    </div>
  )
}

function TeamListEditor({ teams, onAdd, onRemove, expected }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
          Teams
          <span className="text-xs font-normal ml-2"
            style={{ color: teams.length === expected ? 'var(--green)' : 'var(--amber)' }}>
            {teams.length} of {expected}
          </span>
        </p>
        <Button className="btn-sm" onClick={() => setOpen(o => !o)}>{open ? 'Close' : '+ Add teams'}</Button>
      </div>

      {teams.length !== expected && (
        <p className="text-xs mb-2" style={{ color: 'var(--amber)' }}>
          {teams.length < expected
            ? `Add ${expected - teams.length} more before participants can predict.`
            : `${teams.length - expected} too many — remove some, or raise the team count.`}
        </p>
      )}

      {open && (
        <div className="mb-3">
          <textarea
            value={text} onChange={e => setText(e.target.value)}
            rows={6} placeholder={'Arsenal\nAston Villa\nBournemouth\n…'}
            style={{ width: '100%', background:'var(--bg-elevated)', border:'0.5px solid var(--border-med)', borderRadius:8, padding:'8px', color:'var(--txt-primary)', fontSize:13, fontFamily:'inherit' }} />
          <p className="text-xs mt-1 mb-2" style={{ color: 'var(--txt-muted)' }}>
            One per line — paste straight from a fixture list. Duplicates are ignored.
          </p>
          <Button variant="primary" className="btn-sm" onClick={() => { onAdd(text); setText(''); setOpen(false) }}>
            Add teams
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {teams.map(t => (
          <span key={t.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs"
            style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', color: 'var(--txt-primary)' }}>
            {t.name}
            <button onClick={() => onRemove(t)} aria-label={`Remove ${t.name}`} style={{ color: 'var(--txt-muted)' }}>
              <i className="ti ti-x text-xs" aria-hidden="true"/>
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

function PickEditor({ pick, onUpdate, onRemove, onAddOptions, onReload, teams }) {
  const [expanded, setExpanded] = useState(false)
  const [optionText, setOptionText] = useState('')
  const options = pick.season_pick_options || []

  return (
    <Card className="p-3 mb-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div style={{ flex: '1 1 150px', minWidth: 0 }}>
          <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {pick.label}
          </p>
          <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
            {pick.allow_free_text
              ? 'Typed answer — you mark who was right'
              : `${options.length} option${options.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>Points</span>
          <Input type="number" min="0" value={pick.points}
            onChange={e => onUpdate({ points: parseInt(e.target.value, 10) || 0 })}
            style={{ width: 62 }}/>
          <Button className="btn-sm" onClick={() => setExpanded(x => !x)}>
            <i className={`ti ti-chevron-${expanded ? 'up' : 'down'} text-sm`} aria-hidden="true"/>
          </Button>
          <button onClick={onRemove} aria-label="Remove question"
            className="flex items-center justify-center" style={{ width: 24, height: 24, color: 'var(--txt-muted)' }}>
            <i className="ti ti-trash text-sm" aria-hidden="true"/>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          {pick.allow_free_text ? (
            <div>
              <p className="text-xs mb-2" style={{ color: 'var(--txt-muted)' }}>
                Participants type their answer. Note the right one here for your own reference, then mark
                each entry correct on the results screen — that way spellings and short forms all count.
              </p>
              <Input value={pick.correct_answer || ''} placeholder="Correct answer (your note)"
                onChange={e => onUpdate({ correct_answer: e.target.value })} className="w-full"/>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>Correct answer</span>
                <Select value={pick.correct_option_id || ''}
                  onChange={e => onUpdate({ correct_option_id: e.target.value || null })}
                  style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <option value="">Not decided yet</option>
                  {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </div>

              <textarea
                value={optionText} onChange={e => setOptionText(e.target.value)}
                rows={4} placeholder={'One option per line…'}
                style={{ width: '100%', background:'var(--bg-elevated)', border:'0.5px solid var(--border-med)', borderRadius:8, padding:'8px', color:'var(--txt-primary)', fontSize:13, fontFamily:'inherit' }}/>

              <div className="flex gap-2 mt-2 flex-wrap">
                <Button className="btn-sm" onClick={() => { onAddOptions(optionText); setOptionText('') }}>
                  Add options
                </Button>
                {teams.length > 0 && (
                  // The league's team list is nearly always the right option
                  // set for "who wins X", so offer it rather than making the
                  // admin paste twenty names twice.
                  <Button className="btn-sm" onClick={() => { onAddOptions(teams.map(t => t.name).join('\n')) }}>
                    Use the {teams.length} league teams
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {options.map(o => (
                  <span key={o.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                    style={{
                      background: pick.correct_option_id === o.id ? 'var(--green-dim)' : 'var(--bg-elevated)',
                      border: '0.5px solid var(--border)',
                      color: pick.correct_option_id === o.id ? 'var(--green)' : 'var(--txt-primary)',
                    }}>
                    {o.name}
                    <button aria-label={`Remove ${o.name}`} style={{ color: 'var(--txt-muted)' }}
                      onClick={async () => { await supabase.from('season_pick_options').delete().eq('id', o.id); onReload() }}>
                      <i className="ti ti-x text-xs" aria-hidden="true"/>
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
