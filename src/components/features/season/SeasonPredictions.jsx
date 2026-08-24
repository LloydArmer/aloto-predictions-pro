import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Button, Input, Select, SectionLabel, EmptyState, Spinner } from '../../ui'
import TableOrderEditor from './TableOrderEditor'
import { deadlineLabel, daysUntil } from '../../../lib/seasonScoring'
import toast from 'react-hot-toast'

/**
 * Where a participant makes their season predictions — the final league table
 * and the individual one-off calls.
 *
 * Both are saved explicitly rather than as-you-go. A half-ordered table saved
 * automatically would look complete on the dashboard while being worth almost
 * nothing, so the participant says when they're done.
 */
export default function SeasonPredictions({ competitionId, userId }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [tableConfig, setTableConfig] = useState(null)
  const [teams, setTeams] = useState([])
  const [myTable, setMyTable] = useState({})     // position -> teamId

  const [pickConfig, setPickConfig] = useState(null)
  const [picks, setPicks] = useState([])
  const [myPicks, setMyPicks] = useState({})     // pickId -> optionId | text
  const [scored, setScored] = useState(false)

  useEffect(() => { if (competitionId && userId) load(); else setLoading(false) }, [competitionId, userId])

  async function load() {
    setLoading(true)
    try {
      // Once anything has been scored the results become the main thing on
      // this screen — the entry forms are then only there for reference.
      const { count: scoreCount } = await supabase.from('season_scores')
        .select('id', { count: 'exact', head: true }).eq('competition_id', competitionId)
      setScored((scoreCount ?? 0) > 0)

      const { data: tc } = await supabase.from('season_table_configs')
        .select('*').eq('competition_id', competitionId).maybeSingle()
      setTableConfig(tc || null)

      if (tc) {
        const { data: tm } = await supabase.from('season_table_teams')
          .select('id, name').eq('config_id', tc.id).order('name')
        setTeams(tm || [])

        const { data: mine } = await supabase.from('season_table_predictions')
          .select('position, team_id').eq('config_id', tc.id).eq('user_id', userId)
        setMyTable(Object.fromEntries((mine || []).map(r => [r.position, r.team_id])))
      }

      const { data: pc } = await supabase.from('season_pick_configs')
        .select('*').eq('competition_id', competitionId).maybeSingle()
      setPickConfig(pc || null)

      if (pc) {
        const { data: pk, error } = await supabase.from('season_picks')
          .select('*, season_pick_options!season_pick_options_pick_id_fkey(id, name)')
          .eq('config_id', pc.id).order('sort_order')
        if (error) { console.error(error); toast.error('Could not load the questions') }
        setPicks(pk || [])

        const ids = (pk || []).map(p => p.id)
        const { data: ans } = ids.length
          ? await supabase.from('season_pick_answers')
              .select('pick_id, option_id, answer_text').in('pick_id', ids).eq('user_id', userId)
          : { data: [] }
        setMyPicks(Object.fromEntries((ans || []).map(a => [a.pick_id, a.option_id || a.answer_text || ''])))
      }
    } finally { setLoading(false) }
  }

  const tableLocked = !tableConfig?.is_open || (tableConfig?.deadline && new Date(tableConfig.deadline) < new Date())
  const picksLocked = !pickConfig?.is_open || (pickConfig?.deadline && new Date(pickConfig.deadline) < new Date())

  const tableFilled = Object.values(myTable).filter(Boolean).length
  const tableComplete = tableConfig && tableFilled === tableConfig.team_count
  const picksAnswered = picks.filter(p => myPicks[p.id]).length

  async function saveTable() {
    if (!tableComplete) {
      toast.error(`Place all ${tableConfig.team_count} teams first — ${tableFilled} done`)
      return
    }
    setSaving(true)
    try {
      // Replaced wholesale. Patching risks a moment where the same team sits in
      // two positions, which the unique constraints reject in a way that's hard
      // to explain to someone who just reordered two rows.
      await supabase.from('season_table_predictions')
        .delete().eq('config_id', tableConfig.id).eq('user_id', userId)

      const rows = Object.entries(myTable)
        .filter(([, teamId]) => teamId)
        .map(([position, team_id]) => ({
          config_id: tableConfig.id, user_id: userId, position: Number(position), team_id,
        }))

      const { error } = await supabase.from('season_table_predictions').insert(rows)
      if (error) throw error
      toast.success('Final table prediction saved')
    } catch {
      toast.error('Could not save — the deadline may have passed')
      load()
    } finally { setSaving(false) }
  }

  async function savePicks() {
    const answered = picks.filter(p => myPicks[p.id])
    if (!answered.length) { toast.error('Answer at least one question first'); return }

    setSaving(true)
    try {
      const rows = answered.map(p => ({
        pick_id: p.id,
        user_id: userId,
        // A question is either a choice or typed, never both — the database
        // enforces that, so send exactly one.
        option_id:   p.allow_free_text ? null : myPicks[p.id],
        answer_text: p.allow_free_text ? String(myPicks[p.id]).trim() : null,
      }))

      const { error } = await supabase.from('season_pick_answers')
        .upsert(rows, { onConflict: 'pick_id,user_id' })
      if (error) throw error
      toast.success(`${answered.length} of ${picks.length} answers saved`)
    } catch {
      toast.error('Could not save — the deadline may have passed')
      load()
    } finally { setSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg"/></div>

  if (!scored && !tableConfig?.is_open && !pickConfig?.is_open) {
    return <EmptyState icon="ti-calendar-star" title="No season predictions open"
      description="Your admin will open these before the season starts"/>
  }

  return (
    <div>
      {/* Results live in Standings, not here. This screen is for entering
          predictions; Standings is for seeing how everyone did. */}
      {scored && (
        <Card className="p-3 mb-4" style={{ background: 'var(--accent-dim)', borderColor: 'rgba(79,142,247,0.3)' }}>
          <p className="text-xs" style={{ color: 'var(--accent)' }}>
            Season predictions have been scored — see how everyone did under Standings → Season.
          </p>
        </Card>
      )}

      {/* ---------------- Final league table ---------------- */}
      {tableConfig?.is_open && (
        <div className="mb-6">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <SectionLabel>{tableConfig.league_name} — final table</SectionLabel>
            <DeadlinePill deadline={tableConfig.deadline} done={tableComplete}/>
          </div>

          <Card className="p-4">
            <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
              Put all {tableConfig.team_count} teams in the order you think they'll finish.
              {' '}<strong style={{ color: 'var(--accent)' }}>{tableConfig.points_per_position}pts</strong> for each
              one you get in exactly the right position.
            </p>

            {tableLocked && (
              <p className="text-xs mb-3 px-2 py-1.5 rounded" style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>
                {tableConfig.deadline && new Date(tableConfig.deadline) < new Date()
                  ? 'The deadline has passed — this is locked.'
                  : 'Not open for entries.'}
              </p>
            )}

            <TableOrderEditor
              teams={teams}
              value={myTable}
              count={tableConfig.team_count}
              disabled={tableLocked || saving}
              onChange={(pos, teamId) => setMyTable(prev => ({ ...prev, [pos]: teamId }))}
            />

            {!tableLocked && (
              <Button variant="primary" className="mt-3 w-full justify-center"
                onClick={saveTable} disabled={saving || !tableComplete}>
                {saving ? 'Saving…' : tableComplete ? 'Save my table' : `${tableConfig.team_count - tableFilled} still to place`}
              </Button>
            )}
          </Card>
        </div>
      )}

      {/* ---------------- Individual picks ---------------- */}
      {pickConfig?.is_open && picks.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <SectionLabel>Individual Predictions</SectionLabel>
            <DeadlinePill deadline={pickConfig.deadline} done={picksAnswered === picks.length}/>
          </div>

          <Card className="p-4">
            <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
              {picksAnswered} of {picks.length} answered ·{' '}
              {picks.reduce((sum, p) => sum + (p.points || 0), 0)}pts available
            </p>

            {picksLocked && (
              <p className="text-xs mb-3 px-2 py-1.5 rounded" style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>
                {pickConfig.deadline && new Date(pickConfig.deadline) < new Date()
                  ? 'The deadline has passed — these are locked.'
                  : 'Not open for entries.'}
              </p>
            )}

            {picks.map(pick => (
              <div key={pick.id} className="mb-3 pb-3" style={{ borderBottom: '0.5px solid var(--border)' }}>
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{pick.label}</span>
                  <span className="text-xs" style={{ color: 'var(--accent)' }}>{pick.points}pts</span>
                </div>

                {pick.allow_free_text ? (
                  <Input
                    value={myPicks[pick.id] || ''}
                    disabled={picksLocked || saving}
                    placeholder="Type your answer"
                    onChange={e => setMyPicks(prev => ({ ...prev, [pick.id]: e.target.value }))}
                    className="w-full"
                  />
                ) : (
                  <Select
                    value={myPicks[pick.id] || ''}
                    disabled={picksLocked || saving}
                    onChange={e => setMyPicks(prev => ({ ...prev, [pick.id]: e.target.value }))}
                    className="w-full">
                    <option value="">Choose…</option>
                    {(pick.season_pick_options || []).map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </Select>
                )}
              </div>
            ))}

            {!picksLocked && (
              <Button variant="primary" className="w-full justify-center" onClick={savePicks} disabled={saving}>
                {saving ? 'Saving…' : 'Save my answers'}
              </Button>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/** Countdown chip. Turns green once done, amber when time is short. */
function DeadlinePill({ deadline, done }) {
  const days = daysUntil(deadline)
  const urgent = days !== null && days >= 0 && days <= 3

  const bg = done ? 'var(--green-dim)' : urgent ? 'var(--amber-dim)' : 'var(--bg-elevated)'
  const fg = done ? 'var(--green)' : urgent ? 'var(--amber)' : 'var(--txt-muted)'

  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: bg, color: fg }}>
      {done ? 'Done ✓' : deadlineLabel(deadline)}
    </span>
  )
}
