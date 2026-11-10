import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { loadF1Drivers } from '../../../lib/sports/f1/data'
import { Card, Button, Select, Spinner, EmptyState } from '../../ui'
import F1OrderPicker from './F1OrderPicker'
import { driverItem, teamItem, inOrder } from './f1Items'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

/**
 * F1 season predictions: the Drivers' Champion (free in every league), and
 * the full drivers' and constructors' tables where the admin has Pro and has
 * switched them on. Each is saved on its own. Everything locks at the
 * deadline the admin sets; after that, each line shows how it stands against
 * the current championship.
 */
export default function F1SeasonPredict({ competitionId, userId }) {
  const [cfg, setCfg] = useState(undefined)
  const [drivers, setDrivers] = useState([])
  const [teams, setTeams] = useState([])
  const [mine, setMine] = useState({ champion: [], drivers: [], constructors: [] })
  const [order, setOrder] = useState({ champion: [], drivers: [], constructors: [] })
  const [champ, setChamp] = useState({ drivers: [], constructors: [] })
  const [saving, setSaving] = useState(null)

  useEffect(() => { if (competitionId) load() }, [competitionId, userId])

  async function load() {
    setCfg(undefined)
    const { data: c } = await supabase.from('f1_season_configs').select('*').eq('competition_id', competitionId).maybeSingle()
    setCfg(c || null)
    if (!c) return
    const [{ drivers: ds, teams: ts }, { data: entries }, { data: ch }] = await Promise.all([
      loadF1Drivers(supabase, c.season),
      supabase.from('f1_season_entries').select('*').eq('config_id', c.id).eq('user_id', userId).order('position'),
      supabase.from('f1_championship').select('*').eq('season', c.season).order('position'),
    ])
    setDrivers(ds); setTeams(ts)
    const m = { champion: [], drivers: [], constructors: [] }
    ;(entries || []).forEach(e => m[e.kind].push(e.kind === 'constructors' ? e.team_id : e.driver_id))
    setMine(m)
    setOrder({
      champion: m.champion,
      drivers: inOrder(ds, m.drivers).map(x => x.id),
      constructors: inOrder(ts, m.constructors).map(x => x.id),
    })
    setChamp({ drivers: (ch || []).filter(r => r.kind === 'drivers'), constructors: (ch || []).filter(r => r.kind === 'constructors') })
  }

  const dById = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers])

  if (cfg === undefined) return <div className="flex justify-center py-16"><Spinner /></div>
  if (!cfg) return <EmptyState icon="ti-trophy" title="No season predictions yet" description="They appear here when the league admin sets them up." />

  const locked = !cfg.is_open || (cfg.deadline && Date.now() >= +new Date(cfg.deadline))

  async function save(kind) {
    setSaving(kind)
    const ids = kind === 'champion' ? order.champion.slice(0, 1) : order[kind]
    const { error } = await supabase.rpc('f1_save_season', { p_config_id: cfg.id, p_kind: kind, p_ids: ids })
    setSaving(null)
    if (error) { toast.error(/LOCKED/.test(error.message) ? 'Season predictions have closed' : `Could not save: ${error.message}`); return }
    toast.success('Saved')
    setMine(m => ({ ...m, [kind]: ids }))
  }

  function marksFor(kind) {
    if (!locked) return {}
    const list = kind === 'drivers' ? champ.drivers : champ.constructors
    const at = new Map(list.map(r => [kind === 'drivers' ? r.driver_id : r.team_id, r.position]))
    const out = {}
    mine[kind].forEach((id, i) => {
      const p = at.get(id)
      out[id] = p === i + 1 ? { ok: true, text: `+${kind === 'drivers' ? cfg.driver_table_points : cfg.constructor_table_points}` } : { ok: false, text: p ? `P${p}` : '—' }
    })
    return out
  }

  const leader = champ.drivers[0] ? dById.get(champ.drivers[0].driver_id) : null
  const myChamp = dById.get(mine.champion[0])

  return (
    <div>
      <Card className="p-3.5 mb-3">
        <p className="text-xs" style={{ color: locked ? 'var(--txt-muted)' : 'var(--amber)' }}>
          {!cfg.is_open ? 'Not open yet' : cfg.deadline ? `${locked ? 'Closed' : 'Closes'} ${format(new Date(cfg.deadline), 'EEE d MMM, HH:mm')}` : 'Open'}
          {cfg.settled && ' · Settled'}
        </p>
      </Card>

      {/* Drivers' Champion — free */}
      <Card className="p-3.5 mb-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>Drivers' Champion</p>
          <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>{cfg.champion_points} pts</span>
        </div>
        {locked ? (
          <p className="text-sm" style={{ color: 'var(--txt-second)' }}>
            You: <b style={{ color: 'var(--txt-primary)' }}>{myChamp?.name || 'No pick'}</b>
            {leader && <span style={{ color: 'var(--txt-muted)' }}> · leading now: {leader.name}</span>}
          </p>
        ) : (
          <div className="flex gap-2">
            <Select value={order.champion[0] || ''} onChange={e => setOrder(o => ({ ...o, champion: [e.target.value] }))} style={{ flex: 1 }}>
              <option value="">Choose a driver</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}{d.team ? ` (${d.team.name})` : ''}</option>)}
            </Select>
            <Button variant="primary" className="btn-sm" disabled={!order.champion[0] || order.champion[0] === mine.champion[0] || saving} onClick={() => save('champion')}>
              {order.champion[0] && order.champion[0] === mine.champion[0] ? 'Saved' : 'Save'}
            </Button>
          </div>
        )}
      </Card>

      {[['drivers', "Drivers' table", cfg.driver_table_enabled, cfg.driver_table_points, drivers.map(driverItem)],
        ['constructors', "Constructors' table", cfg.constructor_table_enabled, cfg.constructor_table_points, teams.map(teamItem)]]
        .map(([kind, label, on, pts, all]) => (
          <Card key={kind} className="p-3.5 mb-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>{label}</p>
              <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>{on ? `${pts} pts per place` : <><i className="ti ti-lock" aria-hidden="true" /> Pro</>}</span>
            </div>
            {!on ? (
              <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>Not in this league. A league admin with ALOTO Pro can switch it on.</p>
            ) : locked && !mine[kind].length ? (
              <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>No prediction made.</p>
            ) : (
              <>
                <F1OrderPicker
                  items={(locked ? mine[kind] : order[kind]).map(id => all.find(x => x.id === id)).filter(Boolean)}
                  locked={locked} marks={marksFor(kind)}
                  onChange={next => setOrder(o => ({ ...o, [kind]: next.map(x => x.id) }))} />
                {!locked && (
                  <Button variant="primary" className="w-full mt-2" disabled={saving === kind || order[kind].join() === mine[kind].join()} onClick={() => save(kind)}>
                    {order[kind].join() === mine[kind].join() ? 'Saved' : `Save ${label.toLowerCase()}`}
                  </Button>
                )}
              </>
            )}
          </Card>
        ))}
    </div>
  )
}
