import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Button, Badge, EmptyState, Spinner } from '../../ui'
import toast from 'react-hot-toast'

/**
 * Reported messages, and what to do about them.
 *
 * This screen is the reason chat can be submitted to the App Store at all.
 * Apple's requirement is not a report button — it is a report button and
 * "timely responses to concerns", which in practice means acting within a day.
 * So the queue leads with how long each one has been waiting, and says so in
 * red once it has gone past that.
 *
 * Everything here goes through chat_report_queue() and chat_resolve_report()
 * rather than the tables directly: the queue has to show the admin a message
 * they may have blocked, and resolving has to stamp the report, remove the
 * message and bar the author as one act rather than three that can half-fail.
 */
export default function ChatModerationTab({ competitionId }) {
  const [open, setOpen]         = useState([])
  const [history, setHistory]   = useState([])
  const [banned, setBanned]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(null)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    if (!competitionId) return
    setLoading(true)
    const [{ data: all }, { data: bans }] = await Promise.all([
      supabase.rpc('chat_report_queue', { p_competition_id: competitionId, p_include_resolved: true }),
      supabase.rpc('chat_banned_players', { p_competition_id: competitionId }),
    ])
    setOpen((all || []).filter(r => !r.resolved_at))
    setHistory((all || []).filter(r => r.resolved_at))
    setBanned(bans || [])
    setLoading(false)
  }, [competitionId])

  useEffect(() => { load() }, [load])

  async function resolve(report, action) {
    setBusy(report.report_id)
    const { error } = await supabase.rpc('chat_resolve_report', {
      p_report_id: report.report_id,
      p_action: action,
    })
    setBusy(null)
    if (error) { toast.error(error.message || 'Could not action that report.'); return }
    toast.success({
      removed:   'Message removed',
      banned:    `${report.author_name} removed from the chat`,
      dismissed: 'Report dismissed',
    }[action])
    load()
  }

  async function unban(player) {
    const { error } = await supabase
      .from('chat_bans')
      .delete()
      .eq('competition_id', competitionId)
      .eq('user_id', player.user_id)
    if (error) { toast.error('Could not lift that ban.'); return }
    toast.success(`${player.display_name} can post again`)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>

  return (
    <div className="space-y-3">

      {/* ── What is waiting ── */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
            Reported messages
          </p>
          {open.length > 0 && <Badge variant="live">{open.length} open</Badge>}
        </div>

        {open.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
            Nothing waiting. Reports from players in this league appear here.
          </p>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
              Deal with these within a day. That response time is a condition of
              having chat in the App Store at all, not a target.
            </p>
            <div className="space-y-3">
              {open.map(r => (
                <ReportCard key={r.report_id} report={r} busy={busy === r.report_id}
                  onResolve={resolve} />
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ── Who is barred ── */}
      {banned.length > 0 && (
        <Card className="p-3">
          <p className="text-sm font-medium mb-2" style={{ color: 'var(--txt-primary)' }}>
            Removed from the chat
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
            They can still predict and their points are unaffected — they just can't post.
          </p>
          {banned.map(p => (
            <div key={p.user_id} className="flex items-center justify-between py-1.5"
              style={{ borderTop: '0.5px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <p className="text-sm truncate" style={{ color: 'var(--txt-primary)' }}>{p.display_name}</p>
                <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                  since {new Date(p.banned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => unban(p)}>Let back in</Button>
            </div>
          ))}
        </Card>
      )}

      {/* ── The record ── */}
      <Card className="p-3">
        <button onClick={() => setShowHistory(h => !h)}
          className="flex items-center justify-between w-full text-left">
          <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>
            Previously actioned
          </span>
          <span className="text-xs flex items-center gap-1" style={{ color: 'var(--txt-muted)' }}>
            {history.length}
            <i className={`ti ti-chevron-${showHistory ? 'up' : 'down'} text-sm`} aria-hidden="true" />
          </span>
        </button>

        {showHistory && (
          history.length === 0
            ? <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>Nothing yet.</p>
            : <div className="mt-3 space-y-2">
                {history.map(r => (
                  <div key={r.report_id} className="text-xs py-2"
                    style={{ borderTop: '0.5px solid var(--border)', color: 'var(--txt-second)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span style={{ color: 'var(--txt-muted)' }}>
                        {r.author_name} · reported by {r.reporter_name}
                      </span>
                      <Badge variant={r.action === 'dismissed' ? 'upcoming' : 'completed'}>
                        {{ removed: 'Removed', banned: 'Removed + barred', dismissed: 'Dismissed' }[r.action] || r.action}
                      </Badge>
                    </div>
                    {/* The snapshot, kept so this record still says what the
                        complaint was about after the message itself was wiped. */}
                    <p style={{ color: 'var(--txt-muted)', fontStyle: 'italic' }}>
                      “{truncate(r.message_snapshot, 140)}”
                    </p>
                  </div>
                ))}
              </div>
        )}
      </Card>
    </div>
  )
}

function ReportCard({ report: r, busy, onResolve }) {
  const hours = Math.floor((Date.now() - new Date(r.reported_at)) / 3600000)
  const late  = hours >= 24

  return (
    <div className="p-3 rounded-md"
      style={{
        background: 'var(--bg-base)',
        border: `0.5px solid ${late ? 'var(--red)' : 'var(--border-med)'}`,
      }}>

      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-xs" style={{ color: 'var(--txt-muted)', minWidth: 0 }}>
          <strong style={{ color: 'var(--txt-second)' }}>{r.reporter_name}</strong> reported{' '}
          <strong style={{ color: 'var(--txt-second)' }}>{r.author_name}</strong>
        </span>
        <span className="text-xs flex-shrink-0" style={{ color: late ? 'var(--red)' : 'var(--txt-muted)', fontWeight: late ? 600 : 400 }}>
          {waitingLabel(hours)}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Badge variant="upcoming">{REASON_LABEL[r.reason] || r.reason}</Badge>
        {!r.message_live && <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>already removed</span>}
        {r.author_banned && <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>already barred</span>}
      </div>

      <p className="text-sm mb-2 p-2 rounded"
        style={{ background: 'var(--bg-elevated)', color: 'var(--txt-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {r.message_snapshot || '(the message was empty)'}
      </p>

      {r.note && (
        <p className="text-xs mb-2" style={{ color: 'var(--txt-second)' }}>
          <span style={{ color: 'var(--txt-muted)' }}>They added: </span>{r.note}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="danger" disabled={busy}
          onClick={() => onResolve(r, 'banned')}>
          Remove + bar
        </Button>
        <Button size="sm" disabled={busy}
          onClick={() => onResolve(r, 'removed')}>
          Remove message
        </Button>
        <Button size="sm" variant="ghost" disabled={busy}
          onClick={() => onResolve(r, 'dismissed')}>
          Nothing wrong
        </Button>
      </div>
    </div>
  )
}

const REASON_LABEL = {
  abuse:      'Abusive',
  harassment: 'Harassment',
  sexual:     'Sexual content',
  spam:       'Spam',
  other:      'Other',
}

function waitingLabel(hours) {
  if (hours < 1)  return 'just now'
  if (hours < 24) return `${hours}h waiting`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} waiting`
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

/**
 * How many reports are waiting, for the badge on the tab.
 *
 * An admin who never opens the tab is the failure mode this exists to prevent
 * — the clock runs whether or not anyone is looking.
 */
export function useOpenReportCount(competitionId, refreshKey) {
  const [count, setCount] = useState(0)

  // refreshKey re-counts without this needing to know why. Admin passes the
  // selected tab, so coming back from the queue picks up whatever was just
  // actioned — while you are ON the queue the list itself is the truth, so
  // there is nothing to keep in step.
  useEffect(() => {
    if (!competitionId) { setCount(0); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.rpc('chat_report_queue', {
        p_competition_id: competitionId, p_include_resolved: false,
      })
      if (!cancelled) setCount((data || []).length)
    })()
    return () => { cancelled = true }
  }, [competitionId, refreshKey])

  return count
}
