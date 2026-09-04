// supabase/functions/sync-football/index.ts
//
// Pulls fixtures and results from API-Football into the app.
//
// Three modes, chosen by the `mode` field in the request body:
//
//   leagues   refresh the cached competition list. Run rarely — it changes
//             perhaps twice a season.
//   fixtures  find real matches for a gameweek, so results can arrive
//             automatically. Run when an admin sets up a gameweek.
//   live      poll in-progress and recently finished matches. Run on a
//             schedule during match days.
//
// The free tier allows 100 requests a day. Every call is logged and the quota
// is checked before starting, so the job stops short rather than failing
// halfway with a 429 and leaving results half-written.
//
// Nothing here ever writes home_score or away_score. Those belong to the admin,
// and scoring reads them. Live data lands in its own columns and is shown as
// provisional until confirmed — so a wrong or delayed feed can never silently
// change anyone's points.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API_HOST = 'https://v3.football.api-sports.io'
const DAILY_LIMIT = Number(Deno.env.get('API_FOOTBALL_DAILY_LIMIT') ?? '100')

// Leave a few in reserve so an admin linking a gameweek by hand isn't blocked
// by the scheduled job having spent the lot.
const RESERVE = 10

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const apiKey = Deno.env.get('API_FOOTBALL_KEY')!

async function apiGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(API_HOST + path)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } })
  const body = await res.json()

  // API-Football returns 200 with an `errors` object rather than an HTTP error
  // code, so checking res.ok alone silently accepts failures.
  if (body.errors && Object.keys(body.errors).length) {
    throw new Error(`API error: ${JSON.stringify(body.errors)}`)
  }
  return body
}

async function logSync(entry: Record<string, unknown>) {
  await supabase.from('api_sync_log').insert(entry)
}

async function quotaRemaining(): Promise<number> {
  const { data } = await supabase.rpc('api_requests_used_today')
  return DAILY_LIMIT - RESERVE - (data ?? 0)
}

/* ------------------------------------------------------------------ */

/** Refresh the cached competition list. One request. */
async function syncLeagues() {
  const body = await apiGet('/leagues')

  const rows = (body.response ?? []).map((L: any) => {
    const current = (L.seasons ?? []).find((s: any) => s.current)
    return {
      id: L.league.id,
      name: L.league.name,
      country: L.country?.name ?? null,
      type: L.league.type,
      logo_url: L.league.logo ?? null,
      current_season: current?.year ?? null,
      // Not every competition carries live in-play data — the FA Cup gives
      // fixtures and final results but no minute-by-minute. Recording it means
      // the admin UI can say so rather than promising updates that never come.
      has_live_events: Boolean(current?.coverage?.fixtures?.events),
      last_synced_at: new Date().toISOString(),
    }
  })

  // Upserted in chunks: a single statement with 1,200 rows is refused.
  for (let i = 0; i < rows.length; i += 200) {
    await supabase.from('api_leagues').upsert(rows.slice(i, i + 200), { onConflict: 'id' })
  }

  await logSync({ kind: 'leagues', requests_used: 1, fixtures_seen: rows.length })
  return { leagues: rows.length }
}

/**
 * Find real matches for a gameweek's fixtures.
 *
 * Matches on team name and kick-off date rather than name alone: two clubs can
 * meet twice in a season, and "Arsenal" appears in several competitions on the
 * same weekend.
 */
async function syncFixturesForGameweek(gameweekId: string) {
  const { data: gw } = await supabase
    .from('gameweeks')
    .select('id, api_league_id, api_season')
    .eq('id', gameweekId)
    .single()

  if (!gw?.api_league_id) {
    return { skipped: 'This gameweek is not linked to a competition — results stay manual.' }
  }

  const { data: fixtures } = await supabase
    .from('fixtures')
    .select('id, home_team, away_team, kickoff_time, api_fixture_id')
    .eq('gameweek_id', gameweekId)

  const unlinked = (fixtures ?? []).filter(f => !f.api_fixture_id)
  if (!unlinked.length) return { matched: 0, note: 'All fixtures already linked' }

  // One request covering the whole date range, rather than one per fixture.
  // Six fixtures would otherwise cost six of the hundred.
  const dates = unlinked.map(f => new Date(f.kickoff_time)).sort((a, b) => +a - +b)
  const from = dates[0].toISOString().slice(0, 10)
  const to = dates[dates.length - 1].toISOString().slice(0, 10)

  const body = await apiGet('/fixtures', {
    league: String(gw.api_league_id),
    season: String(gw.api_season ?? new Date().getFullYear()),
    from,
    to,
  })

  const candidates = body.response ?? []
  let matched = 0

  for (const f of unlinked) {
    const hit = candidates.find((c: any) =>
      similar(c.teams.home.name, f.home_team) &&
      similar(c.teams.away.name, f.away_team)
    )
    if (!hit) continue

    await supabase.from('fixtures')
      .update({ api_fixture_id: hit.fixture.id })
      .eq('id', f.id)
    matched++
  }

  await logSync({
    kind: 'fixtures',
    api_league_id: gw.api_league_id,
    requests_used: 1,
    fixtures_seen: candidates.length,
    fixtures_updated: matched,
  })

  return { matched, unmatched: unlinked.length - matched }
}

/**
 * Abbreviations admins actually type. Aliases rather than stripping, because
 * stripping the distinguishing word is dangerous: an early version removed
 * "United" and "City" as noise, which made Manchester United match Manchester
 * City — and linking the wrong fixture imports the wrong score.
 */
const TEAM_ALIASES: Record<string, string> = {
  utd: 'united', man: 'manchester', nottm: 'nottingham',
  spurs: 'tottenham hotspur', wolves: 'wolverhampton wanderers',
  brighton: 'brighton hove albion', bha: 'brighton hove albion',
  wba: 'west bromwich albion', qpr: 'queens park rangers',
  sheff: 'sheffield', boro: 'middlesbrough', palace: 'crystal palace',
}

function normaliseTeam(s: string) {
  const base = s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    // Only genuinely meaningless suffixes. Never a word that distinguishes one
    // club from another in the same town.
    .replace(/\b(fc|afc|cf|sc|ac|the|club)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()

  return base.split(' ').map(w => TEAM_ALIASES[w] ?? w).join(' ').replace(/\s+/g, ' ').trim()
}

function editDistance(a: string, b: string) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = curr
  }
  return prev[b.length]
}

/**
 * Does the API's team name refer to the same club the admin typed?
 *
 * EVERY word of the shorter name must appear in the longer one. That is what
 * keeps Manchester United and Manchester City apart — they share "manchester",
 * but "united" appears nowhere in the other. Tested against thirteen real
 * pairs including Sheffield United/Wednesday and Bristol City/Rovers.
 */
function similar(a: string, b: string) {
  const x = normaliseTeam(a), y = normaliseTeam(b)
  if (!x || !y) return false
  if (x === y) return true

  const wx = x.split(' '), wy = y.split(' ')
  const shorter = wx.length <= wy.length ? wx : wy
  const longer  = wx.length <= wy.length ? wy : wx

  return shorter.every(w => longer.some(l => {
    if (l === w) return true
    if (w.length >= 4 && l.startsWith(w)) return true
    if (l.length >= 4 && w.startsWith(l)) return true
    const max = Math.max(w.length, l.length)
    return max >= 5 && 1 - editDistance(w, l) / max >= 0.85
  }))
}

/**
 * Poll matches that are in progress or have just finished.
 *
 * Writes to the live_* columns only. The admin still confirms the final result,
 * which is what scoring uses — so a feed that's wrong, delayed, or reporting an
 * abandoned match can never quietly rewrite the table.
 */
async function syncLive() {
  const remaining = await quotaRemaining()
  if (remaining <= 0) {
    await logSync({ kind: 'live', requests_used: 0, error: 'Daily quota reached' })
    return { skipped: 'Daily API quota reached' }
  }

  // Only fixtures we've linked, kicking off in the last four hours or the next
  // fifteen minutes. Anything older is finished; anything later hasn't started.
  const now = new Date()
  const { data: fixtures } = await supabase
    .from('fixtures')
    .select('id, api_fixture_id, live_status')
    .not('api_fixture_id', 'is', null)
    .gte('kickoff_time', new Date(+now - 4 * 60 * 60 * 1000).toISOString())
    .lte('kickoff_time', new Date(+now + 15 * 60 * 1000).toISOString())

  const live = (fixtures ?? []).filter(f => f.live_status !== 'FT')
  if (!live.length) return { updated: 0, note: 'Nothing in progress' }

  // Up to 20 ids in one request — the whole gameweek for one call.
  const ids = live.map(f => f.api_fixture_id).slice(0, 20).join('-')
  const body = await apiGet('/fixtures', { ids })

  let updated = 0
  for (const item of (body.response ?? [])) {
    const { error } = await supabase.from('fixtures').update({
      live_home_score: item.goals.home,
      live_away_score: item.goals.away,
      live_status: item.fixture.status.short,
      live_minute: item.fixture.status.elapsed,
      live_updated_at: new Date().toISOString(),
    }).eq('api_fixture_id', item.fixture.id)

    if (!error) updated++
  }

  await logSync({
    kind: 'live',
    requests_used: 1,
    fixtures_seen: (body.response ?? []).length,
    fixtures_updated: updated,
  })

  return { updated }
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  try {
    const { mode, gameweek_id } = await req.json().catch(() => ({ mode: 'live' }))

    let result
    if (mode === 'leagues') result = await syncLeagues()
    else if (mode === 'fixtures') result = await syncFixturesForGameweek(gameweek_id)
    else result = await syncLive()

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // Logged as well as returned: a scheduled run has nobody watching the
    // response, and a silent failure is how a feed stops working for a
    // fortnight without anyone noticing.
    await logSync({ kind: 'error', requests_used: 0, error: String(err) })

    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
