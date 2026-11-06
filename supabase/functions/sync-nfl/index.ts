// supabase/functions/sync-nfl/index.ts
//
// The NFL feed: API-SPORTS American Football (v1.american-football.api-sports.io).
// Separate from sync-football in every way — its own columns, its own log, its
// own quota — so nothing here can touch a football fixture.
//
// Three modes, chosen by the `mode` field in the request body:
//
//   week    list one NFL week's games, marking any already in the gameweek,
//           so the admin can pick which to play. One request.
//   import  add the picked games (game_ids) to a gameweek as fixtures, already
//           linked to the feed. One request.
//   live    poll games in progress and write their scores to the live_*
//           columns. Run on a schedule every 30 seconds. Costs nothing when no
//           game is on: it only calls the API while a linked game is inside
//           its window.
//
// FINAL SCORES INCLUDE OVERTIME. A game is final only when the feed says FT
// (finished in regulation) or AOT (after overtime). A game tied at the end of
// the fourth quarter goes to OT, not FT, so it is never treated as final early.
//
// Like football, home_score/away_score (what scoring reads) are only filled in
// automatically where the competition has "Confirm results automatically"
// switched on. Otherwise the live score is shown as provisional and the admin
// confirms it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API_HOST = 'https://v1.american-football.api-sports.io'
const NFL_LEAGUE_ID = '1'
// Pro plan: 7,500 a day. Kept a little short so a busy Sunday never hits the wall.
const DAILY_LIMIT = Number(Deno.env.get('API_NFL_DAILY_LIMIT') ?? '7500')
const RESERVE = 100

const FINAL = ['FT', 'AOT']
const NOT_PLAYING = ['NS', 'CANC', 'PST', 'TBD']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// The same API-SPORTS account as football, so the same key unless a separate
// one has been set.
const apiKey = Deno.env.get('API_NFL_KEY') ?? Deno.env.get('API_FOOTBALL_KEY')!

async function apiGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(API_HOST + path)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } })
  const body = await res.json()

  // 200 with an `errors` object rather than an HTTP error, as with football.
  const errors = body.errors
  if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)) {
    if (errors.plan) throw new Error(`NFL API plan limit: ${errors.plan}`)
    if (errors.token || errors.key) throw new Error('The NFL API key was rejected. Check API_NFL_KEY (or API_FOOTBALL_KEY) in Edge Function secrets.')
    if (errors.requests) throw new Error(`NFL API daily request limit reached: ${errors.requests}`)
    throw new Error(`NFL API error: ${JSON.stringify(errors)}`)
  }
  return body
}

async function log(entry: Record<string, unknown>) {
  await supabase.from('nfl_sync_log').insert(entry)
}

async function quotaRemaining(): Promise<number> {
  const { data } = await supabase.rpc('nfl_requests_used_today')
  return DAILY_LIMIT - RESERVE - (data ?? 0)
}

// The NFL season is named for the year it starts: January and February games
// belong to the previous year's season.
function seasonFor(d: Date) {
  return d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
}

const weekNumber = (w: string | null | undefined) => {
  const m = String(w ?? '').match(/(\d+)/)
  return m ? Number(m[1]) : null
}

/* ------------------------------------------------------------------ */

/**
 * One NFL week's games from the feed. One request: the whole season's schedule
 * comes back at once and is filtered here.
 */
async function weekGames(week: number, season?: number) {
  if (await quotaRemaining() <= 0) throw new Error('Daily NFL API request limit reached. Try again tomorrow.')
  const yr = season || seasonFor(new Date())
  const body = await apiGet('/games', { league: NFL_LEAGUE_ID, season: String(yr) })
  const all = body.response ?? []
  await log({ kind: 'week', requests_used: 1, games_seen: all.length })
  const games = all
    .filter((g: any) => /regular/i.test(g.game?.stage ?? '') && weekNumber(g.game?.week) === Number(week))
    .sort((a: any, b: any) => Number(a.game.date.timestamp) - Number(b.game.date.timestamp))
  return { yr, games }
}

async function existingLinks(gameweekId: string) {
  const { data } = await supabase.from('fixtures')
    .select('id, api_nfl_game_id').eq('gameweek_id', gameweekId).not('api_nfl_game_id', 'is', null)
  return new Map((data ?? []).map(f => [Number(f.api_nfl_game_id), f.id]))
}

/** The week's games for the admin to pick from, marking those already added. */
async function listWeek(gameweekId: string, week: number, season?: number) {
  if (!gameweekId || !week) return { error: 'Choose a gameweek and an NFL week.' }
  const { yr, games } = await weekGames(week, season)
  if (!games.length) return { error: `No regular-season games found for Week ${week} of the ${yr} season.` }
  const have = await existingLinks(gameweekId)
  return {
    week, season: yr,
    games: games.map((g: any) => ({
      id: Number(g.game.id),
      home_team: g.teams.home.name,
      away_team: g.teams.away.name,
      kickoff_time: new Date(Number(g.game.date.timestamp) * 1000).toISOString(),
      added: have.has(Number(g.game.id)),
    })),
  }
}

/**
 * Add the games the admin picked. Games already in the gameweek are skipped,
 * and their kickoff brought up to date — the NFL moves games late in the
 * season, and a stale kickoff would lock picks at the wrong time.
 */
async function importWeek(gameweekId: string, week: number, gameIds: number[], season?: number) {
  if (!gameweekId || !week) return { error: 'Choose a gameweek and an NFL week.' }
  if (!gameIds?.length) return { error: 'Pick at least one game.' }
  const { yr, games: all } = await weekGames(week, season)
  const wanted = new Set(gameIds.map(Number))
  const games = all.filter((g: any) => wanted.has(Number(g.game.id)))
  if (!games.length) return { error: `None of those games are in Week ${week} of the ${yr} season.` }

  const have = await existingLinks(gameweekId)

  let added = 0
  for (const g of games) {
    const kickoff = new Date(Number(g.game.date.timestamp) * 1000).toISOString()
    const id = Number(g.game.id)
    if (have.has(id)) {
      await supabase.from('fixtures').update({ kickoff_time: kickoff }).eq('id', have.get(id))
      continue
    }
    const { error } = await supabase.from('fixtures').insert({
      gameweek_id: gameweekId,
      home_team: g.teams.home.name,
      away_team: g.teams.away.name,
      kickoff_time: kickoff,
      venue: g.game.venue?.name ?? null,
      status: 'upcoming',
      api_nfl_game_id: id,
    })
    if (!error) added++
  }

  return { week, season: yr, added }
}

/**
 * Live scores. Polls only while a linked game is between 15 minutes before
 * kickoff and six hours after it, and not yet final. One request per distinct
 * game date — usually one, two on a Sunday whose night game crosses midnight UTC.
 */
async function syncLive() {
  const now = Date.now()
  const { data: fixtures } = await supabase.from('fixtures')
    .select('id, gameweek_id, kickoff_time, api_nfl_game_id, live_status, home_score, status')
    .not('api_nfl_game_id', 'is', null)
    .gte('kickoff_time', new Date(now - 6 * 60 * 60 * 1000).toISOString())
    .lte('kickoff_time', new Date(now + 15 * 60 * 1000).toISOString())

  const watching = (fixtures ?? []).filter(f =>
    f.status !== 'void' && !(FINAL.includes(f.live_status ?? '') && f.home_score != null))
  if (!watching.length) return { updated: 0, note: 'No NFL game in progress' }

  const remaining = await quotaRemaining()
  const dates = [...new Set(watching.map(f => new Date(f.kickoff_time).toISOString().slice(0, 10)))]
  if (dates.length > remaining) {
    await log({ kind: 'live', requests_used: 0, error: 'Daily quota reached' })
    return { skipped: 'Daily NFL API quota reached' }
  }

  const wanted = new Set(watching.map(f => Number(f.api_nfl_game_id)))
  let updated = 0
  const nowFinal: string[] = []

  for (const date of dates) {
    const body = await apiGet('/games', { league: NFL_LEAGUE_ID, date, timezone: 'UTC' })
    const games = (body.response ?? []).filter((g: any) => wanted.has(Number(g.game.id)))

    for (const g of games) {
      const status = g.game.status?.short ?? null
      const started = status && !NOT_PLAYING.includes(status)
      // scores.*.total is the running total, overtime included.
      const { error } = await supabase.from('fixtures').update({
        live_home_score: started ? g.scores.home.total : null,
        live_away_score: started ? g.scores.away.total : null,
        live_status: status,
        live_clock: g.game.status?.timer ?? null,
        live_updated_at: new Date().toISOString(),
      }).eq('api_nfl_game_id', Number(g.game.id))
      if (!error) updated++
      if (FINAL.includes(status)) nowFinal.push(String(g.game.id))
    }
    await log({ kind: 'live', requests_used: 1, games_seen: games.length, games_updated: games.length })
  }

  const finalised = await autoFinalise(nowFinal)
  return { updated, finalised }
}

/**
 * Copy a final score (FT or AOT — overtime included) into the confirmed score,
 * only for competitions that have switched on automatic confirmation, and only
 * where no score has been entered yet. Never marks the week completed: that,
 * and the points it moves, stays the admin's call.
 */
async function autoFinalise(gameIds: string[]) {
  if (!gameIds.length) return 0
  const { data: candidates } = await supabase.from('fixtures')
    .select('id, gameweek_id, live_home_score, live_away_score')
    .in('api_nfl_game_id', gameIds.map(Number))
    .in('live_status', FINAL)
    .is('home_score', null)
    .neq('status', 'void')
  if (!candidates?.length) return 0

  // Which competitions each gameweek feeds, and whether any of them wants this.
  const gwIds = [...new Set(candidates.map(f => f.gameweek_id))]
  const { data: links } = await supabase.from('competition_gameweeks')
    .select('gameweek_id, competition_id').in('gameweek_id', gwIds)
  const compIds = [...new Set((links ?? []).map(l => l.competition_id))]
  if (!compIds.length) return 0
  const { data: comps } = await supabase.from('competitions')
    .select('id').in('id', compIds).eq('auto_finalise_scores', true)
  const willing = new Set((comps ?? []).map(c => c.id))
  const gwWilling = new Set((links ?? []).filter(l => willing.has(l.competition_id)).map(l => l.gameweek_id))

  let finalised = 0
  for (const fx of candidates) {
    if (!gwWilling.has(fx.gameweek_id)) continue
    if (fx.live_home_score == null || fx.live_away_score == null) continue
    const { error } = await supabase.from('fixtures').update({
      home_score: fx.live_home_score,
      away_score: fx.live_away_score,
      status: 'completed',
    }).eq('id', fx.id).is('home_score', null)
    if (!error) finalised++
  }
  if (finalised) await log({ kind: 'finalise', requests_used: 0, games_updated: finalised })
  return finalised
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { mode, gameweek_id, week, season, game_ids } = await req.json().catch(() => ({ mode: 'live' }))
    const yr = season ? Number(season) : undefined
    const result = mode === 'week' ? await listWeek(gameweek_id, Number(week), yr)
      : mode === 'import' ? await importWeek(gameweek_id, Number(week), game_ids, yr)
      : await syncLive()
    return new Response(JSON.stringify({ ok: !('error' in result), ...result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    await log({ kind: 'error', requests_used: 0, error: String(err) })
    // 200 with ok:false, as sync-football does, so the admin sees the reason.
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
