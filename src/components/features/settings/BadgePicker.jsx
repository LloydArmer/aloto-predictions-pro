import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Card, Button } from '../../ui'
import Shirt, { PATTERNS, KIT_COLOURS, kitSpec, parseKit } from '../../ui/Shirt'
import toast from 'react-hot-toast'

/**
 * Pick a kit — a pattern and two colours.
 *
 * Built for the Dynamic Island, whose compact states are roughly 50 pixels a
 * side. A name doesn't fit there, not even abbreviated, but a shirt and a score
 * do. It reads well in cup brackets and standings too, where the name column is
 * already the tightest thing on screen.
 *
 * A drawn shirt rather than an emoji because emoji offers one plain 👕 with no
 * way to colour it — twelve players would all have the same badge.
 *
 * Optional throughout: initials remain the fallback, so nobody has to choose a
 * kit before they can use the app.
 */

const PATTERN_LABELS = {
  plain: 'Plain', stripes: 'Stripes', hoops: 'Hoops',
  halves: 'Halves', quarters: 'Quarters', sash: 'Sash',
}

export default function BadgePicker() {
  const { user, profile, fetchProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const current = parseKit(profile?.badge_kit)
  const [pattern, setPattern] = useState(current?.pattern ?? 'plain')
  const [primary, setPrimary] = useState(current?.primary ?? '#e63946')
  const [secondary, setSecondary] = useState(current?.secondary ?? '#ffffff')

  useEffect(() => {
    const k = parseKit(profile?.badge_kit)
    if (k) { setPattern(k.pattern); setPrimary(k.primary); setSecondary(k.secondary) }
  }, [profile?.badge_kit])

  const preview = kitSpec(pattern, primary, secondary)
  const needsSecondary = pattern !== 'plain'

  const initials = profile?.display_name
    ? profile.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  async function save(spec) {
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles')
        .update({ badge_kit: spec }).eq('id', user.id)
      if (error) throw error

      await fetchProfile(user.id)
      toast.success(spec ? 'Kit saved' : 'Back to your initials')
      setOpen(false)
    } catch {
      toast.error('Could not save your kit')
    } finally { setSaving(false) }
  }

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between gap-3">
        <div style={{ minWidth: 0 }}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--txt-muted)' }}>Your kit</p>
          <p className="text-xs" style={{ color: 'var(--txt-second)', lineHeight: 1.5 }}>
            Shown where your name won't fit — cup brackets, and the live score on your lock screen.
          </p>
        </div>

        {/* The kit doubles as the button. Nothing explains it better than
            showing it. */}
        <button onClick={() => setOpen(o => !o)}
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 50, height: 50, borderRadius: 12,
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border-med)',
            fontSize: 15, color: 'var(--txt-primary)',
          }}>
          {profile?.badge_kit ? <Shirt spec={profile.badge_kit} size={34}/> : initials}
        </button>
      </div>

      {open && (
        <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>

          {/* Live preview, large. The whole point is how it looks, so it is
              shown at a size you can actually judge rather than as a swatch. */}
          <div className="flex justify-center mb-3">
            <Shirt spec={preview} size={72}/>
          </div>

          <p className="text-xs mb-1.5" style={{ color: 'var(--txt-muted)' }}>Pattern</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PATTERNS.map(p => (
              <button key={p} onClick={() => setPattern(p)}
                className="text-xs px-2.5 py-1.5 rounded-lg"
                style={{
                  background: pattern === p ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                  color: pattern === p ? 'var(--accent)' : 'var(--txt-second)',
                  border: `1px solid ${pattern === p ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                {PATTERN_LABELS[p]}
              </button>
            ))}
          </div>

          <p className="text-xs mb-1.5" style={{ color: 'var(--txt-muted)' }}>Main colour</p>
          <ColourRow value={primary} onChange={setPrimary}/>

          {needsSecondary && (
            <>
              <p className="text-xs mb-1.5 mt-3" style={{ color: 'var(--txt-muted)' }}>Second colour</p>
              <ColourRow value={secondary} onChange={setSecondary}/>
            </>
          )}

          <div className="flex gap-2 mt-4">
            <Button variant="primary" className="btn-sm" onClick={() => save(preview)} disabled={saving}>
              {saving ? 'Saving…' : 'Save kit'}
            </Button>
            {profile?.badge_kit && (
              <Button className="btn-sm" onClick={() => save(null)} disabled={saving}>
                Use my initials
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
            // A ring rather than a border, so selecting doesn't shift the
            // swatch or change its apparent size.
            boxShadow: value === c.hex ? '0 0 0 2px var(--bg-surface), 0 0 0 4px var(--accent)' : 'none',
            border: '0.5px solid rgba(255,255,255,0.15)',
          }}/>
      ))}
    </div>
  )
}
