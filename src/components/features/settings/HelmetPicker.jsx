import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Card, Button } from '../../ui'
import { KIT_COLOURS } from '../../ui/Shirt'
import Helmet, { DEFAULT_HELMET, parseHelmet, helmetSpec } from '../../ui/Helmet'
import toast from 'react-hot-toast'

/**
 * Pick helmet colours for NFL and F1. Shown in Settings in place of the kit
 * picker when the NFL or F1 section is chosen; football keeps BadgePicker.
 *
 * One set of colours for both sports: the preview shows both helmets so the
 * player can see each.
 */
export default function HelmetPicker({ sport = 'nfl' }) {
  const { user, profile, fetchProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const current = parseHelmet(profile?.helmet) ?? DEFAULT_HELMET
  const [shell, setShell]   = useState(current.shell)
  const [stripe, setStripe] = useState(current.stripe)

  useEffect(() => {
    const h = parseHelmet(profile?.helmet)
    if (h) { setShell(h.shell); setStripe(h.stripe) }
  }, [profile?.helmet])

  const preview = helmetSpec(shell, stripe)
  const name = profile?.display_name ?? ''

  async function save(spec) {
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles')
        .update({ helmet: spec }).eq('id', user.id)
      if (error) throw error
      await fetchProfile(user.id)
      toast.success(spec ? 'Helmet saved' : 'Back to the standard helmet')
      setOpen(false)
    } catch {
      toast.error('Could not save your helmet')
    } finally { setSaving(false) }
  }

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between gap-3">
        <div style={{ minWidth: 0 }}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--txt-muted)' }}>Your helmet</p>
          <p className="text-xs" style={{ color: 'var(--txt-second)', lineHeight: 1.5 }}>
            Your colours and initials, shown on the live score on your lock screen.
          </p>
        </div>
        <button onClick={() => setOpen(o => !o)}
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 54, height: 54, borderRadius: 12,
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border-med)',
          }}>
          <Helmet sport={sport} spec={profile?.helmet} name={name} size={42}/>
        </button>
      </div>

      {open && (
        <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          <div className="flex justify-center gap-4 mb-3">
            <Helmet sport="nfl" spec={preview} name={name} size={78}/>
            <Helmet sport="f1" spec={preview} name={name} size={78}/>
          </div>

          <p className="text-xs mb-1.5" style={{ color: 'var(--txt-muted)' }}>Helmet</p>
          <ColourRow value={shell} onChange={setShell}/>

          <p className="text-xs mb-1.5 mt-3" style={{ color: 'var(--txt-muted)' }}>Stripe and initials</p>
          <ColourRow value={stripe} onChange={setStripe}/>

          <div className="flex gap-2 mt-4">
            <Button variant="primary" className="btn-sm" onClick={() => save(preview)} disabled={saving}>
              {saving ? 'Saving…' : 'Save helmet'}
            </Button>
            {profile?.helmet && (
              <Button className="btn-sm" onClick={() => save(null)} disabled={saving}>
                Standard colours
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

function ColourRow({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {KIT_COLOURS.map(c => (
        <button key={c.hex} onClick={() => onChange(c.hex)} title={c.name}
          style={{
            width: 32, height: 32, borderRadius: 8, background: c.hex,
            boxShadow: value === c.hex ? '0 0 0 2px var(--bg-surface), 0 0 0 4px var(--accent)' : 'none',
            border: '0.5px solid var(--border-med)',
          }}/>
      ))}
    </div>
  )
}
