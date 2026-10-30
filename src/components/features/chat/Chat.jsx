import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { useChat } from '../../../hooks/useChat'
import { Spinner, EmptyState, Button } from '../../ui'
import { PlayerMark } from '../../ui/Shirt'
import HouseRules from './HouseRules'
import MessageRow from './MessageRow'
import ReportDialog from './ReportDialog'
import toast from 'react-hot-toast'

/**
 * League chat.
 *
 * One room per competition, following whichever competition is selected
 * everywhere else in the app — so switching league in the nav switches room,
 * and nobody has to learn a second way of choosing one.
 */
export default function Chat() {
  const { user, profile, fetchProfile } = useAuth()
  const { competitions, loading: compsLoading } = useCompetitions()
  const [competitionId] = useSelectedCompetition(competitions)

  const {
    messages, people, loading, banned, enabled, error,
    send, edit, remove, report, block, markRead,
  } = useChat(competitionId, user?.id)

  const [draft, setDraft]       = useState('')
  const [sending, setSending]   = useState(false)
  const [reporting, setReporting] = useState(null)   // the message being reported
  const [editingId, setEditingId] = useState(null)
  // The partial name after an @, or null when the caret is not in one.
  const [mentionQuery, setMentionQuery] = useState(null)
  const inputRef = useRef(null)

  const scroller = useRef(null)
  const bottom   = useRef(null)
  const shell    = useRef(null)

  // ── How tall the room is ─────────────────────────────────────────────────
  //
  // Measured rather than written as a calc(). The chrome above this point is
  // a sticky nav whose height varies with the status bar inset on a phone,
  // and the chrome below is the tab bar — so the one number that is reliably
  // known is where this element actually starts, which the browser can tell
  // us. 100dvh rather than 100vh so the iOS address bar collapsing does not
  // leave the composer under the keyboard.
  const [height, setHeight] = useState(null)
  useEffect(() => {
    function measure() {
      const el = shell.current
      if (!el) return
      const styles = getComputedStyle(document.documentElement)
      const px = v => parseFloat(styles.getPropertyValue(v)) || 0
      // The tab bar only exists on phones; on desktop it is display:none and
      // subtracting it would leave a band of dead space.
      const below = window.innerWidth >= 768 ? 24 : px('--tab-bar-h') + px('--safe-bottom') + 12
      setHeight(Math.max(260, window.innerHeight - el.getBoundingClientRect().top - below))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [loading, competitionId])

  const competition = competitions.find(c => c.id === competitionId)
  const isAdmin = competition?.my_role === 'admin' || profile?.role === 'admin'
  const acceptedRules = !!profile?.chat_rules_accepted_at

  // Who is talking, for the messages. Realtime rows carry a user_id and
  // nothing else, so every author is looked up here.
  const authorOf = useMemo(() => (id) => people[id] || null, [people])

  // Who matches what has been typed after the @.
  //
  // An empty query lists the room rather than nothing: typing "@" on its own
  // is how you mention someone whose spelling you cannot remember, which is
  // the case the whole feature exists for.
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.trim().toLowerCase()
    return Object.values(people)
      .filter(p => p.display_name && p.id !== user?.id)
      .filter(p => !q || p.display_name.toLowerCase().includes(q))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .slice(0, 6)
  }, [mentionQuery, people, user?.id])

  // ── Sticking to the bottom ───────────────────────────────────────────────
  //
  // Only when already there. Scrolling someone back to the latest message
  // while they are reading history is the single most irritating thing a chat
  // can do, and it happens every time somebody else types.
  const wasAtBottom = useRef(true)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      wasAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (wasAtBottom.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // Opening the room is what clears the badge. Marked on arrival and again on
  // leaving, so messages that landed while it was open do not come back as
  // unread the moment the tab is closed.
  useEffect(() => {
    if (!competitionId || !user?.id || loading) return
    markRead()
    return () => { markRead() }
  }, [competitionId, user?.id, loading, markRead])

  async function handleSend(e) {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || sending) return

    setSending(true)
    const result = editingId
      ? await edit(editingId, text)
      : await send(text)
    setSending(false)

    if (!result.ok) {
      // The filter's message is written for the person who typed it, so show
      // it as it is rather than translating it into something blander.
      toast.error(result.message || 'That message could not be sent.')
      return
    }
    setDraft('')
    setEditingId(null)
    wasAtBottom.current = true
  }

  // ── Mentions ────────────────────────────────────────────────
  //
  // Matched on the text BEFORE the caret, not the whole draft, so editing an
  // earlier @ in a long message still offers the right list.
  //
  // Display names contain spaces, so the query cannot stop at one — it runs
  // to the end of the caret text and the filter narrows as they keep typing.
  // Capped at 30 characters so an @ earlier in a paragraph stops matching
  // rather than following them to the end of the message.
  function detectMention(el) {
    const upToCaret = el.value.slice(0, el.selectionStart ?? el.value.length)
    const m = upToCaret.match(/@([^@\n]{0,30})$/)
    setMentionQuery(m ? m[1] : null)
  }

  function insertMention(person) {
    const el = inputRef.current
    if (!el) return
    const caret  = el.selectionStart ?? draft.length
    const before = draft.slice(0, caret).replace(/@([^@\n]{0,30})$/, '')
    const after  = draft.slice(caret)
    const inserted = `@${person.display_name} `
    setDraft(before + inserted + after)
    setMentionQuery(null)
    // Put the caret after what was just inserted rather than at the end:
    // mentioning someone mid-sentence is normal and losing your place is not.
    const pos = before.length + inserted.length
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos) })
  }

  function startEdit(message) {
    setEditingId(message.id)
    setDraft(message.body)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft('')
  }

  async function handleRemove(message) {
    const result = await remove(message.id)
    if (!result.ok) toast.error(result.message || 'Could not remove that message.')
    else toast.success('Message removed')
  }

  async function handleBlock(message) {
    const name = authorOf(message.user_id)?.display_name || 'that player'
    const result = await block(message.user_id)
    if (!result.ok) { toast.error(result.message || 'Could not block.'); return }
    toast.success(`You won't see messages from ${name}`)
  }

  async function handleReport(reason, note) {
    const result = await report(reporting, reason, note)
    setReporting(null)
    if (!result.ok) { toast.error(result.message || 'Could not send that report.'); return }
    toast.success(result.already
      ? 'You have already reported that message.'
      : 'Reported. An admin will look at it.')
  }

  async function acceptRules() {
    const { error: err } = await supabase
      .from('profiles')
      .update({ chat_rules_accepted_at: new Date().toISOString() })
      .eq('id', user.id)
    if (err) { toast.error('Could not save that. Try again.'); return }
    // fetchProfile takes the id — calling it bare re-queries for `undefined`
    // and blanks the profile, which would leave this screen stuck on the
    // rules it had just accepted.
    await fetchProfile?.(user.id)
  }

  // ── States before the room ───────────────────────────────────────────────
  if (compsLoading || (loading && competitionId)) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  if (!competitionId) {
    return (
      <EmptyState
        icon="ti-messages"
        title="No competition selected"
        description="Chat belongs to a league. Pick one to start talking."
      />
    )
  }

  // The admin has not opened a room here. Said plainly, with where the
  // conversation probably is, rather than an empty screen.
  if (enabled === false) {
    return (
      <EmptyState
        icon="ti-message-off"
        title="No chat in this competition"
        description={`${competition?.name || 'This competition'} doesn't have a chat room. If you're in another league with the same people, that's where the conversation is — switch competition at the top.`}
      />
    )
  }

  if (!acceptedRules) {
    return <HouseRules onAccept={acceptRules} competitionName={competition?.name} />
  }

  if (error) {
    return (
      <EmptyState
        icon="ti-alert-triangle"
        title="Chat could not be loaded"
        description={error}
      />
    )
  }

  return (
    <div ref={shell} className="flex flex-col" style={height ? { height } : { minHeight: 320 }}>

      {/* ── Who you're talking to ── */}
      <div className="px-1 pb-2 flex items-center gap-2">
        <i className="ti ti-messages text-base" style={{ color: 'var(--txt-muted)' }} aria-hidden="true" />
        <p className="text-sm font-medium" style={{ color: 'var(--txt-second)' }}>
          {competition?.name || 'League chat'}
        </p>
        <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>
          · {Object.keys(people).length} {Object.keys(people).length === 1 ? 'player' : 'players'}
        </span>
      </div>

      {/* ── The conversation ── */}
      <div ref={scroller} className="flex-1 overflow-y-auto px-1"
        style={{ overscrollBehavior: 'contain' }}>
        {messages.length === 0
          ? <EmptyState
              icon="ti-message-circle"
              title="Nothing here yet"
              description="First one to say something sets the tone."
            />
          : messages.map((m, i) => (
              <MessageRow
                key={m.id}
                message={m}
                author={authorOf(m.user_id)}
                replyTo={m.reply_to_id ? messages.find(x => x.id === m.reply_to_id) : null}
                isMine={m.user_id === user?.id}
                isAdmin={isAdmin}
                // Group consecutive messages from the same person: the avatar
                // and name only appear when the speaker changes, which is what
                // stops a back-and-forth looking like a list of forms.
                grouped={i > 0
                  && messages[i - 1].user_id === m.user_id
                  && (new Date(m.created_at) - new Date(messages[i - 1].created_at)) < 5 * 60 * 1000}
                onEdit={startEdit}
                onRemove={handleRemove}
                onReport={setReporting}
                onBlock={handleBlock}
              />
            ))}
        <div ref={bottom} />
      </div>

      {/* ── The composer ── */}
      {banned ? (
        <div className="mt-2 p-3 rounded-md text-xs"
          style={{ background: 'var(--amber-dim)', border: '0.5px solid rgba(245,166,35,0.3)', color: 'var(--txt-second)' }}>
          You have been removed from this league's chat by an admin. You can still
          predict, and your points and position are unaffected.
        </div>
      ) : (
        <form onSubmit={handleSend} className="mt-2 flex items-end gap-2"
          style={{ position: 'relative' }}>

          {/* Who you might mean. Sits above the composer rather than below
              it, because below is where the keyboard is. */}
          {mentionMatches.length > 0 && (
            <div className="absolute left-0 right-0 rounded-lg shadow-lg py-1 z-50"
              style={{ bottom: '100%', marginBottom: 6, background: 'var(--bg-elevated)', border: '0.5px solid var(--border-med)', maxHeight: 180, overflowY: 'auto' }}>
              {mentionMatches.map(p => (
                <button key={p.id} type="button"
                  // onMouseDown, not onClick: the textarea's blur fires
                  // first on a click and would close this before it lands.
                  onMouseDown={e => { e.preventDefault(); insertMention(p) }}
                  className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left"
                  style={{ color: 'var(--txt-primary)' }}>
                  <PlayerMark kit={p.badge_kit} displayName={p.display_name} size={20} />
                  {p.display_name}
                </button>
              ))}
            </div>
          )}

          <textarea
            className="input flex-1"
            rows={1}
            ref={inputRef}
            value={draft}
            onChange={e => { setDraft(e.target.value); detectMention(e.target) }}
            onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
            onKeyDown={e => {
              // Enter sends, Shift+Enter makes a new line. On a phone the
              // keyboard's return key inserts a newline either way, which is
              // the behaviour people expect there.
              if (e.key === 'Escape') { setMentionQuery(null); return }
              if (e.key === 'Enter' && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) {
                e.preventDefault(); handleSend()
              }
            }}
            placeholder={editingId ? 'Edit your message…' : 'Say something…'}
            maxLength={2000}
            style={{ resize: 'none', maxHeight: 120, minHeight: 40 }}
            aria-label="Message"
          />
          {editingId && (
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary" size="sm" disabled={!draft.trim() || sending}>
            {sending ? '…' : editingId ? 'Save' : 'Send'}
          </Button>
        </form>
      )}

      {reporting && (
        <ReportDialog
          message={reporting}
          author={authorOf(reporting.user_id)}
          onCancel={() => setReporting(null)}
          onSubmit={handleReport}
        />
      )}
    </div>
  )
}
