import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Card, Input, Button } from '../../ui'
import { pushCapability, enablePush, disablePush, isIOS } from '../../../lib/push'
import toast from 'react-hot-toast'

export default function Settings() {
  const { user, profile, isAdmin, fetchProfile } = useAuth()
  const [phone, setPhone] = useState(profile?.phone_number||'')
  const [wa,    setWa]    = useState(profile?.notify_whatsapp ?? true)
  const [sms,   setSms]   = useState(profile?.notify_sms ?? false)
  const [saving, setSaving] = useState(false)

  // Push state. `capability` is what the DEVICE can do; `pushOn` is what the
  // participant has chosen. Both have to be true for reminders to arrive, and
  // they fail differently, so the UI reports them separately.
  const [capability, setCapability] = useState(null)
  const [pushOn, setPushOn] = useState(profile?.notify_push ?? true)
  const [pushBusy, setPushBusy] = useState(false)
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

  useEffect(() => {
    if (!user) return
    supabase.from('push_tokens').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      .then(({ count }) => setDeviceCount(count ?? 0))
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
        setDeviceCount(c => c + 1)
      } else {
        await disablePush(user.id)
        setDeviceCount(0)
      }

      const { error } = await supabase.from('profiles').update({ notify_push: next }).eq('id', user.id)
      if (error) throw error
      await fetchProfile(user.id)
      setPushOn(next)
      toast.success(next ? 'Reminders on for this device' : 'Reminders off')
    } catch {
      toast.error('Could not update reminder settings')
    } finally { setPushBusy(false) }
  }

  async function save() {
    if (phone && !phone.startsWith('+')) { toast.error('Use international format e.g. +447700900123'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles').update({ phone_number:phone, notify_whatsapp:wa, notify_sms:sms }).eq('id', user.id)
      if (error) throw error
      await fetchProfile(user.id)
      toast.success('Settings saved!')
    } catch { toast.error('Could not save settings') }
    finally { setSaving(false) }
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
      <h1 className="text-base font-medium mb-5" style={{ color:'var(--txt-primary)' }}>Notification settings</h1>

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
          <input
            type="checkbox"
            checked={pushOn}
            disabled={pushBusy || !capability?.supported}
            onChange={e => togglePush(e.target.checked)}
            style={{ width:16, height:16, cursor: capability?.supported ? 'pointer' : 'not-allowed', accentColor:'var(--accent)', flexShrink: 0 }}
          />
        </div>

        <p className="text-xs pt-2.5" style={{ color:'var(--txt-muted)' }}>
          The 24-hour and 1-hour reminders are only sent if you still have predictions outstanding.
          Finish them early and you won't hear from us.
        </p>

        {pushOn && capability?.supported && deviceCount > 0 && (
          <p className="text-xs mt-2" style={{ color:'var(--green)' }}>
            Reminders active on {deviceCount} device{deviceCount !== 1 ? 's' : ''}
          </p>
        )}
      </Card>

      {/* The consequence of switching reminders off, stated plainly. Missing a
          deadline means a zero for that gameweek, which is worth knowing before
          you opt out rather than after. */}
      {!pushOn && (
        <Card className="p-4 mb-4" style={{ background:'var(--amber-dim)', borderColor:'rgba(245,166,35,0.3)' }}>
          <p className="text-xs font-medium mb-1" style={{ color:'var(--amber)' }}>Reminders are off</p>
          <p className="text-xs" style={{ color:'var(--amber)' }}>
            You won't be told when a gameweek opens or when a deadline is close. Predictions lock at
            kickoff, and any fixture you haven't predicted by then scores nothing — so you'll need to
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

      <Card className="p-4 mb-4">
        <p className="text-xs font-medium mb-3" style={{ color:'var(--txt-muted)' }}>Phone number (optional)</p>
        <Input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+447700900123" type="tel"/>
        <p className="text-xs mt-1.5" style={{ color:'var(--txt-muted)' }}>Include country code — UK numbers start with +44</p>
      </Card>
      <Card className="p-4 mb-4">
        <p className="text-xs font-medium mb-3" style={{ color:'var(--txt-muted)' }}>Backup reminder channels</p>
        {[{label:'WhatsApp',sub:'Requires opt-in — see below',val:wa,set:setWa},{label:'SMS text message',sub:'Works on any phone, no app needed',val:sms,set:setSms}].map(s=>(
          <div key={s.label} className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor:'var(--border)' }}>
            <div><p className="text-sm font-medium" style={{ color:'var(--txt-primary)' }}>{s.label}</p><p className="text-xs" style={{ color:'var(--txt-muted)' }}>{s.sub}</p></div>
            <input type="checkbox" checked={s.val} onChange={e=>s.set(e.target.checked)} style={{ width:16,height:16,cursor:'pointer',accentColor:'var(--accent)' }}/>
          </div>
        ))}
      </Card>
      <Card className="p-4 mb-5" style={{ background:'var(--amber-dim)', borderColor:'rgba(245,166,35,0.3)' }}>
        <p className="text-xs font-medium mb-1" style={{ color:'var(--amber)' }}>WhatsApp opt-in required</p>
        <p className="text-xs" style={{ color:'var(--amber)' }}>To receive WhatsApp reminders, send <strong>join [your-code]</strong> to the ALOTO sandbox number from WhatsApp. Ask your league admin for the join code.</p>
      </Card>
      <Button variant="primary" onClick={save} disabled={saving} className="w-full justify-center">
        {saving ? 'Saving…' : 'Save notification settings'}
      </Button>
    </div>
  )
}
