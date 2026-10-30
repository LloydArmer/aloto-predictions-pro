import { useState, useRef, useEffect } from 'react'
import { PlayerMark } from '../../ui/Shirt'

/**
 * One message, plus what you can do to it.
 *
 * The actions are the reason this is its own component rather than markup
 * inside Chat: report and block are App Store requirements, and they need to
 * be reachable from every message without being so prominent that an ordinary
 * conversation looks like a moderation queue.
 */
export default function MessageRow({
  message, author, replyTo, isMine, isAdmin, grouped,
  onEdit, onRemove, onReport, onBlock,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Close on any click elsewhere. Without this the menu stays open behind the
  // next one you open, and on a phone you end up with two.
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  const removed = !!message.deleted_at

  // A removed message leaves a line rather than a hole.
  //
  // Deleting it outright would renumber the conversation around whoever was
  // moderated and make the replies to it incoherent — and it would hide the
  // fact that anything was done, which is the opposite of what a report is
  // for. The body is already blank in the database; there is nothing here to
  // leak.
  if (removed) {
    return (
      <div className="py-1.5 px-1 flex items-center gap-2">
        <i className="ti ti-circle-minus text-sm" style={{ color: 'var(--txt-muted)' }} aria-hidden="true" />
        <p className="text-xs italic" style={{ color: 'var(--txt-muted)' }}>
          Message removed{message.deleted_by === message.user_id ? ' by its author' : ' by an admin'}
        </p>
      </div>
    )
  }

  const name = author?.display_name || 'Someone'
  const canEdit = isMine && (Date.now() - new Date(message.created_at)) < 15 * 60 * 1000

  return (
    <div className={`flex gap-2 ${grouped ? 'mt-0.5' : 'mt-3'} group`}>

      {/* Avatar column — blank on a grouped message so a run of messages from
          one person reads as one turn in the conversation. */}
      <div style={{ width: 28, flexShrink: 0 }}>
        {!grouped && <PlayerMark kit={author?.badge_kit} displayName={name} size={28} />}
      </div>

      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        {!grouped && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-medium" style={{ color: isMine ? 'var(--accent)' : 'var(--txt-primary)' }}>
              {isMine ? 'You' : name}
            </span>
            <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        {replyTo && (
          <div className="mb-1 pl-2 text-xs truncate"
            style={{ borderLeft: '2px solid var(--border-med)', color: 'var(--txt-muted)' }}>
            {replyTo.deleted_at ? 'a removed message' : replyTo.body}
          </div>
        )}

        <div className="flex items-start gap-1">
          <p className="text-sm" style={{ color: 'var(--txt-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: '1 1 auto', minWidth: 0 }}>
            {message.body}
            {message.edited_at && (
              <span className="text-xs ml-1" style={{ color: 'var(--txt-muted)' }}>(edited)</span>
            )}
          </p>

          {/* The actions. Always rendered rather than revealed on hover —
              hover does not exist on a phone, and report has to be reachable
              there above all. */}
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center justify-center"
              style={{ width: 24, height: 24, color: 'var(--txt-muted)' }}
              aria-label={`Options for ${isMine ? 'your message' : `message from ${name}`}`}>
              <i className="ti ti-dots text-sm" aria-hidden="true" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-6 rounded-lg shadow-lg py-1 z-50 min-w-40"
                style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-med)' }}>

                {canEdit && (
                  <MenuItem icon="ti-pencil" onClick={() => { setMenuOpen(false); onEdit(message) }}>
                    Edit
                  </MenuItem>
                )}

                {(isMine || isAdmin) && (
                  <MenuItem icon="ti-trash" danger onClick={() => { setMenuOpen(false); onRemove(message) }}>
                    {isMine ? 'Delete' : 'Remove'}
                  </MenuItem>
                )}

                {/* You cannot report or block yourself, and offering it would
                    be the kind of detail that makes a reviewer look harder. */}
                {!isMine && (
                  <>
                    <MenuItem icon="ti-flag" onClick={() => { setMenuOpen(false); onReport(message) }}>
                      Report
                    </MenuItem>
                    <MenuItem icon="ti-ban" danger onClick={() => { setMenuOpen(false); onBlock(message) }}>
                      Block {name.split(' ')[0]}
                    </MenuItem>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MenuItem({ icon, children, onClick, danger }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left"
      style={{ color: danger ? 'var(--red)' : 'var(--txt-second)' }}>
      <i className={`ti ${icon} text-sm`} aria-hidden="true" />
      {children}
    </button>
  )
}

/** Time only for today, date and time for anything older. */
function formatTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
