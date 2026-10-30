import { useState } from 'react'
import { Button } from '../../ui'

/**
 * Reporting a message.
 *
 * A reason is required and a note is not. The reason is what makes the queue
 * triageable — "abuse" and "spam" need different speeds of response — and
 * demanding an explanation as well is how you end up with reports nobody
 * bothers to file.
 */
const REASONS = [
  { value: 'abuse',      label: 'Abusive or offensive' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'sexual',     label: 'Sexual content' },
  { value: 'spam',       label: 'Spam' },
  { value: 'other',      label: 'Something else' },
]

export default function ReportDialog({ message, author, onCancel, onSubmit }) {
  const [reason, setReason] = useState('abuse')
  const [note, setNote]     = useState('')
  const [sending, setSending] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSending(true)
    await onSubmit(reason, note.trim())
    setSending(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg p-4"
        style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-med)' }}
        onClick={e => e.stopPropagation()}>

        <h2 className="text-base font-medium mb-1" style={{ color: 'var(--txt-primary)' }}>
          Report this message
        </h2>
        <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
          A league admin will look at it. Reports are not anonymous to admins.
        </p>

        {/* What is being reported, quoted back. Reporting the wrong message by
            tapping the wrong row is easy, and there is no undo. */}
        <div className="mb-3 p-2 rounded-md text-xs"
          style={{ background: 'var(--bg-base)', color: 'var(--txt-second)' }}>
          <span style={{ color: 'var(--txt-muted)' }}>{author?.display_name || 'Someone'}: </span>
          {message.body.length > 180 ? message.body.slice(0, 180) + '…' : message.body}
        </div>

        <form onSubmit={submit}>
          <fieldset className="mb-3">
            <legend className="text-xs mb-2" style={{ color: 'var(--txt-second)' }}>Why?</legend>
            {REASONS.map(r => (
              <label key={r.value} className="flex items-center gap-2 py-1.5 text-sm"
                style={{ color: 'var(--txt-primary)' }}>
                <input type="radio" name="reason" value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)} />
                {r.label}
              </label>
            ))}
          </fieldset>

          <textarea
            className="input w-full mb-3"
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Anything else the admin should know (optional)"
            maxLength={500}
            style={{ resize: 'none' }}
            aria-label="Additional detail"
          />

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="danger" size="sm" disabled={sending}>
              {sending ? 'Sending…' : 'Report'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
