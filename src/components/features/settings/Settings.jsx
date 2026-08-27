import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Card, Button } from '../../ui'
import { pushCapability, enablePush, disablePush, resetPush, isIOS, rememberedDeviceToken } from '../../../lib/push'
import JoinCompetition from '../competitions/JoinCompetition'
import HowToPlay from '../help/HowToPlay'
import toast from 'react-hot-toast'

export default function Settings() {
  const { user, profile, isAdmin, fetchProfile } = useAuth()
  // WhatsApp and SMS were removed from this screen. Nothing sent them — there
  // is no Twilio account, and native push covers everyone once the app is on
  // the stores. Leaving the toggles would have been worse than useless: people
  // tick a box, expect messages, and get nothing.
  //
  // The profiles columns (phone_number, notify_whatsapp, notify_sms) are left
  // in the database. They cost nothing, they hold numbers people already
  // entered, and dropping them would need a migration to undo if SMS is ever
  // wanted as a paid extra.

  // Push state.
  //
  // `deviceOn` — is THIS browser registered? This is what the toggle shows.
  // `capability` — can this device do push at all? null means still checking.
  // `deviceCount` — how many of the participant's devices are registered.
  //
  // The toggle deliberately does NOT reflect profiles.notify_push. That column
  // defaults to true, so reading it showed the switch already on for someone who
  // had never registered a device — they'd assume they were covered and never
  // receive a single reminder. The switch now means "this device will be
  // reminded", which is the thing the participant actually cares about.
  const [capability, setCapability] = useState(null)
  const [deviceOn, setDeviceOn] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [deviceCount, setDeviceCount] = useState(0)

  const [adminExists, setAdminExists] = useState(true) // assume true until checked, so the button never flashes on
  const [checkingAdmin, setCheckingAdmin] = useState(true)
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    if (isAdmin) { setCheckingAdmin(false); return }
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
      .then(({ count }) => setAdminExists((count ?? 0) > 0))
      .finally(() => setCheckingAdmin(false))
  }, [isAdmin])

  useEffect(() => { pushCapability().then(setCapability) }, [])

  // Work out whether this specific browser is registered, by matching the token
  // it recorded locally against what's actually stored.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const { count } = await supabase.from('push_tokens')
        .select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      if (cancelled) return
      setDeviceCount(count ?? 0)

      const mine = rememberedDeviceToken()
      if (!mine) { setDeviceOn(false); return }
      const { count: hit } = await supabase.from('push_tokens')
        .select('id', { count: 'exact', head: true }).eq('token', mine)
      if (!cancelled) setDeviceOn((hit ?? 0) > 0)
    })()
    return () => { cancelled = true }
  }, [user])

  async function togglePush(next) {
    setPushBusy(true)
    try {
      if (next) {
        const result = await enablePush(user.id)
        if (!result.ok) {
          const messages = {
            denied: 'Notifications are blocked for this site. Turn them back on in your browser or phone settings, then try again.',
            dismissed: 'No problem — you can turn reminders on any time.',
            'ios-needs-install': 'On iPhone, add ALOTO to your Home Screen first (Share → Add to Home Screen), then open it from there.',
            unsupported: 'This browser can\u2019t receive push notifications.',
            'no-token': 'Could not register this device. Try reloading the page.',
            'save-failed': 'Could not save this device. Check your connection and try again.',
          }
          toast.error(messages[result.reason] || 'Could not turn on reminders')
          return
        }
        // Registering a device implies wanting reminders, so switch the account
        // preference back on too — otherwise the job would skip them.
        await supabase.from('profiles').update({ notify_push: true }).eq('id', user.id)
      } else {
        await disablePush(user.id)
      }

      // Recount from the database rather than adjusting a local number: another
      // device may have registered or dropped off since this page loaded.
      const { count } = await supabase.from('push_tokens')
        .select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      const remaining = count ?? 0
      setDeviceCount(remaining)
      setDeviceOn(next)

      // Only mute the account once the LAST device has gone. Turning reminders
      // off on a laptop shouldn't silence the phone as well.
      if (!next && remaining === 0) {
        await supabase.from('profiles').update({ notify_push: false }).eq('id', user.id)
      }

      await fetchProfile(user.id)
      toast.success(next ? 'Reminders on for this device' : 'Reminders off for this device')
    } catch {
      toast.error('Could not update reminder settings')
    } finally { setPushBusy(false) }
  }

  /**
   * Last resort when the numbers stop making sense — more devices listed than
   * the person owns, or reminders arriving erratically. Clears everything and
   * registers this device again from nothing.
   */
  async function doReset() {
    const ok = window.confirm(
      'Reset notifications?\n\n' +
      'This clears every device on your account and sets this one up again. ' +
      'Any other device will need reminders switched back on.\n\n' +
      'Use this if reminders arrive twice, arrive erratically, or the device count looks wrong.'
    )
    if (!ok) return

    setResetting(true)
    try {
      const result = await resetPush(user.id)
      await fetchProfile(user.id)

      const { count } = await supabase.from('push_tokens')
        .select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      setDeviceCount(count ?? 0)
      setDeviceOn(!!result?.ok)

      if (result?.ok) toast.success('Reset — this device is registered again')
      else if (result?.reason === 'denied') toast.error('Cleared, but notification permission is blocked. Allow it in your browser or phone settings, then switch reminders on.')
      else toast.error('Cleared, but could not re-register. Switch reminders on above to try again.')
    } catch {
      toast.error('Could not reset notifications')
    } finally { setResetting(false) }
  }

  async function claimAdmin() {
    setClaiming(true)
    try {
      const { error } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id)
      if (error) throw error
      await fetchProfile(user.id)
      toast.success("You're now the admin!")
    } catch {
      // Most likely reason: someone else claimed admin a moment before you did.
      setAdminExists(true)
      toast.error('An admin already exists for this league — ask them for access.')
    } finally { setClaiming(false) }
  }

  const needsIosInstall = capability && !capability.supported && capability.reason === 'ios-needs-install'
  const unsupported     = capability && !capability.supported && capability.reason === 'unsupported'

  return (
    <div className="max-w-sm">
      <h1 className="text-base font-medium mb-5" style={{ color:'var(--txt-primary)' }}>Settings</h1>

      {/* Joining lives here because it's where someone looks when they've been
          sent a code and don't yet know where to put it. */}
      <div className="mb-5">
        <JoinCompetition onJoined={() => window.location.reload()} />
      </div>

      <div className="mb-5">
        <HowToPlay isAdmin={isAdmin} />
      </div>

      <Card className="p-4 mb-5">
        <p className="text-xs font-medium mb-2.5" style={{ color: 'var(--txt-muted)' }}>About</p>
        <div className="flex flex-col gap-2.5">
          <a href="/support" className="text-sm" style={{ color: 'var(--accent)' }}>Support and FAQs</a>
          <a href="/privacy" className="text-sm" style={{ color: 'var(--accent)' }}>Privacy policy</a>
        </div>
      </Card>

      {!isAdmin && !checkingAdmin && !adminExists && (
        <Card className="p-4 mb-5" style={{ background:'var(--accent-dim)', borderColor:'rgba(79,142,247,0.35)' }}>
          <p className="text-xs font-medium mb-1" style={{ color:'var(--accent)' }}>No admin set up yet</p>
          <p className="text-xs mb-3" style={{ color:'var(--txt-second)' }}>This league doesn't have an admin yet. If this is your league, claim admin access to set up competitions, gameweeks, and fixtures. This option disappears once someone claims it.</p>
          <Button variant="primary" onClick={claimAdmin} disabled={claiming} className="w-full justify-center">
            {claiming ? 'Claiming…' : 'Claim admin access'}
          </Button>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <p className="text-xs font-medium mb-3" style={{ color:'var(--txt-muted)' }}>Prediction reminders</p>

        <div className="flex items-center justify-between py-2.5 border-b" style={{ borderColor:'var(--border)' }}>
          <div style={{ minWidth: 0, paddingRight: 12 }}>
            <p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>Push notifications</p>
            <p className="text-xs" style={{ color:'var(--txt-muted)' }}>
              When a gameweek opens, 24 hours before kickoff, and 1 hour before
            </p>
          </div>
          {/* While capability is still resolving, say so rather than showing a
              dead greyed-out switch that looks broken. */}
          {capability === null
            ? <span className="text-xs" style={{ color:'var(--txt-muted)', flexShrink:0 }}>Checking…</span>
            : <input
                type="checkbox"
                checked={deviceOn}
                disabled={pushBusy || !capability.supported}
                onChange={e => togglePush(e.target.checked)}
                style={{ width:16, height:16, cursor: capability.supported ? 'pointer' : 'not-allowed', accentColor:'var(--accent)', flexShrink: 0 }}
              />}
        </div>

        <p className="text-xs pt-2.5" style={{ color:'var(--txt-muted)' }}>
          The 24-hour and 1-hour reminders are only sent if you still have predictions outstanding.
          Finish them early and you won't hear from us.
        </p>

        {deviceOn && (
          <p className="text-xs mt-2" style={{ color:'var(--green)' }}>
            This device is registered{deviceCount > 1 ? ` — ${deviceCount} in total on your account` : ''}
          </p>
        )}

        {/* Only offered once something is registered — there is nothing to
            reset otherwise, and an always-visible reset button invites people
            to press it instead of the toggle. */}
        {capability?.supported && deviceCount > 0 && (
          <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
            <p className="text-xs mb-2" style={{ color:'var(--txt-muted)' }}>
              Reminders arriving twice, arriving erratically, or more devices listed than you own?
            </p>
            <Button onClick={doReset} disabled={resetting} className="btn-sm">
              <i className="ti ti-refresh text-sm mr-1" aria-hidden="true"/>
              {resetting ? 'Resetting…' : 'Reset notifications'}
            </Button>
          </div>
        )}

        {/* Registered elsewhere but not here. Without this, someone who set it up
            on their phone would open Settings on a laptop, see the switch off,
            and think reminders had stopped working. */}
        {!deviceOn && deviceCount > 0 && capability?.supported && (
          <p className="text-xs mt-2" style={{ color:'var(--txt-muted)' }}>
            Reminders are on for {deviceCount} other device{deviceCount !== 1 ? 's' : ''}, but not this one.
            Switch it on above to be reminded here too.
          </p>
        )}
      </Card>

      {/* The consequence of switching reminders off, stated plainly. Missing a
          deadline means a zero for that gameweek, which is worth knowing before
          you opt out rather than after. */}
      {!deviceOn && deviceCount === 0 && capability?.supported && (
        <Card className="p-4 mb-4" style={{ background:'var(--amber-dim)', borderColor:'rgba(245,166,35,0.3)' }}>
          <p className="text-xs font-medium mb-1" style={{ color:'var(--amber)' }}>Reminders are off</p>
          <p className="text-xs" style={{ color:'var(--amber)' }}>
            You won't be told when a gameweek opens or when a deadline is close. Each fixture locks at
            its own kickoff, and any you haven't predicted by then scores nothing — so you'll need to
            keep an eye on deadlines yourself.
          </p>
        </Card>
      )}

      {needsIosInstall && (
        <Card className="p-4 mb-4" style={{ background:'var(--accent-dim)', borderColor:'rgba(79,142,247,0.35)' }}>
          <p className="text-xs font-medium mb-1" style={{ color:'var(--accent)' }}>Add to Home Screen first</p>
          <p className="text-xs" style={{ color:'var(--txt-second)' }}>
            iPhone and iPad only allow notifications for web apps installed on the Home Screen.
            Tap the Share button in Safari, choose <strong>Add to Home Screen</strong>, then open ALOTO
            from the new icon and come back here.
          </p>
        </Card>
      )}

      {unsupported && (
        <Card className="p-4 mb-4">
          <p className="text-xs" style={{ color:'var(--txt-muted)' }}>
            This browser can't receive push notifications. Try Chrome on Android or desktop, or
            {isIOS() ? ' Safari with ALOTO added to your Home Screen.' : ' Safari on an up-to-date iPhone.'}
          </p>
        </Card>
      )}


    </div>
  )
}
