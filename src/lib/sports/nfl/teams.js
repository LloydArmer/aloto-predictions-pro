/**
 * The 32 NFL teams: short name and colours, for the team badges.
 *
 * Colours only — no logos. The logos are NFL trademarks and would need a
 * licence for an App Store app; a badge in the team's colours with its short
 * name reads just as quickly to anyone who follows the sport.
 *
 * Matched on the team's nickname, so "Philadelphia Eagles", "Eagles" and
 * "PHI" all find the same team whatever the feed or the admin typed.
 */
export const NFL_TEAMS = [
  { abbr: 'ARI', name: 'Arizona Cardinals',     nick: 'cardinals',  primary: '#97233F', secondary: '#FFB612' },
  { abbr: 'ATL', name: 'Atlanta Falcons',       nick: 'falcons',    primary: '#A71930', secondary: '#000000' },
  { abbr: 'BAL', name: 'Baltimore Ravens',      nick: 'ravens',     primary: '#241773', secondary: '#9E7C0C' },
  { abbr: 'BUF', name: 'Buffalo Bills',         nick: 'bills',      primary: '#00338D', secondary: '#C60C30' },
  { abbr: 'CAR', name: 'Carolina Panthers',     nick: 'panthers',   primary: '#0085CA', secondary: '#101820' },
  { abbr: 'CHI', name: 'Chicago Bears',         nick: 'bears',      primary: '#0B162A', secondary: '#C83803' },
  { abbr: 'CIN', name: 'Cincinnati Bengals',    nick: 'bengals',    primary: '#FB4F14', secondary: '#000000' },
  { abbr: 'CLE', name: 'Cleveland Browns',      nick: 'browns',     primary: '#311D00', secondary: '#FF3C00' },
  { abbr: 'DAL', name: 'Dallas Cowboys',        nick: 'cowboys',    primary: '#003594', secondary: '#869397' },
  { abbr: 'DEN', name: 'Denver Broncos',        nick: 'broncos',    primary: '#FB4F14', secondary: '#002244' },
  { abbr: 'DET', name: 'Detroit Lions',         nick: 'lions',      primary: '#0076B6', secondary: '#B0B7BC' },
  { abbr: 'GB',  name: 'Green Bay Packers',     nick: 'packers',    primary: '#203731', secondary: '#FFB612' },
  { abbr: 'HOU', name: 'Houston Texans',        nick: 'texans',     primary: '#03202F', secondary: '#A71930' },
  { abbr: 'IND', name: 'Indianapolis Colts',    nick: 'colts',      primary: '#002C5F', secondary: '#A2AAAD' },
  { abbr: 'JAX', name: 'Jacksonville Jaguars',  nick: 'jaguars',    primary: '#006778', secondary: '#D7A22A' },
  { abbr: 'KC',  name: 'Kansas City Chiefs',    nick: 'chiefs',     primary: '#E31837', secondary: '#FFB81C' },
  { abbr: 'LV',  name: 'Las Vegas Raiders',     nick: 'raiders',    primary: '#000000', secondary: '#A5ACAF' },
  { abbr: 'LAC', name: 'Los Angeles Chargers',  nick: 'chargers',   primary: '#0080C6', secondary: '#FFC20E' },
  { abbr: 'LAR', name: 'Los Angeles Rams',      nick: 'rams',       primary: '#003594', secondary: '#FFA300' },
  { abbr: 'MIA', name: 'Miami Dolphins',        nick: 'dolphins',   primary: '#008E97', secondary: '#FC4C02' },
  { abbr: 'MIN', name: 'Minnesota Vikings',     nick: 'vikings',    primary: '#4F2683', secondary: '#FFC62F' },
  { abbr: 'NE',  name: 'New England Patriots',  nick: 'patriots',   primary: '#002244', secondary: '#C60C30' },
  { abbr: 'NO',  name: 'New Orleans Saints',    nick: 'saints',     primary: '#101820', secondary: '#D3BC8D' },
  { abbr: 'NYG', name: 'New York Giants',       nick: 'giants',     primary: '#0B2265', secondary: '#A71930' },
  { abbr: 'NYJ', name: 'New York Jets',         nick: 'jets',       primary: '#125740', secondary: '#FFFFFF' },
  { abbr: 'PHI', name: 'Philadelphia Eagles',   nick: 'eagles',     primary: '#004C54', secondary: '#A5ACAF' },
  { abbr: 'PIT', name: 'Pittsburgh Steelers',   nick: 'steelers',   primary: '#101820', secondary: '#FFB612' },
  { abbr: 'SF',  name: 'San Francisco 49ers',   nick: '49ers',      primary: '#AA0000', secondary: '#B3995D' },
  { abbr: 'SEA', name: 'Seattle Seahawks',      nick: 'seahawks',   primary: '#002244', secondary: '#69BE28' },
  { abbr: 'TB',  name: 'Tampa Bay Buccaneers',  nick: 'buccaneers', primary: '#D50A0A', secondary: '#34302B' },
  { abbr: 'TEN', name: 'Tennessee Titans',      nick: 'titans',     primary: '#0C2340', secondary: '#4B92DB' },
  { abbr: 'WAS', name: 'Washington Commanders', nick: 'commanders', primary: '#5A1414', secondary: '#FFB612' },
]

/**
 * The team for a name as it appears on a fixture. Anything unrecognised
 * still gets a badge: its initials on a neutral colour.
 */
export function nflTeam(teamName) {
  const n = (teamName || '').trim().toLowerCase()
  const found = NFL_TEAMS.find(t =>
    n === t.abbr.toLowerCase() || n === t.name.toLowerCase() || n.split(/\s+/).includes(t.nick))
  if (found) return found
  const initials = (teamName || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase()
  return { abbr: initials || '?', name: teamName, nick: '', primary: '#3A3F4B', secondary: '#8A90A0' }
}
