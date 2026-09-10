import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Card, Button } from '../../ui'
import Shirt, { playerMark } from '../../ui/Shirt'
import { useNavigate } from 'react-router-dom'

/**
 * Asks the player to pick a kit, once they have one to pick.
 *
 * Deliberately a prompt rather than a compulsory step. Initials work perfectly
 * well as a fallback — the widget and the bracket both draw them — so blocking
 * someone who has just entered a join code and wants to predict would cost more
 * than it gained.
 *
 * But it does need asking, because nobody finds this in Settings, and initials
 * genuinely collide: Matt Haworth and Mark Haworth are both MH, which in a cup
 * tie tells you nothing about who you are playing.
 *
 * Dismissing hides it for a week rather than for good. Someone who taps "not
 * now" during a busy moment should be asked again; someone who never wants one
 * is only interrupted six times a season.
 */

const SNOOZE_KEY = 'aloto_kit_prompt_snoozed_until'
const SNOOZE_DAYS = 7

export default function KitPrompt() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(true)   // assume hidden until checked, so it never flashes
  const [clash, setClash] = useState(null)

  useEffect(() => {
    if (profile?.badge_kit) { setDismissed(true); return }

    // sessionStorage rather than localStorage: artifacts and some in-app
    // browsers block localStorage entirely, and a prompt that throws is worse
    // than one that reappears.
    let until = null
    try { until = window.sessionStorage.getItem(SNOOZE_KEY) } catch { /* blocked */ }

    setDismissed(!!until && Number(until) > Date.now())
  }, [profile?.badge_kit])

  // Does anyone else in their competitions share their initials? If so, say so
  // — a concrete reason is far more persuasive than "personalise your profile".
  useEffect(() => {
    if (profile?.badge_kit || !profile?.id) return
    let cancelled = false

    ;(async () => {
      const { data: parts } = await supabase.from('participants')
        .select('competition_id').eq('user_id', profile.id)

      const compIds = (parts || []).map(p => p.competition_id)
      if (!compIds.length) return

      const { data: others } = await supabase.from('participants')
        .select('profiles(id, display_name, badge_kit)')
        .in('competition_id', compIds)

      if (cancelled) return

      const mine = playerMark(profile.display_name)
      const hit = (others || [])
        .map(o => o.profiles)
        .find(p => p && p.id !== profile.id && !p.badge_kit && playerMark(p.display_name) === mine)

      if (hit) setClash({ mark: mine, name: hit.display_name })
    })()

    return () => { cancelled = true }
  }, [profile?.id, profile?.badge_kit, profile?.display_name])

  function snooze() {
    try {
      window.sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400000))
    } catch { /* blocked — it will simply ask again next time */ }
    setDismissed(true)
  }

  if (profile?.badge_kit || dismissed) return null

  return (
    <Card className="p-4 mb-3" style={{ borderColor: 'rgba(79,156,249,0.35)', background: 'var(--accent-dim)' }}>
      <div className="flex items-start gap-3">
        {/* An example kit, so what is being offered is obvious before reading
            a word of it. */}
        <div className="flex-shrink-0" style={{ marginTop: 2 }}>
          <Shirt spec="stripes:#e63946:#ffffff" size={44}/>
        </div>

        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--accent)' }}>
            Pick your kit
          </p>

          <p className="text-xs mb-2.5" style={{ color: 'var(--txt-second)', lineHeight: 1.55 }}>
            {clash
              /* A specific, true reason beats a generic invitation. */
              ? `You and ${clash.name} both show as "${clash.mark}" — a kit tells everyone which of you is which in cup ties and tables.`
              : `You currently show as "${playerMark(profile?.display_name)}" in cup ties and tables. A kit is easier to spot at a glance.`}
          </p>

          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" className="btn-sm" onClick={() => navigate('/settings')}>
              Choose a kit
            </Button>
            <Button className="btn-sm" onClick={snooze}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
