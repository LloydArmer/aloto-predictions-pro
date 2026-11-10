import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { loadF1Races, loadF1Drivers, loadF1Results } from '../../../lib/sports/f1/data'
import { F1_DEFAULT_RACE_POINTS, F1_DEFAULT_SPRINT_POINTS, f1Rules, sessionsFor, confirmedField } from '../../../lib/sports/f1/scoring'
import { Card, Button, Input, Select, Spinner, EmptyState } from '../../ui'
import F1OrderPicker from './F1OrderPicker'
import { driverItem, inOrder } from './f1Items'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

/*
 * The F1 admin tabs: Races, Scoring and Season. Football and NFL admin
 * screens are untouched; Admin.jsx shows these instead when the app is on F1.
 */

async function feed(body) {
  const { data, error } = await supabase.functions.invoke('sync-f1', { body })
  if (error) throw new Error('Could not reach the F1 feed. Is sync-f1 deployed?')
  if (!data?.ok) throw new Error(data?.error || 'The F1 feed did not answer')
  return data
}

const Label = ({ children }) => (
  <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--txt-muted)' }}>{children}</p>
)

// ───────────────────────── Races ─────────────────────────
export function F1RacesTab({ competitionId, competitions, refetchComps }) {
  const comp = competitions.find(c => c.id === competitionId)
  const [races, setRaces] = useState(null)
  const [calendar, setCalendar] = useState(null)
  const [chosen, setChosen] = useState(new Set())
  const [season, setSeason] = useState(new Date().getFullYear())
  const [busy, setBusy] = useState(null)
  const [open, setOpen] = useState(null)
  const [auto, setAuto] = useState(!!comp?.auto_finalise_scores)

  useEffect(() => { load() }, [competitionId])
  useEffect(() => { setAuto(!!comp?.auto_finalise_scores) }, [comp?.auto_finalise_scores])

  async function load() { setRaces(await loadF1Races(supabase, competitionId)) }

  async function run(label, fn) {
    setBusy(label)
    try { await fn() } catch (e) { toast.error(e.message) } finally { setBusy(null) }
  }

  const showCalendar = () => run('calendar', async () => {
    const d = await feed({ mode: 'season', competition_id: competitionId, season })
    setCalendar(d.races || [])
    setChosen(new Set((d.races || []).filter(r => !r.added && r.status !== 'Cancelled' && new Date(r.race_at) > new Date()).map(r => r.id)))
  })

  const addChosen = () => run('import', async () => {
    const d = await feed({ mode: 'import', competition_id: competitionId, season, race_ids: [...chosen] })
    toast.success(`${d.added + d.shared} race${d.added + d.shared === 1 ? '' : 's'} added`)
    setCalendar(null); load()
  })

  async function saveAuto(on) {
    setAuto(on)
    const { data, error } = await supabase.from('competitions').update({ auto_finalise_scores: on }).eq('id', competitionId).select().maybeSingle()
    if (error || !data) { setAuto(!on); toast.error('Could not save'); return }
    toast.success(on ? 'Results will be confirmed and scored automatically' : 'You will confirm each session yourself')
    refetchComps?.()
  }

  return (
    <div>
      <Card className="p-4 mb-3">
        <Label>Race calendar</Label>
        <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
          Add the Grands Prix this league plays. Each race weekend is one round with two picks: the grid (locks when
          qualifying starts) and the race (locks at lights out). Sprint weekends add a sprint grid and a sprint finish.
          Times, drivers and results come from the F1 feed.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Select value={season} onChange={e => setSeason(Number(e.target.value))} style={{ width: 100 }}>
            {[0, 1].map(n => new Date().getFullYear() + n).map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Button variant="primary" className="btn-sm" disabled={!!busy} onClick={showCalendar}>
            {busy === 'calendar' ? 'Loading…' : 'Add races from the calendar'}
          </Button>
          <Button className="btn-sm" disabled={!!busy} onClick={() => run('drivers', async () => { const d = await feed({ mode: 'drivers', season }); toast.success(`${d.drivers} drivers loaded`) })}>
            {busy === 'drivers' ? 'Loading…' : 'Refresh drivers'}
          </Button>
          <Button className="btn-sm" disabled={!!busy} onClick={() => run('standings', async () => { await feed({ mode: 'standings', season }); toast.success('Championship updated') })}>
            {busy === 'standings' ? 'Loading…' : 'Refresh championship'}
          </Button>
        </div>

        {calendar && (
          <div className="mt-3 rounded-md overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
            {calendar.length === 0 && <p className="p-3 text-sm" style={{ color: 'var(--txt-muted)' }}>No races found for {season}.</p>}
            {calendar.map(r => (
              <label key={r.id} className="flex items-center gap-2.5 px-3 py-2 text-sm" style={{ borderTop: '0.5px solid var(--border)', opacity: r.added ? 0.5 : 1 }}>
                <input type="checkbox" disabled={r.added} checked={r.added || chosen.has(r.id)}
                  onChange={e => setChosen(s => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n })} />
                <span style={{ width: 30, color: 'var(--txt-muted)' }}>{r.round ? `R${r.round}` : '—'}</span>
                <span className="flex-1 truncate" style={{ color: 'var(--txt-primary)' }}>{r.name}</span>
                <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>{r.added ? 'Added' : format(new Date(r.race_at), 'd MMM')}</span>
              </label>
            ))}
            {calendar.length > 0 && (
              <div className="p-3 flex gap-2" style={{ borderTop: '0.5px solid var(--border)' }}>
                <Button variant="primary" className="btn-sm" disabled={!chosen.size || !!busy} onClick={addChosen}>
                  {busy === 'import' ? 'Adding…' : `Add ${chosen.size} race${chosen.size === 1 ? '' : 's'}`}
                </Button>
                <Button className="btn-sm" onClick={() => setCalendar(null)}>Cancel</Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4 mb-3">
        <Label>Confirming results</Label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={auto} onChange={e => saveAuto(e.target.checked)} />
          <span className="text-sm" style={{ color: 'var(--txt-primary)' }}>Confirm and score results automatically</span>
        </label>
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>
          On: qualifying and the race are scored as soon as the feed says they have finished. Off: the live order stays
          provisional until you confirm it below. Either way you can correct a result by hand and it is scored again.
        </p>
      </Card>

      {!races ? <div className="flex justify-center py-10"><Spinner /></div>
        : !races.length ? <EmptyState icon="ti-flag" title="No races yet" description="Add races from the calendar above." />
        : (
          <Card className="overflow-hidden">
            {races.map((r, i) => (
              <div key={r.id} style={{ borderTop: i ? '0.5px solid var(--border)' : 'none' }}>
                <button className="w-full flex items-center gap-2 px-3 py-2.5 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="text-xs" style={{ width: 30, color: 'var(--txt-muted)' }}>{r.round ? `R${r.round}` : '—'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate" style={{ color: 'var(--txt-primary)', fontWeight: 600 }}>{r.name}</span>
                    <span className="block text-[11px]" style={{ color: 'var(--txt-muted)' }}>{format(new Date(r.race_at), 'EEE d MMM, HH:mm')}</span>
                  </span>
                  {r.sprint_at && <Chip ok={r.sprint_grid_confirmed && r.sprint_confirmed} label="Sprint" />}
                  <Chip ok={r.grid_confirmed} label="Grid" />
                  <Chip ok={r.race_confirmed} label="Race" />
                  {r.status === 'cancelled' && <span className="text-[11px]" style={{ color: 'var(--red)' }}>Cancelled</span>}
                  <i className={`ti ti-chevron-${open === r.id ? 'up' : 'down'}`} style={{ color: 'var(--txt-muted)' }} aria-hidden="true" />
                </button>
                {open === r.id && <RaceAdmin race={r} onChanged={load} />}
              </div>
            ))}
          </Card>
        )}
    </div>
  )
}

const Chip = ({ ok, label }) => (
  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: ok ? 'var(--green-dim)' : 'var(--bg-elevated)', color: ok ? 'var(--green)' : 'var(--txt-muted)' }}>
    {ok ? '✓ ' : ''}{label}
  </span>
)

function RaceAdmin({ race, onChanged }) {
  const [results, setResults] = useState(null)
  const [drivers, setDrivers] = useState([])
  const [editing, setEditing] = useState(null)   // 'grid' | 'race'
  const [order, setOrder] = useState([])
  const [busy, setBusy] = useState(null)

  useEffect(() => { load() }, [race.id])
  async function load() {
    const [res, { drivers: ds }] = await Promise.all([loadF1Results(supabase, race.id), loadF1Drivers(supabase, race.season)])
    setResults(res); setDrivers(ds)
  }
  const byId = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers])

  async function act(label, fn, ok) {
    setBusy(label)
    try { await fn(); if (ok) toast.success(ok); await load(); onChanged() }
    catch (e) { toast.error(e.message) }
    finally { setBusy(null) }
  }
  const rpc = async (name, args) => { const { error } = await supabase.rpc(name, args); if (error) throw new Error(error.message) }

  function startEdit(session) {
    const champ = drivers.map(d => d.id)
    const have = (results?.[session] || []).filter(r => r.position).sort((a, b) => a.position - b.position).map(r => r.driver_id)
    setOrder(inOrder(champ.map(id => ({ id })), have).map(x => x.id))
    setEditing(session)
  }

  if (!results) return <div className="flex justify-center py-6"><Spinner /></div>

  return (
    <div className="px-3 pb-4">
      <div className="flex gap-2 flex-wrap mb-3">
        <Button className="btn-sm" disabled={!!busy} onClick={() => act('fetch', () => feed({ mode: 'results', race_id: race.id }), 'Results fetched')}>
          {busy === 'fetch' ? 'Fetching…' : 'Fetch results now'}
        </Button>
      </div>
      {sessionsFor(race).map(({ key: s, name }) => {
        const rows = results[s].filter(r => r.position).sort((a, b) => a.position - b.position)
        const confirmed = race[confirmedField(s)]
        return (
          <div key={s} className="mb-3 rounded-md p-3" style={{ background: 'var(--bg-elevated)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>{name}</p>
              <span className="text-[11px]" style={{ color: confirmed ? 'var(--green)' : 'var(--amber)' }}>
                {confirmed ? 'Confirmed and scored' : rows.length ? 'Provisional' : 'No result yet'}
              </span>
            </div>
            {rows.length > 0 && editing !== s && (
              <p className="text-xs mb-2" style={{ color: 'var(--txt-second)' }}>
                {rows.slice(0, 10).map(r => `${r.position}. ${byId.get(r.driver_id)?.abbr || byId.get(r.driver_id)?.name || '?'}`).join('  ')}
                {rows.length > 10 && ' …'}
              </p>
            )}
            {editing === s ? (
              <>
                <F1OrderPicker items={order.map(id => byId.get(id)).filter(Boolean).map(driverItem)} onChange={n => setOrder(n.map(x => x.id))} />
                <div className="flex gap-2 mt-2">
                  <Button variant="primary" className="btn-sm" disabled={!!busy}
                    onClick={() => act('set', () => rpc('f1_set_result', { p_race_id: race.id, p_session: s, p_driver_ids: order }), 'Result saved and scored').then(() => setEditing(null))}>
                    Save result and score
                  </Button>
                  <Button className="btn-sm" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {!confirmed && rows.length > 0 && (
                  <Button variant="primary" className="btn-sm" disabled={!!busy}
                    onClick={() => act('confirm', () => rpc('f1_confirm_session', { p_race_id: race.id, p_session: s }), 'Confirmed and scored')}>
                    Confirm and score
                  </Button>
                )}
                {confirmed && (
                  <Button className="btn-sm" disabled={!!busy}
                    onClick={() => { if (window.confirm('Reopen this result? Its points come off until you confirm it again.')) act('reopen', () => rpc('f1_unconfirm_session', { p_race_id: race.id, p_session: s }), 'Reopened') }}>
                    Reopen
                  </Button>
                )}
                <Button className="btn-sm" disabled={!!busy || !drivers.length} onClick={() => startEdit(s)}>Set by hand</Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ───────────────────────── Scoring ─────────────────────────
export function F1ScoringTab({ competitionId }) {
  const [rules, setRules] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('point_rules').select('*').eq('competition_id', competitionId).maybeSingle()
      .then(({ data }) => setRules(f1Rules(data)))
  }, [competitionId])

  if (!rules) return <div className="flex justify-center py-10"><Spinner /></div>

  const setPts = (key, i, v) => setRules(r => { const a = [...r[key]]; a[i] = v; return { ...r, [key]: a } })

  async function save() {
    setSaving(true)
    const n = Number(rules.racePositions) || 22
    const list = key => Array.from({ length: n }, (_, i) => Number(rules[key][i]) || 0)
    const { data, error } = await supabase.from('point_rules').update({
      f1_grid_points: Number(rules.gridPoints) || 0,
      f1_race_points: list('racePoints'),
      f1_sprint_points: list('sprintPoints'),
    }).eq('competition_id', competitionId).select().maybeSingle()
    setSaving(false)
    if (error || !data) { toast.error('Could not save the points'); return }
    toast.success('Points saved. Confirmed races are rescored when you next confirm or reopen them.')
  }

  return (
    <div>
      <Card className="p-4 mb-3">
        <Label>Grid (qualifying and sprint qualifying)</Label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm" style={{ color: 'var(--txt-second)' }}>Each driver in exactly the right place</span>
          <Input type="number" min="0" value={rules.gridPoints} onChange={e => setRules(r => ({ ...r, gridPoints: e.target.value }))} style={{ width: 70 }} />
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>All {rules.gridPositions} places count. Default 5.</p>
      </Card>

      {[['racePoints', 'Race (finishing order)', F1_DEFAULT_RACE_POINTS, 'Use the defaults',
          'Points for a driver placed exactly right, by finishing place. Default: the F1 points (25 for a win down to 1 for 10th), then 1 point for 11th to 22nd.'],
        ['sprintPoints', 'Sprint (finishing order)', F1_DEFAULT_SPRINT_POINTS, 'Use sprint points',
          'Sprint weekends only. Default: the sprint points, 8 for a win down to 1 for 8th. Sprint qualifying pays the grid points above.']]
        .map(([key, title, defaults, reset, help]) => (
        <Card key={key} className="p-4 mb-3">
          <div className="flex items-center justify-between">
            <Label>{title}</Label>
            <button className="text-xs mb-2" style={{ color: 'var(--accent)' }} onClick={() => setRules(r => ({ ...r, [key]: [...defaults] }))}>{reset}</button>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>{help}</p>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: Number(rules.racePositions) || 22 }, (_, i) => (
              <label key={i} className="flex items-center gap-1.5">
                <span className="text-xs text-right" style={{ width: 28, color: 'var(--txt-muted)' }}>P{i + 1}</span>
                <Input type="number" min="0" value={rules[key][i] ?? 0} onChange={e => setPts(key, i, e.target.value)} style={{ width: '100%', minWidth: 0 }} />
              </label>
            ))}
          </div>
        </Card>
      ))}

      <Button variant="primary" className="w-full" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save points'}</Button>
    </div>
  )
}

// ───────────────────────── Season ─────────────────────────
export function F1SeasonTab({ competitionId }) {
  const [cfg, setCfg] = useState(undefined)
  const [isPro, setIsPro] = useState(null)
  const [busy, setBusy] = useState(false)
  const [deadline, setDeadline] = useState('')

  useEffect(() => { load(); supabase.rpc('has_pro').then(({ data }) => setIsPro(data === true)) }, [competitionId])

  async function load() {
    const { data } = await supabase.from('f1_season_configs').select('*').eq('competition_id', competitionId).maybeSingle()
    setCfg(data || null)
    setDeadline(data?.deadline ? format(new Date(data.deadline), "yyyy-MM-dd'T'HH:mm") : '')
  }

  async function create() {
    // The season of this league's races, or this year.
    const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', competitionId)
    const ids = (links || []).map(l => l.gameweek_id)
    const { data: rs } = ids.length ? await supabase.from('f1_races').select('season').in('gameweek_id', ids).limit(1) : { data: [] }
    const { error } = await supabase.from('f1_season_configs').insert({ competition_id: competitionId, season: rs?.[0]?.season || new Date().getFullYear() })
    if (error) { toast.error(error.message); return }
    load()
  }

  async function update(patch) {
    setBusy(true)
    const { data, error } = await supabase.from('f1_season_configs').update(patch).eq('id', cfg.id).select().maybeSingle()
    setBusy(false)
    if (error) { toast.error(/FREE_TIER_F1_TABLES/.test(error.message) ? 'The full tables are part of ALOTO Pro' : error.message); return }
    if (!data) { toast.error('Could not save'); return }
    setCfg(data); toast.success('Saved')
  }

  async function score(final) {
    if (final && !window.confirm('Settle the season from the final championship? Do this after the last race.')) return
    setBusy(true)
    const { error } = await supabase.rpc('f1_score_season', { p_config_id: cfg.id, p_final: final })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    toast.success(final ? 'Season settled' : 'Season points updated from the current championship')
    load()
  }

  if (cfg === undefined) return <div className="flex justify-center py-10"><Spinner /></div>
  if (!cfg) return (
    <Card className="p-4">
      <Label>Season predictions</Label>
      <p className="text-sm mb-3" style={{ color: 'var(--txt-second)' }}>
        The Drivers' Champion is free in every league. With Pro you can add the full drivers' table and the full
        constructors' table. 20 points each by default.
      </p>
      <Button variant="primary" onClick={create}>Set up season predictions</Button>
    </Card>
  )

  const NumberRow = ({ label, field }) => (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderTop: '0.5px solid var(--border)' }}>
      <span className="text-sm" style={{ color: 'var(--txt-second)' }}>{label}</span>
      <Input type="number" min="0" defaultValue={cfg[field]} onBlur={e => Number(e.target.value) !== cfg[field] && update({ [field]: Number(e.target.value) || 0 })} style={{ width: 70 }} />
    </div>
  )

  return (
    <div>
      <Card className="p-4 mb-3">
        <Label>Open and deadline</Label>
        <label className="flex items-center gap-2.5 cursor-pointer mb-3">
          <input type="checkbox" checked={cfg.is_open} disabled={busy} onChange={e => update({ is_open: e.target.checked })} />
          <span className="text-sm" style={{ color: 'var(--txt-primary)' }}>Open for predictions</span>
        </label>
        <div className="flex gap-2 items-center">
          <Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} style={{ flex: 1 }} />
          <Button className="btn-sm" disabled={busy} onClick={() => update({ deadline: deadline ? new Date(deadline).toISOString() : null })}>Save</Button>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>Usually the start of qualifying at the first race. Everyone's answers show once it passes.</p>
      </Card>

      <Card className="p-4 mb-3">
        <Label>Questions and points</Label>
        <NumberRow label="Drivers' Champion (free)" field="champion_points" />
        {[['driver_table_enabled', "Full drivers' table", 'driver_table_points'], ['constructor_table_enabled', "Full constructors' table", 'constructor_table_points']].map(([flag, label, pts]) => (
          <div key={flag} style={{ borderTop: '0.5px solid var(--border)' }} className="py-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={cfg[flag]} disabled={busy || (isPro === false && !cfg[flag])} onChange={e => update({ [flag]: e.target.checked })} />
              <span className="text-sm flex-1" style={{ color: 'var(--txt-primary)' }}>{label}</span>
              {isPro === false && <span className="text-xs" style={{ color: 'var(--accent)' }}><i className="ti ti-lock" aria-hidden="true" /> Pro</span>}
            </label>
            {cfg[flag] && (
              <div className="flex items-center justify-between gap-3 mt-2 pl-6">
                <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>Points per place exactly right</span>
                <Input type="number" min="0" defaultValue={cfg[pts]} onBlur={e => Number(e.target.value) !== cfg[pts] && update({ [pts]: Number(e.target.value) || 0 })} style={{ width: 70 }} />
              </div>
            )}
          </div>
        ))}
      </Card>

      <Card className="p-4 mb-3">
        <Label>Scoring the season</Label>
        <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
          Season points come from the championship standings in the F1 feed. Update them during the season to show where
          everyone would stand if it ended now, then settle after the last race.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button className="btn-sm" disabled={busy} onClick={() => score(false)}>Update from current standings</Button>
          <Button variant="primary" className="btn-sm" disabled={busy || cfg.settled} onClick={() => score(true)}>{cfg.settled ? 'Settled' : 'Settle the season'}</Button>
        </div>
      </Card>
    </div>
  )
}
