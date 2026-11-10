// supabase/functions/sync-f1/index.ts
//
// The F1 feed: API-SPORTS Formula 1 (v1.formula-1.api-sports.io). Separate
// from sync-football and sync-nfl in every way — its own tables, its own log,
// its own quota — so nothing here can touch a football or NFL fixture.
//
// Modes, chosen by the `mode` field in the request body:
//
//   season     The season's Grands Prix, marking those already in this
//              league, so the admin can pick which to add. One request.
//   import     Add the picked races (race_ids) to the league: one race
//              weekend = one gameweek ("R21"). A race another league already
//              added is shared, so picks count in every league. Also loads
//              the drivers and teams if this season has none yet.
//   drivers    Refresh the season's drivers and teams.
//   results    Fetch the qualifying and race results for one race now
//              (race_id). Admin only. Writes them provisional.
//   standings  Refresh the drivers' and constructors' championship.
//   live       (default, every minute from pg_cron, see 120) Polls only while
//              a race is inside its window: qualifying from 10 minutes before
//              until confirmed (3 hours at most), the race from 10 minutes
//              before until confirmed (4 hours at most). Uses no requests the
//              rest of the week.
//
// Results arrive PROVISIONAL. A session is scored when the admin confirms it
// in Admin → Races, or straight away when the feed says it is completed and a
// league in that race has "Confirm results automatically" switched on.
//
// The grid pick is scored against the QUALIFYING RESULT (Q3 order, then the
// drivers out in Q2, then Q1), before grid penalties.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API_HOST = 'https://v1.formula-1.api-sports.io'
const DAILY_LIMIT = Number(Deno.env.get('API_F1_DAILY_LIMIT') ?? '7500')
const RESERVE = 50

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// The same API-SPORTS account as football and NFL, so the same key unless a
// separate one has been set.
const apiKey = Deno.env.get('API_F1_KEY') ?? Deno.env.get('API_FOOTBALL_KEY')!

let requestsThisRun = 0

async function apiGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(API_HOST + path)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  requestsThisRun++
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } })
  const body = await res.json()
  const errors = body.errors
  if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)) {
    if (errors.plan) throw new Error(`F1 API plan limit: ${errors.plan}`)
    if (errors.token || errors.key) throw new Error('The F1 API key was rejected. Check API_F1_KEY (or API_FOOTBALL_KEY) in Edge Function secrets.')
    if (errors.requests) throw new Error(`F1 API daily request limit reached: ${errors.requests}`)
    throw new Error(`F1 API error: ${JSON.stringify(errors)}`)
  }
  return body.response ?? []
}

async function log(kind: string, rows_updated = 0, error: string | null = null) {
  await supabase.from('f1_sync_log').insert({ kind, requests_used: requestsThisRun, rows_updated, error })
  requestsThisRun = 0
}

async function quotaRemaining(): Promise<number> {
  const { data } = await supabase.rpc('f1_requests_used_today')
  return DAILY_LIMIT - RESERVE - (data ?? 0)
}

const thisSeason = () => new Date().getUTCFullYear()
const isQuali = (t: string) => /qualifying/i.test(t ?? '') && !/sprint/i.test(t ?? '')
const isRace = (t: string) => String(t ?? '').trim().toLowerCase() === 'race'
// Sprint weekends: sprint qualifying (once "Sprint Shootout", in parts) and the sprint itself.
const isSprintQuali = (t: string) => /sprint/i.test(t ?? '') && /qualif|shootout/i.test(t ?? '')
const isSprint = (t: string) => /sprint/i.test(t ?? '') && !isSprintQuali(t)

type Session = 'sprint_grid' | 'sprint' | 'grid' | 'race'
const SESSIONS: { s: Session, at: string, confirmed: string, hours: number }[] = [
  { s: 'sprint_grid', at: 'sprint_qualifying_at', confirmed: 'sprint_grid_confirmed', hours: 2 },
  { s: 'sprint',      at: 'sprint_at',            confirmed: 'sprint_confirmed',      hours: 2 },
  { s: 'grid',        at: 'qualifying_at',        confirmed: 'grid_confirmed',        hours: 3 },
  { s: 'race',        at: 'race_at',              confirmed: 'race_confirmed',        hours: 4 },
]
const qualiOrder = (t: string) => /3rd|q3/i.test(t) ? 3 : /2nd|q2/i.test(t) ? 2 : /1st|q1/i.test(t) ? 1 : 0

/* ------------------------------------------------------------------ */
/* Who is asking                                                       */
/* ------------------------------------------------------------------ */

async function callerId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data } = await supabase.auth.getUser(jwt)
  return data?.user?.id ?? null
}

async function adminOf(userId: string | null, competitionId: string) {
  if (!userId || !competitionId) return false
  const { data } = await supabase.from('participants').select('role')
    .eq('competition_id', competitionId).eq('user_id', userId).eq('role', 'admin').maybeSingle()
  return !!data
}

async function adminOfRace(userId: string | null, raceId: string) {
  if (!userId) return false
  const { data: race } = await supabase.from('f1_races').select('gameweek_id').eq('id', raceId).maybeSingle()
  if (!race) return false
  const { data: links } = await supabase.from('competition_gameweeks').select('competition_id').eq('gameweek_id', race.gameweek_id)
  for (const l of links ?? []) if (await adminOf(userId, l.competition_id)) return true
  return false
}

/* ------------------------------------------------------------------ */
/* Drivers and teams                                                   */
/* ------------------------------------------------------------------ */

async function upsertTeam(season: number, t: any) {
  if (!t?.id) return null
  const { data } = await supabase.from('f1_teams')
    .upsert({ season, api_team_id: Number(t.id), name: t.name, logo: t.logo ?? null }, { onConflict: 'season,api_team_id' })
    .select('id').single()
  return data?.id ?? null
}

async function upsertDriver(season: number, d: any, teamId: string | null, sortOrder?: number) {
  if (!d?.id) return null
  const row: Record<string, unknown> = {
    season, api_driver_id: Number(d.id), name: d.name, abbr: d.abbr ?? null,
    number: d.number ?? null, image: d.image ?? null, active: true,
  }
  if (teamId) row.team_id = teamId
  if (sortOrder != null) row.sort_order = sortOrder
  const { data } = await supabase.from('f1_drivers').upsert(row, { onConflict: 'season,api_driver_id' }).select('id').single()
  return data?.id ?? null
}

/**
 * The season's drivers and teams, from the drivers' championship. Before the
 * first race of a season that is empty, so it falls back to the last race's
 * classification (the grid rarely changes over the winter, and the admin can
 * refresh after round 1).
 */
async function syncDrivers(season: number) {
  let rows = await apiGet('/rankings/drivers', { season: String(season) })
  if (!rows.length) {
    const prev = await apiGet('/races', { season: String(season - 1), type: 'Race' })
    const last = prev.filter((r: any) => /completed/i.test(r.status ?? '')).sort((a: any, b: any) => +new Date(b.date) - +new Date(a.date))[0]
    if (last) rows = await apiGet('/rankings/races', { race: String(last.id) })
  }
  let n = 0
  const teamOrder: Record<string, number> = {}
  for (const [i, r] of rows.entries()) {
    const teamId = await upsertTeam(season, r.team)
    if (teamId && teamOrder[teamId] == null) teamOrder[teamId] = Object.keys(teamOrder).length + 1
    if (await upsertDriver(season, r.driver, teamId, i + 1)) n++
  }
  for (const [id, order] of Object.entries(teamOrder)) await supabase.from('f1_teams').update({ sort_order: order }).eq('id', id)
  await log('drivers', n)
  return { season, drivers: n }
}

async function driverMap(season: number) {
  const { data } = await supabase.from('f1_drivers').select('id, api_driver_id').eq('season', season)
  return new Map((data ?? []).map(d => [Number(d.api_driver_id), d.id]))
}

/* ------------------------------------------------------------------ */
/* The calendar                                                        */
/* ------------------------------------------------------------------ */

/** Every session of a season, grouped into race weekends by the Grand Prix. */
async function seasonWeekends(season: number) {
  const all = await apiGet('/races', { season: String(season) })
  const byGp = new Map<number, any[]>()
  for (const s of all) {
    const gp = Number(s.competition?.id)
    if (!byGp.has(gp)) byGp.set(gp, [])
    byGp.get(gp)!.push(s)
  }
  const weekends: any[] = []
  for (const sessions of byGp.values()) {
    const race = sessions.find(s => isRace(s.type))
    if (!race) continue
    const byDate = (a: any, b: any) => +new Date(a.date) - +new Date(b.date)
    const qualis = sessions.filter(s => isQuali(s.type)).sort(byDate)
    const sprintQualis = sessions.filter(s => isSprintQuali(s.type)).sort(byDate)
    const sprint = sessions.find(s => isSprint(s.type)) ?? null
    weekends.push({ race, qualis, sprintQualis, sprint })
  }
  weekends.sort((a, b) => +new Date(a.race.date) - +new Date(b.race.date))
  let round = 0
  for (const w of weekends) w.round = /cancel/i.test(w.race.status ?? '') ? null : ++round
  return weekends as Weekend[]
}

type Weekend = { race: any, qualis: any[], sprintQualis: any[], sprint: any | null, round: number | null }

const iso = (d: any) => d ? new Date(d).toISOString() : null

const raceRow = (season: number, w: Weekend) => ({
  season,
  round: w.round,
  api_competition_id: Number(w.race.competition?.id) || null,
  api_race_id: Number(w.race.id),
  name: w.race.competition?.name ?? 'Grand Prix',
  circuit: w.race.circuit?.name ?? null,
  city: w.race.competition?.location?.city ?? null,
  country: w.race.competition?.location?.country ?? null,
  qualifying_at: iso(w.qualis[0]?.date),
  sprint_qualifying_at: iso(w.sprintQualis[0]?.date),
  sprint_at: iso(w.sprint?.date),
  api_sprint_id: w.sprint ? Number(w.sprint.id) : null,
  race_at: new Date(w.race.date).toISOString(),
  total_laps: w.race.laps?.total ?? null,
  status: /cancel/i.test(w.race.status ?? '') ? 'cancelled' : undefined,
})

async function listSeason(competitionId: string, season: number) {
  const weekends = await seasonWeekends(season)
  const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', competitionId)
  const gwIds = (links ?? []).map(l => l.gameweek_id)
  const { data: have } = gwIds.length
    ? await supabase.from('f1_races').select('api_race_id').in('gameweek_id', gwIds)
    : { data: [] as any[] }
  const added = new Set((have ?? []).map(r => Number(r.api_race_id)))
  await log('season', weekends.length)
  return {
    season,
    races: weekends.map(w => ({
      id: Number(w.race.id), round: w.round,
      name: w.race.competition?.name, circuit: w.race.circuit?.name,
      country: w.race.competition?.location?.country,
      qualifying_at: w.qualis[0]?.date ?? null, race_at: w.race.date, sprint: !!w.sprint,
      status: w.race.status, added: added.has(Number(w.race.id)),
    })),
  }
}

async function importRaces(competitionId: string, season: number, raceIds: number[]) {
  if (!raceIds?.length) return { error: 'Pick at least one race.' }
  const wanted = new Set(raceIds.map(Number))
  const weekends = (await seasonWeekends(season)).filter(w => wanted.has(Number(w.race.id)))

  const { count } = await supabase.from('f1_drivers').select('id', { count: 'exact', head: true }).eq('season', season)
  if (!count) await syncDrivers(season)

  let added = 0, shared = 0
  for (const w of weekends) {
    const row = raceRow(season, w)
    const { data: existing } = await supabase.from('f1_races').select('id, gameweek_id').eq('api_race_id', row.api_race_id).maybeSingle()
    let gameweekId = existing?.gameweek_id
    if (existing) {
      await supabase.from('f1_races').update({ ...row, status: row.status ?? undefined }).eq('id', existing.id)
      shared++
    } else {
      const { data: gw, error } = await supabase.from('gameweeks')
        .insert({ competition_id: competitionId, number: `R${w.round ?? ''}`, status: 'active', deadline: row.qualifying_at ?? row.race_at })
        .select('id').single()
      if (error) throw new Error(`Could not add ${row.name}: ${error.message}`)
      gameweekId = gw.id
      const { error: e2 } = await supabase.from('f1_races').insert({ ...row, status: row.status ?? 'upcoming', gameweek_id: gameweekId })
      if (e2) throw new Error(`Could not add ${row.name}: ${e2.message}`)
      added++
    }
    const { data: link } = await supabase.from('competition_gameweeks').select('gameweek_id')
      .eq('competition_id', competitionId).eq('gameweek_id', gameweekId).maybeSingle()
    if (!link) await supabase.from('competition_gameweeks').insert({ competition_id: competitionId, gameweek_id: gameweekId })
  }
  await log('import', added + shared)
  return { season, added, shared }
}

/** Brings imported races' times up to date. F1 does move sessions. */
async function refreshTimes(season: number) {
  const { data: races } = await supabase.from('f1_races').select('id, api_race_id').eq('season', season)
  if (!races?.length) return 0
  const byApi = new Map(races.map(r => [Number(r.api_race_id), r.id]))
  let n = 0
  for (const w of await seasonWeekends(season)) {
    const id = byApi.get(Number(w.race.id)); if (!id) continue
    const row = raceRow(season, w)
    const upd: Record<string, unknown> = {
      qualifying_at: row.qualifying_at, race_at: row.race_at, total_laps: row.total_laps, round: row.round,
      sprint_qualifying_at: row.sprint_qualifying_at, sprint_at: row.sprint_at, api_sprint_id: row.api_sprint_id,
    }
    if (row.status === 'cancelled') upd.status = 'cancelled'
    await supabase.from('f1_races').update(upd).eq('id', id); n++
  }
  await log('times', n)
  return n
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

async function writeResults(raceId: string, session: Session, season: number, ranked: { driver: any, team: any, position: number | null, gap?: string | null, note?: string | null }[]) {
  const map = await driverMap(season)
  // Only touch a session that is still provisional: a confirmed result is the admin's.
  const { data: race } = await supabase.from('f1_races').select('*').eq('id', raceId).single()
  if (race?.[SESSIONS.find(x => x.s === session)!.confirmed]) return 0
  let n = 0
  for (const r of ranked) {
    let driverId = map.get(Number(r.driver?.id))
    if (!driverId) {
      // A reserve driver standing in: add them to the season.
      driverId = await upsertDriver(season, r.driver, await upsertTeam(season, r.team)) ?? undefined
      if (!driverId) continue
      map.set(Number(r.driver.id), driverId)
    }
    const { error } = await supabase.from('f1_results').upsert({
      race_id: raceId, session, driver_id: driverId, position: r.position,
      gap: r.gap ?? null, note: r.note ?? null, provisional: true, updated_at: new Date().toISOString(),
    }, { onConflict: 'race_id,session,driver_id' })
    if (!error) n++
  }
  return n
}

const posOf = (r: any) => { const p = Number(r.position); return Number.isFinite(p) && p > 0 ? p : null }

/** The qualifying result: Q3's order, then those out in Q2, then Q1. */
async function qualifyingResult(qualis: any[]) {
  const sessions = [...qualis].sort((a, b) => qualiOrder(b.type) - qualiOrder(a.type))
  const seen = new Set<number>()
  const out: any[] = []
  let anyDone = false, allDone = sessions.length > 0
  for (const s of sessions) {
    if (/completed/i.test(s.status ?? '')) anyDone = true; else allDone = false
    const rows = (await apiGet('/rankings/races', { race: String(s.id) }))
      .filter((r: any) => posOf(r)).sort((a: any, b: any) => posOf(a)! - posOf(b)!)
    for (const r of rows) {
      const id = Number(r.driver?.id)
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ driver: r.driver, team: r.team, gap: r.time ?? r.gap ?? null })
    }
  }
  // Positions follow the merged order; a running Q1 with nothing yet is empty.
  return { rows: out.map((r, i) => ({ ...r, position: i + 1 })), done: allDone, started: anyDone || out.length > 0 }
}

async function raceResult(apiRaceId: number) {
  const rows = await apiGet('/rankings/races', { race: String(apiRaceId) })
  return rows.map((r: any) => ({
    driver: r.driver, team: r.team, position: posOf(r),
    gap: r.gap ?? r.time ?? null,
    note: posOf(r) ? null : (r.time ?? 'DNF'),
  }))
}

async function sessionStatus(apiRaceId: number) {
  const [s] = await apiGet('/races', { id: String(apiRaceId) })
  return { status: s?.status ?? null, lap: s?.laps?.current ?? null, total: s?.laps?.total ?? null }
}

async function autoConfirmWanted(gameweekId: string) {
  const { data: links } = await supabase.from('competition_gameweeks').select('competition_id').eq('gameweek_id', gameweekId)
  const ids = (links ?? []).map(l => l.competition_id)
  if (!ids.length) return false
  const { data } = await supabase.from('competitions').select('id').in('id', ids).eq('auto_finalise_scores', true)
  return !!data?.length
}

/** One race weekend's qualifying sessions, fresh from the feed. */
async function weekendSessions(race: any) {
  const all = await apiGet('/races', { season: String(race.season), competition: String(race.api_competition_id) })
  return { qualis: all.filter((s: any) => isQuali(s.type)), sprintQualis: all.filter((s: any) => isSprintQuali(s.type)) }
}

const LIVE = /live|progress|running|started/i

async function fetchResults(raceId: string, sessions: Session[] = ['sprint_grid', 'sprint', 'grid', 'race']) {
  const { data: race } = await supabase.from('f1_races').select('*').eq('id', raceId).single()
  if (!race) return { error: 'Race not found.' }
  const out: Record<string, unknown> = {}
  const autoOk = await autoConfirmWanted(race.gameweek_id)
  let weekend: { qualis: any[], sprintQualis: any[] } | null = null
  let liveNow: Session | null = null

  for (const def of SESSIONS) {
    const s = def.s
    if (!sessions.includes(s) || race[def.confirmed]) continue
    if ((s === 'sprint_grid' || s === 'sprint') && !race.sprint_at) continue

    let done = false, rows: any[] = []
    if (s === 'grid' || s === 'sprint_grid') {
      weekend ??= await weekendSessions(race)
      const parts = s === 'grid' ? weekend.qualis : weekend.sprintQualis
      if (!parts.length) continue
      const q = await qualifyingResult(parts)
      rows = q.rows; done = q.done
      if (q.started && !q.done) liveNow = s
    } else {
      const apiId = s === 'race' ? race.api_race_id : race.api_sprint_id
      if (!apiId) continue
      const st = await sessionStatus(apiId)
      const live = LIVE.test(st.status ?? '') || (!!st.lap && !/completed/i.test(st.status ?? ''))
      done = /completed/i.test(st.status ?? '')
      if (live || done) rows = await raceResult(apiId)
      if (live) liveNow = s
      if (s === 'race') {
        await supabase.from('f1_races').update({
          live_lap: st.lap, total_laps: st.total ?? race.total_laps,
          ...(/cancel/i.test(st.status ?? '') ? { status: 'cancelled' } : {}),
        }).eq('id', raceId)
      } else if (live) {
        await supabase.from('f1_races').update({ live_lap: st.lap }).eq('id', raceId)
      }
    }
    if (rows.length) out[s] = await writeResults(raceId, s, race.season, rows)
    out[`${s}_done`] = done
    if (done && rows.length && autoOk) {
      const { error } = await supabase.rpc('f1_confirm_session', { p_race_id: raceId, p_session: s })
      if (!error) {
        out[`${s}_confirmed`] = true
        if (s === 'race' || s === 'sprint') await syncStandings(race.season)
      }
    }
  }

  await supabase.from('f1_races').update({ live_session: liveNow, live_updated_at: new Date().toISOString() }).eq('id', raceId)
  return out
}

/* ------------------------------------------------------------------ */
/* Championship                                                        */
/* ------------------------------------------------------------------ */

async function syncStandings(season: number) {
  const drivers = await apiGet('/rankings/drivers', { season: String(season) })
  const teams = await apiGet('/rankings/teams', { season: String(season) })
  const map = await driverMap(season)
  const now = new Date().toISOString()
  let n = 0
  if (drivers.length) await supabase.from('f1_championship').delete().eq('season', season).eq('kind', 'drivers')
  for (const r of drivers) {
    let driverId = map.get(Number(r.driver?.id))
    if (!driverId) driverId = await upsertDriver(season, r.driver, await upsertTeam(season, r.team)) ?? undefined
    if (!driverId || !posOf(r)) continue
    await supabase.from('f1_championship').insert({ season, kind: 'drivers', position: posOf(r), driver_id: driverId, points: r.points ?? null, updated_at: now })
    n++
  }
  if (teams.length) await supabase.from('f1_championship').delete().eq('season', season).eq('kind', 'constructors')
  for (const r of teams) {
    const teamId = await upsertTeam(season, r.team)
    if (!teamId || !posOf(r)) continue
    await supabase.from('f1_championship').insert({ season, kind: 'constructors', position: posOf(r), team_id: teamId, points: r.points ?? null, updated_at: now })
    n++
  }
  await log('standings', n)
  return { season, rows: n }
}

/* ------------------------------------------------------------------ */
/* Live                                                                */
/* ------------------------------------------------------------------ */

const MIN = 60 * 1000

async function syncLive() {
  const now = Date.now()
  const { data: races } = await supabase.from('f1_races').select('*')
    .neq('status', 'cancelled')
    .gte('race_at', new Date(now - 6 * 60 * MIN).toISOString())
    .lte('race_at', new Date(now + 3 * 24 * 60 * MIN).toISOString())

  const work: { id: string, sessions: Session[] }[] = []
  for (const r of races ?? []) {
    const due = SESSIONS.filter(d => {
      if (!r[d.at] || r[d.confirmed]) return false
      const t = +new Date(r[d.at])
      return now >= t - 10 * MIN && now <= t + d.hours * 60 * MIN
    }).map(d => d.s)
    if (due.length) work.push({ id: r.id, sessions: due })
  }

  // Once a day, bring the calendar's times up to date.
  const { data: lastTimes } = await supabase.from('f1_sync_log').select('ran_at').eq('kind', 'times').order('ran_at', { ascending: false }).limit(1)
  const { count: raceCount } = await supabase.from('f1_races').select('id', { count: 'exact', head: true }).eq('season', thisSeason())
  const timesDue = raceCount && (!lastTimes?.length || now - +new Date(lastTimes[0].ran_at) > 24 * 60 * MIN)

  if (!work.length && !timesDue) return { note: 'No F1 session in progress' }
  if (await quotaRemaining() < 10) { await log('live', 0, 'Daily quota reached'); return { skipped: 'Daily F1 API quota reached' } }

  const out: Record<string, unknown> = {}
  if (timesDue) out.times = await refreshTimes(thisSeason())
  for (const w of work) out[w.id] = await fetchResults(w.id, w.sessions)
  if (work.length) await log('live', work.length)
  return out
}

/* ------------------------------------------------------------------ */

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const mode = body.mode ?? 'live'
    const season = Number(body.season) || thisSeason()

    if (mode === 'live' || !['season', 'import', 'drivers', 'results', 'standings'].includes(mode)) {
      return json({ ok: true, ...(await syncLive()) })
    }

    const uid = await callerId(req)
    if (mode === 'season' || mode === 'import') {
      if (!await adminOf(uid, body.competition_id)) return json({ ok: false, error: 'Only this league\'s admin can add races.' })
      const r = mode === 'season' ? await listSeason(body.competition_id, season) : await importRaces(body.competition_id, season, body.race_ids)
      return json({ ok: !('error' in r), ...r })
    }
    if (mode === 'results') {
      if (!await adminOfRace(uid, body.race_id)) return json({ ok: false, error: 'Only a league admin can fetch results.' })
      const r = await fetchResults(body.race_id)
      await log('results', 1)
      return json({ ok: !('error' in r), ...r })
    }
    // drivers / standings: any signed-in admin of an F1 league.
    if (!uid) return json({ ok: false, error: 'Sign in first.' })
    const r = mode === 'drivers' ? await syncDrivers(season) : await syncStandings(season)
    return json({ ok: true, ...r })
  } catch (err) {
    await log('error', 0, String(err))
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) })
  }
})
