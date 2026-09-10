import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Card, Button } from '../../ui'
import toast from 'react-hot-toast'

/**
 * A single emoji to represent the player where a name won't fit.
 *
 * Built for the Dynamic Island, whose compact states are roughly 50 pixels a
 * side — a name doesn't fit there, not even abbreviated, but an emoji and a
 * score do. It also reads well in cup brackets and standings, where the name
 * column is already the tightest thing on the screen.
 *
 * Optional throughout. Initials are the fallback, so nobody is made to choose
 * one before they can use the app.
 */

// Grouped so the list can be scanned rather than read. Football first, because
// that is what most people will reach for.
const BADGES = [
  { group: 'Football', emoji: ['⚽', '🥅', '🧤', '🏆', '🥇', '📣', '🎽', '👟'] },
  { group: 'Animals',  emoji: ['🦁', '🐺', '🦅', '🐉', '🦈', '🐂', '🐴', '🦊', '🐝', '🦉'] },
  { group: 'Symbols',  emoji: ['⚡', '🔥', '💎', '⭐', '🌟', '💥', '🎯', '🚀', '👑', '🛡️'] },
  { group: 'Faces',    emoji: ['😎', '🤠', '👻', '🤖', '👽', '🥷', '🦸', '🧙'] },
]

export default function BadgePicker() {
  const { user, profile, fetchProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setSelected(profile?.badge_emoji ?? null) }, [profile?.badge_emoji])

  const initials = profile?.display_name
    ? profile.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  async function save(emoji) {
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles')
        .update({ badge_emoji: emoji })
        .eq('id', user.id)

      if (error) throw error

      setSelected(emoji)
      await fetchProfile(user.id)
      toast.success(emoji ? 'Badge saved' : 'Back to your initials')
      setOpen(false)
    } catch {
      toast.error('Could not save your badge')
    } finally { setSaving(false) }
  }

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between gap-3">
        <div style={{ minWidth: 0 }}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--txt-muted)' }}>Your badge</p>
          <p className="text-xs" style={{ color: 'var(--txt-second)', lineHeight: 1.5 }}>
            Shown where your name is too long to fit — cup brackets, and the live score on your
            lock screen.
          </p>
        </div>

        {/* The badge itself doubles as the button. Nothing explains what it
            does better than showing it. */}
        <button onClick={() => setOpen(o => !o)}
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 46, height: 46, borderRadius: 12,
            background: 'var(--bg-elevated)',
            border: '0.5px solid var(--border-med)',
            fontSize: selected ? 24 : 15,
            color: 'var(--txt-primary)',
          }}>
          {selected || initials}
        </button>
      </div>

      {open && (
        <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          {BADGES.map(({ group, emoji }) => (
            <div key={group} className="mb-2.5">
              <p className="text-xs mb-1.5" style={{ color: 'var(--txt-muted)' }}>{group}</p>
              <div className="flex flex-wrap gap-1.5">
                {emoji.map(e => (
                  <button key={e} onClick={() => save(e)} disabled={saving}
                    className="flex items-center justify-center"
                    style={{
                      width: 40, height: 40, borderRadius: 10, fontSize: 21,
                      background: selected === e ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      border: `1px solid ${selected === e ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {selected && (
            <Button className="btn-sm mt-1" onClick={() => save(null)} disabled={saving}>
              Use my initials instead
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
