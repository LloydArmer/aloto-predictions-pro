import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Card, Input, Button } from '../../ui'
import toast from 'react-hot-toast'

export default function Settings() {
  const { user, profile, isAdmin, fetchProfile } = useAuth()
  const [phone, setPhone] = useState(profile?.phone_number||'')
  const [wa,    setWa]    = useState(profile?.notify_whatsapp ?? true)
  const [sms,   setSms]   = useState(profile?.notify_sms ?? false)
  const [saving, setSaving] = useState(false)

  const [adminExists, setAdminExists] = useState(true) // assume true until checked, so the button never flashes on
  const [checkingAdmin, setCheckingAdmin] = useState(true)
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    if (isAdmin) { setCheckingAdmin(false); return }
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
      .then(({ count }) => setAdminExists((count ?? 0) > 0))
      .finally(() => setCheckingAdmin(false))
  }, [isAdmin])

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
        <p className="text-xs font-medium mb-3" style={{ color:'var(--txt-muted)' }}>Phone number</p>
        <Input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+447700900123" type="tel"/>
        <p className="text-xs mt-1.5" style={{ color:'var(--txt-muted)' }}>Include country code — UK numbers start with +44</p>
      </Card>
      <Card className="p-4 mb-4">
        <p className="text-xs font-medium mb-3" style={{ color:'var(--txt-muted)' }}>Reminder channel</p>
        {[{label:'WhatsApp',sub:'Recommended — rich message with fixtures',val:wa,set:setWa},{label:'SMS text message',sub:'Works on any phone, no WhatsApp needed',val:sms,set:setSms}].map(s=>(
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
