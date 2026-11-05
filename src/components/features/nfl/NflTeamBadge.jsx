import { nflTeam } from '../../../lib/sports/nfl/teams'

/**
 * A team badge in the team's colours: a shield-shaped block in the primary
 * colour, edged in the secondary, carrying the short name. See teams.js for
 * why this is colours rather than logos.
 */
export default function NflTeamBadge({ team, size = 56 }) {
  const t = nflTeam(team)
  return (
    <div aria-hidden="true" style={{
      width: size, height: size * 1.12,
      background: t.primary,
      border: `3px solid ${t.secondary}`,
      borderRadius: `${size * 0.18}px ${size * 0.18}px ${size * 0.5}px ${size * 0.5}px`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    }}>
      <span style={{
        color: '#fff', fontWeight: 800, letterSpacing: '0.04em',
        fontSize: size * (t.abbr.length > 2 ? 0.3 : 0.36),
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
      }}>{t.abbr}</span>
    </div>
  )
}

export { nflTeam }
