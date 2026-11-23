/**
 * NFL and F1 helmets in a player's own colours, with their initials on the
 * side. Football uses Shirt.jsx instead; nothing here touches it.
 *
 * Spec, stored in profiles.helmet: '<shell>:<stripe>', e.g. '#6a4c93:#f4a72c'.
 * The same colours are used for both sports.
 *
 * The drawing matches HelmetView in ios/App/ALOTOWidget/KitShape.swift
 * (same 100-unit grid), so a helmet looks the same in the app and on the lock
 * screen.
 */

export const DEFAULT_HELMET = { shell: '#6a4c93', stripe: '#f5f5f5' }

export function parseHelmet(spec) {
  if (!spec) return null
  const [shell, stripe] = String(spec).split(':')
  const hex = /^#[0-9a-fA-F]{6}$/
  if (!hex.test(shell ?? '')) return null
  return { shell, stripe: hex.test(stripe ?? '') ? stripe : '#f5f5f5' }
}

export const helmetSpec = (shell, stripe) => `${shell}:${stripe}`

/** Up to two letters: "Brittany Ann" -> "BA", "Lloyd" -> "LL". */
export function helmetInitials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function isDark(hex) {
  const v = parseInt(hex.slice(1), 16)
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) < 70
}

/** Text colour for the initials: the stripe, unless it matches the shell. */
function markColour(h) {
  if (h.stripe.toLowerCase() !== h.shell.toLowerCase()) return h.stripe
  return isDark(h.shell) ? '#ffffff' : '#111111'
}

export default function Helmet({ sport = 'nfl', spec, name, size = 32, title }) {
  const h = parseHelmet(spec) ?? DEFAULT_HELMET
  const initials = helmetInitials(name)
  const mark = markColour(h)
  // A dark helmet vanishes on a dark screen, so it gets a light edge.
  const rim = isDark(h.shell) ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.25)'

  if (sport === 'f1') {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title ?? `${initials} helmet`}>
        <path d="M10 56 C8 30 28 10 56 10 C80 10 94 30 94 50 C94 62 90 72 84 78 L80 84 C66 91 40 91 24 85 C16 78 11 68 10 56 Z"
          fill={h.shell} stroke={rim} strokeWidth="2"/>
        <path d="M18 70 C34 63 50 72 68 66" stroke={h.stripe} strokeWidth="4" fill="none" strokeLinecap="round"/>
        <path d="M44 38 L88 36 C90 42 90 49 89 55 L50 57 C46 57 44 54 44 51 Z" fill="#1a1a22"/>
        <path d="M48 41 L86 39" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" strokeLinecap="round"/>
        <text x="27" y="56" textAnchor="middle" fontFamily="-apple-system, Helvetica, Arial, sans-serif"
          fontWeight="900" fontSize="18" fill={mark}>{initials}</text>
      </svg>
    )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title ?? `${initials} helmet`}>
      <path d="M12 58 C8 32 28 10 54 10 C74 10 86 24 88 42 L74 47 L66 74 C58 82 44 84 32 80 C20 76 14 68 12 58 Z"
        fill={h.shell} stroke={rim} strokeWidth="2"/>
      <path d="M28 28 C38 19 54 16 66 21" stroke={h.stripe} strokeWidth="4" fill="none" strokeLinecap="round"/>
      <text x="42" y="61" textAnchor="middle" fontFamily="-apple-system, Helvetica, Arial, sans-serif"
        fontWeight="900" fontSize="22" fill={mark}>{initials}</text>
      <g fill="none" stroke="#9aa0a8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M70 50 L91 47 C95 58 94 72 88 81 L64 83"/>
        <path d="M71 65 L93 63"/>
        <path d="M80 49 L78 82"/>
      </g>
    </svg>
  )
}
