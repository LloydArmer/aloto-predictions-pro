/**
 * Competition format icons.
 *
 * These replace the emoji (📊 / 🏆) that previously marked each competition.
 * Emoji were the wrong tool here: they render differently on iOS, Android and
 * desktop, sit on inconsistent baselines so rows never quite line up, and their
 * full-colour weight fights the hairline-and-accent language of everything
 * around them.
 *
 * Each glyph draws the actual STRUCTURE of its format rather than a generic
 * award symbol, so the three are distinguishable at a glance and at 16px:
 *
 *   league          ranked rows — everyone plays everyone, ordered by points
 *   knockout        a bracket — pairs converging on a single winner
 *   group_knockout  a group grid feeding a bracket arm — both stages, in order
 *
 * Drawn on a 24-unit grid with the same 1.75 stroke weight and rounded joins as
 * the Tabler icons used elsewhere, and inheriting colour from the chip so a
 * format reads by hue before the shape is even resolved.
 */

const FORMAT_STYLE = {
  league:         { color: 'var(--accent)', dim: 'var(--accent-dim)', ring: 'rgba(79,156,249,0.35)', label: 'League' },
  knockout:       { color: 'var(--gold)',   dim: 'var(--gold-dim)',   ring: 'rgba(245,200,66,0.35)', label: 'Knockout' },
  group_knockout: { color: '#c88bfa',       dim: 'rgba(200,139,250,0.14)', ring: 'rgba(200,139,250,0.35)', label: 'Group + Knockout' },
}

function LeagueGlyph() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      {/* Ranked rows, descending in length — a standings table read top-down.
          The leading pip is filled on the top row only: first place. */}
      <circle cx="5.25" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="5.25" cy="12" r="1.6" opacity="0.75" />
      <circle cx="5.25" cy="17" r="1.6" opacity="0.5" />
      <path d="M10 7h9" />
      <path d="M10 12h6.5" opacity="0.75" />
      <path d="M10 17h4" opacity="0.5" />
    </g>
  )
}

function KnockoutGlyph() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {/* Two pairs converging on one node. The filled circle is the winner —
          the only part of a cup that matters. */}
      <path d="M4 6.5h3.5V12H12" />
      <path d="M4 17.5h3.5V12" />
      <path d="M12 12h4" />
      <circle cx="18.5" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </g>
  )
}

function GroupKnockoutGlyph() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {/* A 2x2 group of teams advancing to a single winner.
          Filled dots rather than outlined squares: at 22px an outlined 4-unit
          rect collapses into a smudge, while a solid dot stays a solid dot.
          The double bracket fork went the same way — one arrow carries the
          "then knockout" meaning without the clutter. */}
      <circle cx="5" cy="7.5" r="2" fill="currentColor" stroke="none" />
      <circle cx="10.6" cy="7.5" r="2" fill="currentColor" stroke="none" opacity="0.55" />
      <circle cx="5" cy="16.5" r="2" fill="currentColor" stroke="none" opacity="0.55" />
      <circle cx="10.6" cy="16.5" r="2" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M14 12h3.6" />
      <path d="M16.1 10.2 18 12l-1.9 1.8" />
      <circle cx="20.8" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </g>
  )
}

const GLYPHS = {
  league: LeagueGlyph,
  knockout: KnockoutGlyph,
  group_knockout: GroupKnockoutGlyph,
}

/**
 * @param format  'league' | 'knockout' | 'group_knockout'
 * @param emoji   the competition's stored emoji. Only used when an admin has
 *                set something of their own — the old auto-assigned defaults
 *                are ignored so existing competitions pick up the new glyph
 *                without anyone having to edit them.
 * @param size    'sm' inline in lists and pills, 'md' for headers
 */
export default function CompetitionIcon({ format = 'league', emoji, size = 'sm', className = '' }) {
  const style = FORMAT_STYLE[format] || FORMAT_STYLE.league
  const Glyph = GLYPHS[format] || LeagueGlyph

  const box = size === 'md' ? 30 : 22
  const inner = size === 'md' ? 20 : 15

  const LEGACY_DEFAULTS = ['📊', '🏆', '⚽', '']
  const custom = emoji && !LEGACY_DEFAULTS.includes(emoji.trim()) ? emoji.trim() : null

  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
      title={style.label}
      style={{
        width: box, height: box,
        // Same chip language as the badges and avatars: dim wash, hairline ring,
        // squared-off radius. Gives every competition row a consistent anchor,
        // which mixed-width emoji never did.
        borderRadius: size === 'md' ? 9 : 7,
        background: style.dim,
        border: `0.5px solid ${style.ring}`,
        color: style.color,
        lineHeight: 1,
      }}
    >
      {custom
        ? <span style={{ fontSize: inner - 3 }}>{custom}</span>
        : <svg width={inner} height={inner} viewBox="0 0 24 24" aria-hidden="true"><Glyph/></svg>}
    </span>
  )
}

/** Plain-text marker for <option> elements, which cannot contain markup. */
export const FORMAT_MARK = { league: '▤', knockout: '◈', group_knockout: '⬗' }
