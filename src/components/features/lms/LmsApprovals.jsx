import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import { LMS_ERRORS } from '../../../lib/lms'
import { Card, SectionLabel } from '../../ui'

/**
 * Entries waiting for the admin (migration 133). The admin approves or turns
 * each one down; everyone else just sees who is waiting. Entries still
 * waiting at the first kick-off are dropped by the database.
 */
export default function LmsApprovals({ data, isAdmin, onDone }) {
  const [busy, setBusy] = useState(null)
  const { game, pending, locked } = data
  if (!pending?.length || game.status !== 'open' || locked) return null

  const name = e => {
    const mine = [...data.entries, ...pending].filter(x => x.user_id === e.user_id)
    return `${e.profile?.display_name || 'Player'}${mine.length > 1 ? ` #${e.entry_no}` : ''}`
  }

  async function decide(list, approve) {
    setBusy(list.length > 1 ? 'all' : list[0].id)
    try {
      for (const e of list) {
        const { data: r, error } = await supabase.rpc('lms_approve_entry', { p_entry_id: e.id, p_approve: approve })
        if (error) throw error
        if (!r?.ok) { toast.error(LMS_ERRORS[r?.error] || 'Something went wrong'); break }
      }
      toast.success(approve ? (list.length > 1 ? 'All approved' : 'Entry approved') : 'Entry turned down')
      await onDone()
    } catch (err) {
      toast.error(err.message || 'Could not save')
    } finally { setBusy(null) }
  }

  return (
    <Card className="mb-3 overflow-hidden" style={{ borderColor: 'var(--amber-line)' }}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <SectionLabel>Waiting for approval ({pending.length})</SectionLabel>
        {isAdmin && pending.length > 1 && (
          <button type="button" className="text-[11px] font-semibold px-2.5 py-1 rounded-full" disabled={busy != null}
            style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '0.5px solid var(--green-line)' }}
            onClick={() => decide(pending, true)}>Approve all</button>
        )}
      </div>
      {pending.map(e => (
        <div key={e.id} className="flex items-center gap-2 px-4 py-2" style={{ borderTop: '0.5px solid var(--border)', opacity: busy === e.id ? 0.6 : 1 }}>
          <span className="flex-1 text-sm truncate" style={{ color: 'var(--txt-primary)' }}>{name(e)}</span>
          <span className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>{e.stake} pts</span>
          {isAdmin ? <>
            <button type="button" disabled={busy != null} onClick={() => decide([e], true)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '0.5px solid var(--green-line)' }}>Approve</button>
            <button type="button" disabled={busy != null} onClick={() => window.confirm(`Turn down ${name(e)}'s entry?`) && decide([e], false)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: 'var(--red-dim)', color: 'var(--red)', border: '0.5px solid var(--red-line)' }}>Turn down</button>
          </> : <span className="text-[11px] font-semibold" style={{ color: 'var(--amber)' }}>Pending</span>}
        </div>
      ))}
      <p className="px-4 py-2 text-[10px]" style={{ color: 'var(--txt-muted)', borderTop: '0.5px solid var(--border)' }}>
        {isAdmin
          ? 'Entries count once you approve them. Any still waiting at the first kick-off are removed.'
          : 'The admin approves each entry. Any still waiting at the first kick-off are removed.'}
      </p>
    </Card>
  )
}

/**
 * Every player in the competition, with how many entries they have in this
 * game. The admin can add an entry for anyone (approved straight away) until
 * the first kick-off: migration 134.
 */
export function LmsAddPlayers({ competitionId, data, onDone }) {
  const [people, setPeople] = useState([])
  const [busy, setBusy] = useState(null)
  const { game, locked, allEntries } = data

  useEffect(() => {
    supabase.from('participants').select('user_id, profiles(display_name)').eq('competition_id', competitionId)
      .then(({ data: rows }) => setPeople((rows || []).map(r => ({ id: r.user_id, name: r.profiles?.display_name || 'Player' }))
        .sort((a, b) => a.name.localeCompare(b.name))))
  }, [competitionId, game?.id])

  if (!game || game.status !== 'open' || locked || !people.length) return null

  async function add(p) {
    setBusy(p.id)
    try {
      const { data: r, error } = await supabase.rpc('lms_admin_add_entry', { p_game_id: game.id, p_user_id: p.id })
      if (error) throw error
      if (!r?.ok) { toast.error(LMS_ERRORS[r?.error] || 'Something went wrong'); return }
      toast.success(`${p.name} added (entry ${r.entry_no})`)
      await onDone()
    } catch (err) {
      toast.error(/lms_admin_add_entry/.test(err.message || '') ? 'Run 134_lms_admin_add_entry.sql in Supabase first.' : (err.message || 'Could not add'))
    } finally { setBusy(null) }
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid var(--border-med)' }}>
      <div className="px-3 pt-2.5 pb-1.5"><SectionLabel>Players in this game</SectionLabel></div>
      {people.map(p => {
        const mine = allEntries.filter(e => e.user_id === p.id)
        const ok = mine.filter(e => e.approved !== false).length
        const waiting = mine.length - ok
        return (
          <div key={p.id} className="flex items-center gap-2 px-3 py-2" style={{ borderTop: '0.5px solid var(--border)', opacity: busy === p.id ? 0.6 : 1 }}>
            <span className="flex-1 text-sm truncate" style={{ color: 'var(--txt-primary)' }}>{p.name}</span>
            <span className="text-[11px]" style={{ color: ok ? 'var(--green)' : 'var(--txt-muted)' }}>
              {ok ? `${ok} entr${ok === 1 ? 'y' : 'ies'}` : 'Not in yet'}{waiting ? ` · ${waiting} waiting` : ''}
            </span>
            <button type="button" disabled={busy != null || mine.length >= 10} onClick={() => add(p)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '0.5px solid var(--accent-line)' }}>
              {ok ? '+ Entry' : 'Add to game'}
            </button>
          </div>
        )
      })}
      <p className="px-3 py-2 text-[10px]" style={{ color: 'var(--txt-muted)', borderTop: '0.5px solid var(--border)' }}>
        Adds an entry for that player, already approved. Each entry costs {game.entry_points} pts. Open until the first kick-off.
      </p>
    </div>
  )
}
