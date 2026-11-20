/**
 * Last Man Standing: reading a game and its gameweek. See migration 126 for
 * the rules; the database decides every outcome (lms_settle), so nothing here
 * changes anyone's status. These helpers only mirror the database's idea of a
 * gameweek's deadline so the screen can say when picks lock.
 *
 * A game runs on one league: any football league from API-Sports, or the NFL.
 * Each player can have several entries; each entry is its own life with its
 * own picks.
 */

import { nflTeam } from './sports/nfl/teams'

export const LMS_FORMAT = 'last_man_standing'
/** Its own entry in the sport menu (migration 128). */
export const LMS_SPORT = 'lms'

export const FINISHED = ['FT', 'AET', 'PEN', 'AWD', 'WO', 'AOT']
export const VOID = ['PST', 'CANC', 'ABD']
export const LIVE = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE', 'SUSP', 'Q1', 'Q2', 'Q3', 'Q4', 'OT']

export const NFL_LEAGUE = { id: 1, name: 'NFL' }
export const MAX_ENTRIES = 10

const DAY = 24 * 60 * 60 * 1000

export const isLms = c => c?.format === LMS_FORMAT

/** "GW12" for football, "Week 12" for the NFL. */
export const roundName = (game, round) => `${game?.sport === 'nfl' ? 'Week ' : 'GW'}${round}`

/** The deadline: first kick-off of the gameweek, postponed games left out. */
export function roundLock(fixtures) {
  const times = fixtures.filter(f => !VOID.includes(f.status)).map(f => +new Date(f.kickoff))
  return times.length ? new Date(Math.min(...times)) : null
}

/** The games that make up the gameweek: within 7 days of its deadline. */
export function roundFixtures(fixtures) {
  const lock = roundLock(fixtures)
  if (!lock) return []
  return fixtures
    .filter(f => +new Date(f.kickoff) < +lock + 7 * DAY)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || a.home_team.localeCompare(b.home_team))
}

/** Teams an entry cannot pick this gameweek (the list restarts once every team is used). */
export function usedTeams(entryPicks, round, teamCount = 20) {
  const n = Math.max(2, teamCount)
  const earlier = entryPicks.filter(p => p.round < round).sort((a, b) => a.round - b.round)
  const keepFrom = Math.floor(earlier.length / n) * n
  const used = new Map()
  earlier.slice(keepFrom).forEach(p => used.set(p.team_id, p.round))
  return used
}

/** What a pick looks like from the fixture right now (provisional until settled). */
export function pickState(pick, fixture) {
  if (pick?.outcome) return pick.outcome
  if (!fixture) return 'waiting'
  if (VOID.includes(fixture.status)) return 'void'
  const started = LIVE.includes(fixture.status) || FINISHED.includes(fixture.status)
  if (!started || fixture.home_goals == null) return 'waiting'
  const home = fixture.home_team_id === pick.team_id
  const mine = home ? fixture.home_goals : fixture.away_goals
  const theirs = home ? fixture.away_goals : fixture.home_goals
  const state = mine > theirs ? 'winning' : mine === theirs ? 'drawing' : 'losing'
  return FINISHED.includes(fixture.status) ? { winning: 'won', drawing: 'drew', losing: 'lost' }[state] : state
}

export const STATE_STYLE = {
  won:     { label: 'Won',       color: 'var(--green)' },
  void:    { label: 'Called off, through', color: 'var(--green)' },
  winning: { label: 'Winning',   color: 'var(--green)' },
  drawing: { label: 'Drawing',   color: 'var(--amber)' },
  losing:  { label: 'Losing',    color: 'var(--red)' },
  drew:    { label: 'Drew',      color: 'var(--red)' },
  lost:    { label: 'Lost',      color: 'var(--red)' },
  waiting: { label: 'To play',   color: 'var(--txt-muted)' },
}

export function scoreLine(f) {
  if (!f || f.home_goals == null) return null
  return `${f.home_team} ${f.home_goals}-${f.away_goals} ${f.away_team}`
}

export const OUT_REASON = { lost: 'lost', drew: 'drew', no_pick: 'no team left' }

/** Why a pick or a start was refused, in words. */
export const LMS_ERRORS = {
  not_signed_in: 'Sign in first.',
  not_found: 'That game could not be found.',
  finished: 'This game has finished.',
  not_entered: "That entry isn't yours.",
  out: 'That entry is out of this game.',
  no_fixtures: "That league's fixtures aren't loaded yet. Try again in a few minutes.",
  locked: 'Picks for this gameweek have locked.',
  not_playing: "That team doesn't play in this gameweek.",
  used: 'This entry has already picked that team.',
  not_lms: 'This competition is not a Last Man Standing.',
  already_running: 'A game is already running. It has to finish (or be stopped) first.',
  bad_points: 'Points per entry must be between 1 and 1000.',
  round_started: 'That gameweek has already kicked off. Choose a later one.',
  started: 'The game has started, so this can no longer be changed.',
  entries_closed: 'Entries closed at the first kick-off.',
  too_many: `You can have up to ${MAX_ENTRIES} entries.`,
  not_admin: 'Only the admin can do that.',
  bad_sport: 'Choose Football or NFL for the game.',
  device_needed: 'Start your free Last Man Standing game from the ALOTO app on your phone.',
  pro_needed: 'The free plan includes one Last Man Standing game per phone. Upgrade to Pro in Settings → ALOTO Pro to start another, including after a carry-over.',
}

/** Entry label: "Entry 2" when a player has more than one, else blank. */
export const entryTag = (e, entries) =>
  entries.filter(x => x.user_id === e.user_id).length > 1 ? `#${e.entry_no}` : ''

/**
 * Everything the screens need for one competition: its games (newest first),
 * the game on now (or the last one), its entries, the picks this person can
 * see, and the current gameweek's fixtures.
 */
export async function loadLms(supabase, competitionId) {
  const { data: games } = await supabase.from('lms_games')
    .select('*, winner:winner_user_id(display_name)')
    .eq('competition_id', competitionId)
    .order('game_number', { ascending: false })

  const all = games || []
  const game = all.find(g => g.status === 'open' || g.status === 'running')
    || all.find(g => g.status !== 'cancelled') || null
  if (!game) return { games: all, game: null }

  const [{ data: entries }, { data: picks }, { data: status }, { data: season }, { data: table }, plansRes] = await Promise.all([
    supabase.from('lms_entries').select('*, profile:user_id(display_name)').eq('game_id', game.id).order('entry_no'),
    supabase.from('lms_picks').select('*').eq('game_id', game.id).order('round'),
    supabase.rpc('lms_pick_status', { p_game_id: game.id }),
    // The whole season: form, the planner and the remaining teams all need it.
    supabase.from('lms_fixtures').select('*')
      .eq('sport', game.sport).eq('league_id', game.league_id).eq('season', game.season)
      .order('kickoff').limit(2000),
    supabase.from('lms_standings').select('team_id, team_name, position')
      .eq('sport', game.sport).eq('league_id', game.league_id).eq('season', game.season),
    // Your own planner (migration 132). Missing table = no plans yet.
    supabase.from('lms_plans').select('*').eq('game_id', game.id),
  ])

  // Entries waiting for the admin (migration 133) are kept apart: they are
  // not in the game until approved. Before 133 every entry counts.
  const everyEntry = entries || []
  const list = everyEntry.filter(e => e.approved !== false)
  const pending = everyEntry.filter(e => e.approved === false)
  const seasonFixtures = season || []
  const fixtures = seasonFixtures.filter(f => f.round >= game.start_round && f.round <= game.current_round)
  const fixturesById = new Map(seasonFixtures.map(f => [f.api_fixture_id, f]))
  const thisRound = fixtures.filter(f => f.round === game.current_round)
  const current = roundFixtures(thisRound)
  const lock = roundLock(thisRound)
  const hasPick = new Map((status || []).map(s => [s.entry_id, s.has_pick]))
  const standings = new Map((table || []).map(t => [t.team_id, t]))
  const teamCount = standings.size || leagueTeams(seasonFixtures).length || (game.sport === 'nfl' ? 32 : 20)

  return {
    games: all,
    game,
    entries: list,
    pending,
    allEntries: everyEntry,
    picks: picks || [],
    fixturesById,
    seasonFixtures,
    standings,
    plans: plansRes?.error ? [] : (plansRes?.data || []),
    plannerReady: !plansRes?.error,
    current,
    lock,
    locked: lock ? lock <= new Date() : false,
    hasPick,
    teamCount,
    players: new Set(list.map(e => e.user_id)).size,
    pot: game.pot ?? (game.carried_points + list.reduce((s, e) => s + (e.stake || 0), 0)),
  }
}

// ───────────────────────── Stats helpers ─────────────────────────

/** Every team in the league, from the table if loaded, else from the fixtures. Best placed first. */
export function leagueTeams(seasonFixtures, standings) {
  const teams = new Map()
  seasonFixtures.forEach(f => {
    teams.set(f.home_team_id, f.home_team)
    teams.set(f.away_team_id, f.away_team)
  })
  standings?.forEach((t, id) => teams.set(id, t.team_name))
  return [...teams.entries()]
    .map(([id, name]) => ({ id, name, position: standings?.get(id)?.position ?? null }))
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name))
}

const FOOTBALL_CODES = {
  'arsenal': 'ARS', 'aston villa': 'AVL', 'bournemouth': 'BOU', 'brentford': 'BRE', 'brighton': 'BHA',
  'burnley': 'BUR', 'chelsea': 'CHE', 'crystal palace': 'CRY', 'everton': 'EVE', 'fulham': 'FUL',
  'ipswich': 'IPS', 'leeds': 'LEE', 'leicester': 'LEI', 'liverpool': 'LIV', 'luton': 'LUT',
  'manchester city': 'MCI', 'manchester united': 'MUN', 'newcastle': 'NEW', 'nottingham forest': 'NFO',
  'sheffield utd': 'SHU', 'sheffield united': 'SHU', 'sheffield wednesday': 'SHW', 'southampton': 'SOU',
  'sunderland': 'SUN', 'tottenham': 'TOT', 'west ham': 'WHU', 'wolves': 'WOL', 'hull city': 'HUL',
  'coventry': 'COV', 'middlesbrough': 'MID', 'west brom': 'WBA', 'norwich': 'NOR', 'watford': 'WAT',
  'stoke city': 'STK', 'swansea': 'SWA', 'cardiff': 'CAR', 'millwall': 'MIL', 'preston': 'PNE',
  'queens park rangers': 'QPR', 'blackburn': 'BLB', 'bristol city': 'BRC', 'derby': 'DER',
  'portsmouth': 'POR', 'oxford united': 'OXF', 'plymouth': 'PLY', 'celtic': 'CEL', 'rangers': 'RAN',
  'real madrid': 'RMA', 'barcelona': 'BAR', 'atletico madrid': 'ATM', 'bayern munich': 'BAY',
  'borussia dortmund': 'BVB', 'paris saint germain': 'PSG', 'inter': 'INT', 'ac milan': 'MIL', 'juventus': 'JUV',
}

/** A three-letter code for a team: "MUN", "KC". */
export function teamCode(sport, name) {
  if (sport === 'nfl') return nflTeam(name).abbr
  const n = (name || '').toLowerCase().trim()
  if (FOOTBALL_CODES[n]) return FOOTBALL_CODES[n]
  const words = n.replace(/\b(fc|afc|cf|sc|ac)\b/g, '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length > 1 && words[0].length <= 3 ? words[0][0] + words[1].slice(0, 2) : words[0].slice(0, 3)).toUpperCase()
}

/** A team's finished games, oldest first. Each has res W/D/L, opponent, home, score, round. */
export function teamResults(seasonFixtures, teamId) {
  return seasonFixtures
    .filter(f => FINISHED.includes(f.status) && f.home_goals != null && (f.home_team_id === teamId || f.away_team_id === teamId))
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .map(f => {
      const home = f.home_team_id === teamId
      const mine = home ? f.home_goals : f.away_goals
      const theirs = home ? f.away_goals : f.home_goals
      return {
        res: mine > theirs ? 'W' : mine === theirs ? 'D' : 'L',
        opp: home ? f.away_team : f.home_team,
        oppId: home ? f.away_team_id : f.home_team_id,
        home, round: f.round, score: `${mine}-${theirs}`,
      }
    })
}

/** The last five results, oldest first. */
export const teamForm = (seasonFixtures, teamId, n = 5) => teamResults(seasonFixtures, teamId).slice(-n)

/** A team's games still to come from a gameweek on, one per gameweek. */
export function teamUpcoming(seasonFixtures, teamId, fromRound, n = 3) {
  const seen = new Set()
  return seasonFixtures
    .filter(f => f.round >= fromRound && !VOID.includes(f.status) && !FINISHED.includes(f.status)
      && (f.home_team_id === teamId || f.away_team_id === teamId))
    .sort((a, b) => a.round - b.round || new Date(a.kickoff) - new Date(b.kickoff))
    .filter(f => !seen.has(f.round) && seen.add(f.round))
    .slice(0, n)
    .map(f => {
      const home = f.home_team_id === teamId
      return { round: f.round, home, opp: home ? f.away_team : f.home_team, oppId: home ? f.away_team_id : f.home_team_id, kickoff: f.kickoff }
    })
}

/**
 * How hard a game looks, from the league table: 'easier' when the opponent is
 * well below, 'harder' when well above, else 'even'. A guide, not odds.
 */
export function difficulty(standings, teamId, oppId, teamCount = 20) {
  const a = standings.get(teamId)?.position
  const b = standings.get(oppId)?.position
  if (!a || !b) return 'even'
  const gap = Math.max(3, Math.round(teamCount * 0.25))
  return b - a >= gap ? 'easier' : a - b >= gap ? 'harder' : 'even'
}

export const DIFFICULTY_STYLE = {
  easier: { label: 'Easier', bg: 'var(--green-dim)', color: 'var(--green)', line: 'var(--green-line)' },
  even:   { label: 'Even',   bg: 'var(--bg-raised)', color: 'var(--txt-second)', line: 'var(--border-med)' },
  harder: { label: 'Harder', bg: 'var(--red-dim)',   color: 'var(--red)',   line: 'var(--red-line)' },
}

export const FORM_STYLE = {
  W: { bg: 'var(--green-dim)', color: 'var(--green)' },
  D: { bg: 'var(--amber-dim)', color: 'var(--amber)' },
  L: { bg: 'var(--red-dim)',   color: 'var(--red)' },
}

/** "1st", "2nd", "13th". */
export function ordinal(n) {
  if (!n) return ''
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Time left until a moment: "2d 4h", "3h 12m", "12m". */
export function countdown(to, now = new Date()) {
  const ms = +new Date(to) - +now
  if (ms <= 0) return null
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${Math.max(1, m)}m`
}

/** The live label for a fixture: "HT", "FT", "Live", or null before kick-off. */
export function fixtureStatus(f) {
  if (!f) return null
  if (VOID.includes(f.status)) return 'Off'
  if (FINISHED.includes(f.status)) return 'FT'
  if (['HT', 'BT', 'INT'].includes(f.status)) return 'HT'
  if (LIVE.includes(f.status)) return f.status === 'LIVE' ? 'Live' : f.status
  return null
}

/** The last gameweek with fixtures in the season. */
export const lastRound = seasonFixtures => seasonFixtures.reduce((m, f) => Math.max(m, f.round), 0)

/** Gameweeks of a league that have not kicked off yet, for choosing where a game starts. */
export async function upcomingRounds(supabase, sport, leagueId, season) {
  if (!leagueId || !season) return []
  const { data } = await supabase.from('lms_fixtures')
    .select('round, kickoff, status')
    .eq('sport', sport).eq('league_id', leagueId).eq('season', season)
    .gte('kickoff', new Date(Date.now() - 7 * DAY).toISOString())
  const byRound = new Map()
  ;(data || []).forEach(f => {
    if (!byRound.has(f.round)) byRound.set(f.round, [])
    byRound.get(f.round).push(f)
  })
  return [...byRound.entries()]
    .map(([round, list]) => ({ round, lock: roundLock(list) }))
    .filter(r => r.lock && r.lock > new Date())
    .sort((a, b) => a.round - b.round)
}

/** Football leagues to choose from (not cups): the main ones, then every other league API-Sports lists. */
export const POPULAR_LEAGUES = [
  { id: 39, name: 'Premier League', country: 'England' },
  { id: 40, name: 'Championship', country: 'England' },
  { id: 41, name: 'League One', country: 'England' },
  { id: 42, name: 'League Two', country: 'England' },
  { id: 179, name: 'Premiership', country: 'Scotland' },
  { id: 140, name: 'La Liga', country: 'Spain' },
  { id: 135, name: 'Serie A', country: 'Italy' },
  { id: 78, name: 'Bundesliga', country: 'Germany' },
  { id: 61, name: 'Ligue 1', country: 'France' },
  { id: 88, name: 'Eredivisie', country: 'Netherlands' },
  { id: 94, name: 'Primeira Liga', country: 'Portugal' },
  { id: 253, name: 'Major League Soccer', country: 'USA' },
]
export async function lmsLeagueOptions(supabase) {
  const { data } = await supabase.from('api_leagues').select('id, name, country').eq('type', 'League').limit(2000)
  const popular = new Set(POPULAR_LEAGUES.map(l => l.id))
  const more = (data || [])
    .filter(l => !popular.has(l.id))
    .sort((a, b) => (a.country || '').localeCompare(b.country || '') || a.name.localeCompare(b.name))
  return { popular: POPULAR_LEAGUES, more }
}

export const leagueLabel = l => (l.country && !['World'].includes(l.country) ? `${l.name} (${l.country})` : l.name)
