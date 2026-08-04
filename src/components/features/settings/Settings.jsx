import { useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Card, Input, Button } from '../../ui'
import toast from 'react-hot-toast'

export default function Settings() {
  const { user, profile, fetchProfile } = useAuth()
  const [phone, setPhone] = useState(profile?.phone_number||'')
  const [wa,    setWa]    = useState(profile?.notify_whatsapp ?? true)
  const [sms,   setSms]   = useState(profile?.notify_sms ?? false)
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="max-w-sm">
      <h1 className="text-base font-medium mb-5" style={{ color:'var(--txt-primary)' }}>Notification settings</h1>
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
