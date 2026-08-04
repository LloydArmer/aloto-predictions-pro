import { format } from 'date-fns'

export function buildWeeklyMessage(gameweek, rankings, appUrl) {
  const medals = ['🥇','🥈','🥉']
  return [
    `🎯 *ALOTO Prediction Pro — GW${gameweek.number} Results*`,
    `📅 ${format(new Date(), 'dd MMM yyyy')}`,
    '',
    '📊 *This week\'s top scorers:*',
    ...rankings.slice(0,3).map((p,i) => `${medals[i]} ${p.display_name} — ${p.points} pts`),
    '',
    `📋 Full table: ${appUrl}/table`,
    '',
    '_ALOTO Prediction Pro_',
  ].join('\n')
}

export function buildMonthlyMessage(monthLabel, rankings, gwCount, appUrl) {
  const medals = ['🥇','🥈','🥉']
  return [
    `🎯 *ALOTO Prediction Pro — ${monthLabel} Standings*`,
    `📅 ${gwCount} gameweek${gwCount !== 1 ? 's' : ''} included`,
    '',
    '📊 *Monthly leaderboard:*',
    ...rankings.slice(0,3).map((p,i) => `${medals[i]} ${p.display_name} — ${p.total_points} pts`),
    '',
    `📋 Full standings: ${appUrl}/leaderboards`,
    '',
    '_ALOTO Prediction Pro_',
  ].join('\n')
}

export function buildReminderMessage(playerName, hoursUntil, fixtures, appUrl) {
  const timeLabel = hoursUntil <= 1 ? '⏰ *1 HOUR — submit now!*' : hoursUntil <= 6 ? '⚡ 6 hours' : '📅 24 hours'
  const lines = fixtures.map(f => {
    const time = new Date(f.kickoff_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    return `  • ${f.home_team} vs ${f.away_team} (${time})`
  }).join('\n')
  return [
    `🎯 *ALOTO Prediction Pro — Deadline reminder*`,
    '',
    `Hi ${playerName}! Your deadline is in ${timeLabel}.`,
    '',
    `Fixtures you haven't predicted yet:\n${lines}`,
    '',
    `Submit now 👇\n${appUrl}/predict`,
    '',
    '_ALOTO Prediction Pro_',
  ].join('\n')
}

export function openWhatsApp(message, to = '') {
  const url = to
    ? `https://wa.me/${to}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function copyToClipboard(text) {
  return navigator.clipboard.writeText(text)
}
