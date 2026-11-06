// NFL season questions (Lloyd, 6 Nov 2026). A set of their own: none of
// football's carry over. "Write your own" in Admin is the only shared part.
//
// Each question lists the teams its dropdown offers. options: null means a
// typed answer, matched to the right one with fuzzy matching and confirmed by
// the admin, the same as football's typed questions.
import { NFL_TEAMS } from './teams'

// The eight divisions, in the order Lloyd listed them.
export const NFL_DIVISIONS = [
  { name: 'AFC West',  teams: ['DEN', 'KC', 'LV', 'LAC'] },
  { name: 'AFC East',  teams: ['BUF', 'MIA', 'NE', 'NYJ'] },
  { name: 'AFC North', teams: ['BAL', 'CIN', 'CLE', 'PIT'] },
  { name: 'AFC South', teams: ['HOU', 'IND', 'JAX', 'TEN'] },
  { name: 'NFC West',  teams: ['ARI', 'LAR', 'SF', 'SEA'] },
  { name: 'NFC East',  teams: ['DAL', 'NYG', 'PHI', 'WAS'] },
  { name: 'NFC North', teams: ['CHI', 'DET', 'GB', 'MIN'] },
  { name: 'NFC South', teams: ['ATL', 'CAR', 'NO', 'TB'] },
]

const nameOf = abbr => NFL_TEAMS.find(t => t.abbr === abbr).name
const allTeams = () => NFL_TEAMS.map(t => t.name).sort()

export const NFL_SEASON_QUESTIONS = [
  { label: 'Super Bowl Winner', options: allTeams() },
  { label: 'NFL MVP', options: null },
  ...NFL_DIVISIONS.map(d => ({ label: `${d.name} Winner`, options: d.teams.map(nameOf).sort() })),
]
