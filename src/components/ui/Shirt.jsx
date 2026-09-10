/**
 * A football shirt, drawn from a short spec string.
 *
 * Emoji can't do this — there is one plain 👕 and no way to colour it — so the
 * shirt is drawn instead. The same spec is rendered as SVG here and as SwiftUI
 * shapes in the Live Activity widget, so a player's shirt looks the same on the
 * lock screen as it does in the app.
 *
 * Spec format:  pattern:primary:secondary
 *   plain:#e63946
 *   stripes:#e63946:#ffffff
 *   hoops:#1d3557:#f1faee
 *
 * Kept as a string rather than three columns so it fits in one text field, is
 * legible in the database, and travels through the Live Activity payload
 * without needing a structure.
 */

export const PATTERNS = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'quarters']

export const KIT_COLOURS = [
  { name: 'Red',     hex: '#e63946' },
  { name: 'Blue',    hex: '#1d6fd0' },
  { name: 'Navy',    hex: '#1d3557' },
  { name: 'Sky',     hex: '#48b7e8' },
  { name: 'Green',   hex: '#2a9d4a' },
  { name: 'Claret',  hex: '#7b2038' },
  { name: 'Amber',   hex: '#f4a72c' },
  { name: 'Black',   hex: '#1a1a1a' },
  { name: 'White',   hex: '#f5f5f5' },
  { name: 'Purple',  hex: '#6a4c93' },
  { name: 'Pink',    hex: '#e86ba0' },
  { name: 'Teal',    hex: '#0f8b8d' },
]

export function parseKit(spec) {
  if (!spec) return null
  const [pattern, primary, secondary] = String(spec).split(':')
  if (!PATTERNS.includes(pattern) || !primary) return null
  return { pattern, primary, secondary: secondary || '#ffffff' }
}

export function kitSpec(pattern, primary, secondary) {
  return pattern === 'plain' ? `plain:${primary}` : `${pattern}:${primary}:${secondary}`
}

/**
 * The shirt outline. One path reused for every pattern, with the pattern drawn
 * inside it via a clip — so a striped shirt and a plain one are exactly the
 * same shape, which they would not be if each pattern drew its own.
 */
const SHIRT_PATH =
  'M22 8 L32 4 Q40 10 40 10 L46 16 L40 24 L36 21 L36 44 Q32 46 24 46 Q16 46 12 44 L12 21 L8 24 L2 16 L8 10 Q8 10 16 4 L26 8 Z'

export default function Shirt({ spec, size = 32, title }) {
  const kit = parseKit(spec)

  // No kit chosen: an empty outline rather than nothing, so the space doesn't
  // jump when someone picks one.
  if (!kit) {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title || 'No kit chosen'}>
        <path d={SHIRT_PATH} fill="var(--bg-elevated)" stroke="var(--border-med)" strokeWidth="1.5"/>
      </svg>
    )
  }

  const { pattern, primary, secondary } = kit
  const clipId = `kit-${pattern}-${primary}-${secondary}`.replace(/[^a-zA-Z0-9-]/g, '')

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img"
      aria-label={title || `${pattern} kit`}>
      <defs>
        <clipPath id={clipId}>
          <path d={SHIRT_PATH}/>
        </clipPath>
      </defs>

      {/* Base colour under every pattern. */}
      <path d={SHIRT_PATH} fill={primary}/>

      <g clipPath={`url(#${clipId})`}>
        {/* Four stripes, not three. Three left one side visibly wider than the
            other and read as a mistake rather than a kit. */}
        {pattern === 'stripes' && [0, 1, 2, 3].map(i => (
          <rect key={i} x={8 + i * 9} y="0" width="5" height="48" fill={secondary}/>
        ))}

        {/* Starting at 16 rather than 10 keeps the top hoop below the collar.
            Higher up it cut across the shoulders and looked like a fault. */}
        {pattern === 'hoops' && [0, 1, 2].map(i => (
          <rect key={i} x="0" y={16 + i * 10} width="48" height="5" fill={secondary}/>
        ))}

        {pattern === 'halves' && <rect x="24" y="0" width="24" height="48" fill={secondary}/>}

        {pattern === 'quarters' && (
          <>
            <rect x="24" y="0" width="24" height="24" fill={secondary}/>
            <rect x="0" y="24" width="24" height="24" fill={secondary}/>
          </>
        )}

        {/* Drawn as a thick rotated bar rather than a diagonal path: it stays
            an even width across the shirt, which a stroked line does not. */}
        {pattern === 'sash' && (
          <rect x="-10" y="18" width="70" height="10" fill={secondary}
            transform="rotate(-35 24 24)"/>
        )}
      </g>

      {/* Outline last, over the pattern, so stripes don't bleed past the edge. */}
      <path d={SHIRT_PATH} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="1.5"/>
    </svg>
  )
}
