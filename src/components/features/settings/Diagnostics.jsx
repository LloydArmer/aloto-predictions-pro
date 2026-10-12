import { useState, useEffect, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { supabase } from '../../../lib/supabase'
import { Card, Button } from '../../ui'
import { isNative, liveActivityStatus, pushToStartTokenOnDevice } from '../../../lib/liveActivity'
import toast from 'react-hot-toast'

/**
 * What this phone actually is, and whether the lock screen score can reach it.
 *
 * Every step of the Live Activity chain fails silently by design — a lock
 * screen extra must never be able to break the page that asked for it — which
 * is correct, and also means that when it doesn't work there is nothing
 * anywhere to look at. This is the thing to look at.
 *
 * It deliberately separates "iOS never issued a token" from "iOS issued one
 * and it never reached the database", because those are different faults with
 * different fixes and from the outside they look identical.
 */
export default function Diagnostics({ userId }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    setBusy(true)
    const next = {
      platform: Capacitor.getPlatform(),
      native: isNative(),
      version: null,
      os: osVersion(),
      la: { supported: false, enabled: false },
      deviceToken: '',
      savedToken: '',
    }

    if (next.native) {
      try {
        const app = await App.getInfo()
        next.version = `${app.version} (${app.build})`
      } catch { /* older build without the plugin; left as Unknown */ }

      next.la = await liveActivityStatus()
      next.deviceToken = await pushToStartTokenOnDevice()
    }

    if (userId) {
      // Own row only — the policy on this table is yours-and-yours-alone, so
      // an empty result here genuinely means nothing was ever saved for you.
      const { data } = await supabase.from('live_activity_start_tokens')
        .select('token').eq('user_id', userId).limit(1)
      next.savedToken = data?.[0]?.token || ''
    }

    setInfo(next)
    setBusy(false)
  }, [userId])

  useEffect(() => { check() }, [check])

  if (!info) return null

  const lockScreen = lockScreenState(info)

  const rows = [
    ['Version',       info.version || (info.native ? 'Unknown' : 'Website')],
    ['Running on',    info.native ? `${info.platform}${info.os ? ` ${info.os}` : ''}` : 'Web browser'],
    ['Live Activities', !info.native ? 'Not applicable on the web'
                      : !info.la.supported ? 'Not supported on this iOS'
                      : info.la.enabled ? 'On'
                      : 'Off — turn on in iOS Settings'],
    ['Lock screen',   lockScreen.label],
  ]

  async function copy() {
    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
      + `\n\n${lockScreen.detail}`
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <Card className="p-4 mb-4">
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--txt-primary)' }}>
        This device
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
        What's installed and whether the lock screen score can reach you.
      </p>

      <div className="text-xs rounded-md p-2.5 mb-3" style={{ background: 'var(--bg-elevated)' }}>
        {rows.map(([label, value], i) => (
          <div key={label} className="flex items-baseline gap-2"
            style={{ marginTop: i ? 6 : 0 }}>
            <span style={{ color: 'var(--txt-muted)', flex: '0 0 92px' }}>{label}</span>
            <span style={{
              color: label === 'Lock screen' ? lockScreen.colour : 'var(--txt-primary)',
              flex: 1, minWidth: 0,
            }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {lockScreen.detail && (
        <p className="text-xs mb-3" style={{ color: 'var(--txt-second)', lineHeight: 1.55 }}>
          {lockScreen.detail}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={check} disabled={busy} className="btn-sm">
          {busy ? 'Checking…' : 'Check again'}
        </Button>
        <Button onClick={copy} className="btn-sm">Copy</Button>
      </div>
    </Card>
  )
}

/**
 * The one line that matters, and what to do about it.
 *
 * The two middle cases are the whole point of this panel: a token on the phone
 * with nothing in the database is a server-side fault, and no token at all is
 * an iOS-side one. They produce identical symptoms — no lock screen — and
 * chasing the wrong one costs an afternoon.
 */
function lockScreenState({ native, la, deviceToken, savedToken }) {
  if (!native) {
    return { label: 'Not applicable on the web', colour: 'var(--txt-second)', detail: '' }
  }

  if (!la.supported) {
    return {
      label: 'Not available',
      colour: 'var(--txt-second)',
      detail: 'This version of iOS is too old for Live Activities. iOS 16.2 is the minimum, and the lock screen score starting by itself needs 17.2.',
    }
  }

  if (!la.enabled) {
    return {
      label: 'Switched off',
      colour: 'var(--amber)',
      detail: 'Live Activities are off for ALOTO. Turn them on in iOS Settings → ALOTO → Live Activities, then come back and check again.',
    }
  }

  if (!deviceToken && !savedToken) {
    return {
      label: 'iOS has not issued a token',
      colour: 'var(--red)',
      detail: 'Live Activities are on, but iOS has not given this app a push-to-start token. That usually needs iOS 17.2 or later. Closing the app fully and reopening it is worth a try.',
    }
  }

  if (deviceToken && !savedToken) {
    return {
      label: 'On this phone, not saved',
      colour: 'var(--red)',
      detail: 'This phone has a token but it never reached the server, so nothing can start a Live Activity on it. This one is a fault at our end, not yours — send this screen over.',
    }
  }

  if (!deviceToken && savedToken) {
    return {
      label: 'Saved earlier',
      colour: 'var(--amber)',
      detail: 'A token is on record for you, but this phone is not offering one right now. If the lock screen score does not appear, check again after the next restart.',
    }
  }

  if (deviceToken !== savedToken) {
    return {
      label: 'Saved, but out of date',
      colour: 'var(--amber)',
      detail: 'This phone has been issued a newer token than the one on record. Reopening the app usually settles it.',
    }
  }

  return { label: 'Ready', colour: 'var(--green)', detail: '' }
}

/** "17.5" out of the user agent. Good enough to answer the 17.2 question. */
function osVersion() {
  const m = /OS (\d+)[._](\d+)/.exec(navigator.userAgent || '')
  return m ? `${m[1]}.${m[2]}` : ''
}
