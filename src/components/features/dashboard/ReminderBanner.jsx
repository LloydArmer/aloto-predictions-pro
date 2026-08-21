import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { pushCapability, rememberedDeviceToken } from '../../../lib/push'

const DISMISS_KEY = 'aloto.reminderBanner.dismissedUntil'

/**
 * Prompts a participant to turn reminders on — but only when it would actually
 * help them.
 *
 * Someone who installs the app and declines notifications is the one group
 * push can't reach, and SMS wouldn't reach them either (it needs a phone number
 * and consent they haven't given). An in-app prompt is the only thing that
 * does, and it costs nothing to run.
 *
 * Three conditions, all required:
 *   - this device isn't registered for push
 *   - the device is capable of it (so iPhone users in Safari get told to
 *     install first rather than shown a button that can't work)
 *   - they have predictions outstanding right now
 *
 * That last one is what keeps it from being nagging. A banner shown to someone
 * with nothing to do is noise, and noise gets dismissed permanently.
 */
export default function ReminderBanner({ userId, pendingGws }) {
  const [state, setState] = useState(null) // null = still checking

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      // Dismissal lasts a week, not forever. Someone who dismisses it in
      // August has probably changed their mind by the time they've missed a
      // couple of deadlines — but re-asking the next day would be nagging.
      try {
        const until = Number(localStorage.getItem(DISMISS_KEY) || 0)
        if (until > Date.now()) { setState({ show: false }); return }
      } catch { /* private browsing — just show it */ }

      const cap = await pushCapability()
      if (cancelled) return

      if (!cap.supported) {
        // Worth telling iPhone users why, since the fix is one action away.
        // Any other unsupported case has no remedy, so stay quiet.
        setState({ show: cap.reason === 'ios-needs-install', variant: 'ios-install' })
        return
      }

      // Registered on this device? Same check Settings uses.
      const mine = rememberedDeviceToken()
      if (mine) {
        const { count } = await supabase.from('push_tokens')
          .select('id', { count: 'exact', head: true }).eq('token', mine)
        if (cancelled) return
        if ((count ?? 0) > 0) { setState({ show: false }); return }
      }

      setState({ show: true, variant: 'enable' })
    })()

    return () => { cancelled = true }
  }, [userId])

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000)) } catch { /* ignore */ }
    setState({ show: false })
  }

  const outstanding = (pendingGws || []).reduce((sum, gw) => sum + gw.pendingCount, 0)

  // Nothing to chase, still checking, or already sorted.
  if (!state?.show || outstanding === 0) return null

  const iosInstall = state.variant === 'ios-install'

  return (
    <div className="mb-4 p-3 rounded-md flex items-start gap-3"
      style={{ background: 'var(--amber-dim)', border: '0.5px solid rgba(245,166,35,0.3)' }}>
      <i className="ti ti-bell-off text-base flex-shrink-0" style={{ color: 'var(--amber)', marginTop: 1 }} aria-hidden="true" />

      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--amber)' }}>
          You won't be reminded
        </p>
        <p className="text-xs mb-2" style={{ color: 'var(--txt-second)' }}>
          {outstanding} prediction{outstanding !== 1 ? 's' : ''} still to make, and reminders are off on this device.
          Each fixture locks at its own kickoff.
        </p>

        {iosInstall
          ? <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
              On iPhone, tap Share then <strong>Add to Home Screen</strong>, open ALOTO from the new
              icon, and turn reminders on in Settings.
            </p>
          : <Link to="/settings" className="btn btn-sm" style={{ background: 'var(--amber)', color: '#1a1400', fontWeight: 600 }}>
              Turn on reminders
            </Link>}
      </div>

      <button onClick={dismiss} aria-label="Dismiss"
        className="flex items-center justify-center flex-shrink-0"
        style={{ width: 24, height: 24, color: 'var(--txt-muted)' }}>
        <i className="ti ti-x text-sm" aria-hidden="true" />
      </button>
    </div>
  )
}
