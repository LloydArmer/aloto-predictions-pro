import { useState } from 'react'
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
