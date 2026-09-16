/**
 * A football kit, drawn from a short spec string.
 *
 * Emoji can't do this — there is one plain 👕 and no way to colour it — so the
 * kit is drawn instead. The same spec is rendered as SVG here and as SwiftUI
 * shapes in the Live Activity widget, so a player's kit looks the same on the
 * lock screen as it does in the app.
 *
 * Spec format:  pattern:primary:secondary:sleeve:shorts
 *
 *   plain:#e63946                                  shirt only
 *   stripes:#e63946:#ffffff                        + pattern
 *   stripes:#e63946:#ffffff:#1a1a1a                + sleeves
 *   stripes:#e63946:#ffffff:#1a1a1a:#1a1a1a        + shorts
 *
 * The last two are optional, so every kit saved before they existed still
 * parses and still draws — sleeves simply match the shirt and shorts are
 * omitted.
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

/**
 * Below this, shorts are left off.
 *
 * At twenty pixels the shorts are about three pixels tall, and including them
 * means shrinking the shirt to make room — so a standings row would get a
 * smaller shirt AND an unreadable smudge beneath it. The tables and the Dynamic
 * Island get the shirt alone; everywhere with room gets the full kit.
 */
const SHORTS_MIN_SIZE = 26

export function parseKit(spec) {
  if (!spec) return null
  const parts = String(spec).split(':')
  const [pattern, primary, secondary, sleeve, shorts] = parts

  if (!PATTERNS.includes(pattern) || !primary) return null

  return {
    pattern,
    primary,
    secondary: secondary || '#ffffff',
    // Sleeves default to the shirt colour, which is the same as having none.
    sleeve: sleeve || null,
    shorts: shorts || null,
  }
}

export function kitSpec(pattern, primary, secondary, sleeve, shorts) {
  // Every segment must hold a colour. An earlier version left gaps — picking
  // shorts while leaving sleeves as "match shirt" produced
  // "stripes:#e63946:#ffffff::#1a1a1a", with an empty segment in the middle,
  // which the database rejected outright.
  //
  // A gap is filled with the colour that means "same as the shirt", which is
  // exactly what the empty value meant anyway. The drawing code already treats
  // a sleeve matching the shirt as no sleeve at all, so nothing looks different.
  const parts = [pattern, primary]

  // Only include what is actually needed, in order, and never skip one.
  if (shorts) {
    parts.push(pattern === 'plain' ? primary : secondary)
    parts.push(sleeve || primary)
    parts.push(shorts)
  } else if (sleeve) {
    parts.push(pattern === 'plain' ? primary : secondary)
    parts.push(sleeve)
  } else if (pattern !== 'plain') {
    parts.push(secondary)
  }

  return parts.join(':')
}

/* ---- The shapes, all on the same 48-wide grid ---- */

// Two hems. On its own the shirt hangs full length; with shorts beneath it is
// cut shorter, because a full-length shirt over shorts reads as a nightie and
// leaves the shorts a sliver at the bottom.
const BODY =
  'M22 8 L32 4 Q40 10 40 10 L46 16 L40 24 L36 21 L36 44 Q32 46 24 46 Q16 46 12 44 L12 21 L8 24 L2 16 L8 10 Q8 10 16 4 L26 8 Z'

const BODY_WITH_SHORTS =
  'M22 8 L32 4 Q40 10 40 10 L46 16 L40 24 L36 21 L36 36 Q32 38 24 38 Q16 38 12 36 L12 21 L8 24 L2 16 L8 10 Q8 10 16 4 L26 8 Z'

// The two wings either side of the torso. Drawn over the body and its pattern,
// so a striped shirt can still have plain sleeves.
const LEFT_SLEEVE  = 'M12 21 L8 24 L2 16 L8 10 Q8 10 16 4 L22 8 L12 12 Z'
const RIGHT_SLEEVE = 'M36 21 L40 24 L46 16 L40 10 Q40 10 32 4 L26 8 L36 12 Z'

// Sat below the shirt, with the notch between the legs. Wider and deeper than
// the first attempt, which was small enough to look like an afterthought.
const SHORTS = 'M12 0 L36 0 L37 19 L26 19 L24 8 L22 19 L11 19 Z'

/** A player's kit, or an empty outline when they haven't chosen one. */
export default function Shirt({ spec, size = 32, title }) {
  const kit = parseKit(spec)
  const withShorts = !!kit?.shorts && size >= SHORTS_MIN_SIZE

  // Taller viewBox when shorts are included, and a matching height, so the kit
  // keeps its proportions instead of being squashed into a square.
  const viewBox = withShorts ? '0 -2 48 64' : '0 0 48 48'
  const height = withShorts ? Math.round(size * 64 / 48) : size

  // The shorter hem only when there are shorts to sit beneath it.
  const body = withShorts ? BODY_WITH_SHORTS : BODY

  if (!kit) {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" role="img"
        aria-label={title || 'No kit chosen'}>
        <path d={BODY} fill="var(--bg-elevated)" stroke="var(--border-med)" strokeWidth="1.5"/>
      </svg>
    )
  }

  const { pattern, primary, secondary, sleeve, shorts } = kit
  // The hem is part of the id: without it, the same kit drawn once with shorts
  // and once without would share a clip path, and whichever rendered second
  // would be clipped to the wrong shape.
  const clipId = `kit-${pattern}-${primary}-${secondary}-${withShorts ? 's' : 'l'}`
    .replace(/[^a-zA-Z0-9-]/g, '')

  return (
    <svg width={size} height={height} viewBox={viewBox} role="img"
      aria-label={title || `${pattern} kit`}>
      <defs>
        <clipPath id={clipId}><path d={body}/></clipPath>
      </defs>

      {/* Base colour under everything. */}
      <path d={body} fill={primary}/>

      <g clipPath={`url(#${clipId})`}>
        {/* Four stripes, not three. Three left one side visibly wider than the
            other and read as a mistake rather than a kit. */}
        {pattern === 'stripes' && [0, 1, 2, 3].map(i => (
          <rect key={i} x={8 + i * 9} y="0" width="5" height="48" fill={secondary}/>
        ))}

        {/* Starting at 16 rather than 10 keeps the top hoop below the collar. */}
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

        {/* A thick rotated bar rather than a diagonal path: it stays an even
            width across the shirt, which a stroked line does not. */}
        {pattern === 'sash' && (
          <rect x="-10" y="18" width="70" height="10" fill={secondary}
            transform="rotate(-35 24 24)"/>
        )}
      </g>

      {/* Sleeves last, over the pattern — a striped shirt with plain sleeves is
          a common kit and the stripes must not run through them. */}
      {sleeve && sleeve !== primary && (
        <>
          <path d={LEFT_SLEEVE} fill={sleeve}/>
          <path d={RIGHT_SLEEVE} fill={sleeve}/>
        </>
      )}

      {/* Outline over everything, so nothing bleeds past the edge. */}
      <path d={body} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="1.5"/>

      {withShorts && (
        <g transform="translate(0,41)">
          <path d={SHORTS} fill={shorts}/>
          <path d={SHORTS} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="1.5"/>
        </g>
      )}
    </svg>
  )
}

/**
 * A player's short mark, for when there is no kit.
 *
 * Never a single letter. "J" could be Joe, Jess or Jamie, and in a cup tie or
 * on a lock screen the whole point is knowing who you are up against.
 *
 *   "Lloyd Armer"  -> LA
 *   "Joe"          -> JOE
 *   "Mickefc2103"  -> MIC
 */
export function playerMark(displayName) {
  if (!displayName) return '?'
  const words = String(displayName).trim().split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.slice(0, 3).map(w => w[0]).join('').toUpperCase()
}

/** A kit if the player has chosen one, their mark if not. */
export function PlayerMark({ kit, displayName, size = 28 }) {
  if (kit) return <Shirt spec={kit} size={size} title={displayName}/>

  return (
    <span
      className="flex items-center justify-center flex-shrink-0"
      title={displayName}
      style={{
        width: size, height: size, borderRadius: size * 0.28,
        background: 'var(--bg-elevated)',
        border: '0.5px solid var(--border-med)',
        color: 'var(--txt-second)',
        // Scaled to the box so a three-letter mark still fits at 20px.
        fontSize: Math.round(size * 0.34),
        fontWeight: 600,
        letterSpacing: '-0.02em',
      }}>
      {playerMark(displayName)}
    </span>
  )
}
