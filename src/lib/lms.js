/**
 * Last Man Standing: reading a game and its gameweek. See migration 123 for
 * the rules; the database decides every outcome (lms_settle), so nothing here
 * changes anyone's status. These helpers only mirror the database's idea of a
 * gameweek's deadline so the screen can say when picks lock.
 */

export const LMS_FORMAT = 'last_man_standing'

export const FINISHED = ['FT', 'AET', 'PEN', 'AWD', 'WO']
export const VOID = ['PST', 'CANC', 'ABD']
export const LIVE = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE', 'SUSP']

const DAY = 24 * 60 * 60 * 1000

export const isLms = c => c?.format === LMS_FORMAT

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

/** Teams this player cannot pick this gameweek (the list restarts every 20). */
export function usedTeams(myPicks, round) {
  const earlier = myPicks.filter(p => p.round < round).sort((a, b) => a.round - b.round)
  const keepFrom = Math.floor(earlier.length / 20) * 20
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

export const OUT_REASON = { lost: 'lost', drew: 'drew', no_pick: 'no pick' }

/** Why a pick or a start was refused, in words. */
export const LMS_ERRORS = {
  not_signed_in: 'Sign in first.',
  not_found: 'That game could not be found.',
  finished: 'This game has finished.',
  not_entered: "You're not in this game. You'll be in the next one.",
  out: "You're out of this game.",
  no_fixtures: "The Premier League fixtures aren't loaded yet. Try again in a few minutes.",
  locked: 'Picks for this gameweek have locked.',
  not_playing: "That team doesn't play in this gameweek.",
  used: "You've already picked that team.",
  not_admin: 'Only the admin can do that.',
  not_lms: 'This competition is not a Last Man Standing.',
  already_running: 'A game is already running. It has to finish (or be stopped) first.',
  bad_points: 'Points per player must be between 1 and 1000.',
  round_started: 'That gameweek has already kicked off. Choose a later one.',
  started: 'The game has started, so this can no longer be changed.',
}

/**
 * Everything the screens need for one competition: its games (newest first),
 * the game on now (or the last one), its players, the picks this person can
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

  const [{ data: entries }, { data: picks }, { data: status }, { data: fixtures }] = await Promise.all([
    supabase.from('lms_entries').select('*, profile:user_id(display_name)').eq('game_id', game.id),
    supabase.from('lms_picks').select('*').eq('game_id', game.id).order('round'),
    supabase.rpc('lms_pick_status', { p_game_id: game.id }),
    supabase.from('lms_fixtures').select('*').eq('season', game.season)
      .gte('round', game.start_round).lte('round', game.current_round),
  ])

  const fixturesById = new Map((fixtures || []).map(f => [f.api_fixture_id, f]))
  const current = roundFixtures((fixtures || []).filter(f => f.round === game.current_round))
  const lock = roundLock((fixtures || []).filter(f => f.round === game.current_round))
  const hasPick = new Map((status || []).map(s => [s.user_id, s.has_pick]))

  return {
    games: all,
    game,
    entries: entries || [],
    picks: picks || [],
    fixturesById,
    current,
    lock,
    locked: lock ? lock <= new Date() : false,
    hasPick,
    pot: game.pot ?? (game.points_per_player * (entries || []).length + game.carried_points),
  }
}

/** Gameweeks that have not kicked off yet, for choosing where a game starts. */
export async function upcomingRounds(supabase, season) {
  const { data } = await supabase.from('lms_fixtures')
    .select('round, kickoff, status').eq('season', season).gte('kickoff', new Date(Date.now() - 7 * DAY).toISOString())
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

export async function currentSeason(supabase) {
  const { data } = await supabase.rpc('lms_current_season')
  if (data) return Number(data)
  const now = new Date()
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
}
