import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { scoreOnePrediction, resolvePointRules } from '../../../lib/scoring'
import { Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'

const ROUND_LABELS = { playoff:'Playoff', r64:'Round of 64', r32:'Round of 32', r16:'Round of 16', qf:'Quarter-finals', sf:'Semi-finals', f:'Final' }
// Bracket order, earliest round first — used to sort the rounds on screen and
// to work out which round a bye carries a participant into.
const ROUND_SEQUENCE = ['playoff', 'r64', 'r32', 'r16', 'qf', 'sf', 'f']

// One participant line. `showWinnerHighlight` is an explicit prop rather than
// something read from an enclosing scope — a completed REPLAY nested inside a
// still-unresolved parent match needs its own winner highlight, and reading the
// parent's status meant that highlight never rendered.
function ParticipantRow({ name, pts, isWinner, isMe, isLive, showWinnerHighlight }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5"
      style={{ background: showWinnerHighlight && isWinner ? 'var(--accent-dim)' : isMe ? 'rgba(79,142,247,0.06)' : '' }}>
      <span className="text-sm" style={{ color: 'var(--txt-primary)', fontWeight: isWinner ? 600 : 400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>
        {name || 'TBD'}{isMe && <span className="ml-1.5 text-xs font-normal" style={{ color:'var(--accent)' }}>(you)</span>}
      </span>
      {pts != null && (
        <span className="text-sm font-bold ml-2" style={{ color: isWinner ? 'var(--green)' : isLive ? 'var(--amber)' : 'var(--txt-second)', flexShrink:0 }}>
          {pts} pts{isLive && <span className="text-xs font-normal ml-1" style={{ opacity: 0.7 }}>so far</span>}
        </span>
      )}
    </div>
  )
}

const AmberBanner = ({ children, bold }) => (
  <div className="px-3 py-1.5" style={{ background:'var(--amber-dim)', borderTop:'0.5px solid var(--border)' }}>
    <span className="text-xs" style={{ color:'var(--amber)', fontWeight: bold ? 500 : 400 }}>{children}</span>
  </div>
)

// The two participant rows of a single leg — used for both the original match
// and each replay, so they render identically instead of the replay having its
// own slightly different copy of the logic.
function MatchLeg({ match, userId, livePts = {} }) {
  const isCompleted = match.status === 'completed'
  // Points written to the match by resolveBracketRound are shown WHENEVER they
  // exist, not only when status === 'completed'. A drawn match is set to
  // 'replay_scheduled' with its points stored, so gating on 'completed' hid the
  // very scores that explain why it was a draw.
  const hasStoredPts = match.home_points != null || match.away_points != null
  const homePts = hasStoredPts ? match.home_points : livePts[match.home_user_id]
  const awayPts = hasStoredPts ? match.away_points : livePts[match.away_user_id]

  return (
    <>
      <ParticipantRow
        name={match.home?.display_name}
        pts={homePts}
        isWinner={isCompleted && match.winner_user_id === match.home_user_id}
        isMe={match.home_user_id === userId}
        isLive={!hasStoredPts && homePts != null}
        showWinnerHighlight={isCompleted}
      />
      <div style={{ height: '0.5px', background: 'var(--border)' }}/>
      {match.away_user_id
        ? <ParticipantRow
            name={match.away?.display_name}
            pts={awayPts}
            isWinner={isCompleted && match.winner_user_id === match.away_user_id}
            isMe={match.away_user_id === userId}
            isLive={!hasStoredPts && awayPts != null}
            showWinnerHighlight={isCompleted}
          />
        : <div className="px-3 py-2.5 flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color:'var(--green)' }}>
              {match.home?.display_name} — Bye ✓
            </span>
            <span className="text-xs px-2 py-0.5 rounded" style={{ background:'var(--green-dim)', color:'var(--green)' }}>Advances</span>
          </div>
      }
    </>
  )
}

function MatchCard({ match, userId, roundLabel, livePtsByMatch = {}, gwNames = {} }) {
  // `replays` is a chain, oldest first — a second or third replay is possible
  // and each one needs to appear under the last.
  const replays = match.replays || []
  // Replays are named after the round they belong to ("Playoff replay"), so a
  // card read on its own still says which stage of the cup it decides.
  const replayLabel = i => `${roundLabel} replay ${i + 1}`

  return (
    // No bottom margin: the parent grid supplies gap-3, and having both made
    // the space between cards double the space the layout was designed for.
    <div className="rounded-md overflow-hidden" style={{ border: '0.5px solid var(--border-med)', background: 'var(--bg-surface)' }}>
      <MatchLeg match={match} userId={userId} livePts={livePtsByMatch[match.id] || {}} />
      {match.status === 'replay_scheduled' && <AmberBanner>Drawn — replay scheduled below</AmberBanner>}
      {replays.map((r, i) => (
        <div key={r.id}>
          {/* A replay has its own gameweek rather than the round's, so it's
              named on the replay row itself. */}
          <AmberBanner bold>
            {replayLabel(i)}
            {r.gameweek_id && gwNames[r.gameweek_id] &&
              <span className="font-normal" style={{ opacity: 0.85 }}> · decided on {gwNames[r.gameweek_id]}</span>}
          </AmberBanner>
          <MatchLeg match={r} userId={userId} livePts={livePtsByMatch[r.id] || {}} />
          {r.status !== 'completed' && !r.gameweek_id && (
            <AmberBanner>Awaiting a gameweek — an admin needs to assign one</AmberBanner>
          )}
          {r.status === 'replay_scheduled' && (
            <AmberBanner>
              {i === replays.length - 1 ? 'Still drawn — another replay needed' : 'Drawn — replay scheduled below'}
            </AmberBanner>
          )}
        </div>
      ))}
    </div>
  )
}

function GroupTable({ competitionId, userId }) {
  const [standings, setStandings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!competitionId) { setLoading(false); return }
    load()
  }, [competitionId])

  async function load() {
    // group_standings is a database VIEW, not a table — PostgREST's
    // automatic foreign-key embedding isn't reliable against views, so
    // fetch and merge the names separately instead.
    const { data: rows } = await supabase.from('group_standings').select('*').eq('competition_id', competitionId)
    const userIds = [...new Set((rows || []).map(r => r.user_id))]
    const { data: profs } = userIds.length ? await supabase.from('profiles').select('id, display_name').in('id', userIds) : { data: [] }
    const nameMap = {}; (profs || []).forEach(p => { nameMap[p.id] = p.display_name })
    const merged = (rows || []).map(r => ({ ...r, profiles: { display_name: nameMap[r.user_id] || 'Unknown' } }))
    const sorted = merged.sort((a,b) => b.league_points - a.league_points || b.points_diff - a.points_diff || b.points_for - a.points_for)
    setStandings(sorted); setLoading(false)
  }

  if (loading) return <div className="flex justify-center py-6"><Spinner /></div>
  if (!standings.length) return null

  return (
    <Card className="overflow-hidden p-0 mb-5">
      <p className="text-sm font-semibold p-4 pb-3" style={{ color: 'var(--txt-primary)' }}>Group table</p>
      <div className="overflow-x-auto">
        <table className="data-table w-full sm:min-w-[420px]">
          <thead><tr>
            <th style={{ paddingLeft: 14 }}>Participant</th>
            <th style={{ textAlign: 'right' }}>P</th>
            <th style={{ textAlign: 'right' }}>PF</th>
            <th style={{ textAlign: 'right' }}>PA</th>
            <th style={{ textAlign: 'right' }}>Diff</th>
            <th style={{ textAlign: 'right', paddingRight: 14 }}>Pts</th>
          </tr></thead>
          <tbody>
            {standings.map((s,i) => (
              <tr key={s.user_id} className={s.user_id === userId ? 'highlight' : ''}>
                <td style={{ paddingLeft: 14 }}>
                  <span className="text-sm" style={{ color: 'var(--txt-primary)' }}>
                    <span style={{ display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {i+1}. {s.profiles?.display_name}{s.user_id === userId && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--accent)' }}>(you)</span>}
                    </span>
                  </span>
                </td>
                <td className="text-xs text-right" style={{ color: 'var(--txt-second)' }}>{s.played}</td>
                <td className="text-xs text-right" style={{ color: 'var(--txt-second)' }}>{s.points_for}</td>
                <td className="text-xs text-right" style={{ color: 'var(--txt-second)' }}>{s.points_against}</td>
                <td className="text-xs text-right" style={{ color: s.points_diff >= 0 ? 'var(--green)' : 'var(--red)' }}>{s.points_diff > 0 ? '+' : ''}{s.points_diff}</td>
                <td style={{ textAlign: 'right', paddingRight: 14 }}><span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>{s.league_points}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function GroupFixturesList({ competitionId, userId }) {
  const [fixtures, setFixtures] = useState([])
  const [loading, setLoading] = useState(true)
  const [openRound, setOpenRound] = useState(null)
  const [livePoints, setLivePoints] = useState({}) // { [gameweekId]: { [userId]: pointsSoFar } }

  useEffect(() => {
    if (!competitionId) { setLoading(false); return }
    load()
  }, [competitionId])

  async function load() {
    const [{ data: fx }, rules] = await Promise.all([
      supabase.from('group_fixtures').select('*, home:home_user_id(display_name), away:away_user_id(display_name), gameweeks(number)')
        .eq('competition_id', competitionId).order('round_number'),
      resolvePointRules(supabase, competitionId),
    ])
    setFixtures(fx || [])
    setLoading(false)

    // Live "points so far" for any unresolved fixture — a running total
    // from whichever real fixtures in that gameweek already have a
    // result, purely for display. The official group result still only
    // locks in once the whole gameweek is marked completed.
    const liveGwIds = [...new Set((fx || []).filter(f => f.status !== 'completed' && f.gameweek_id).map(f => f.gameweek_id))]
    if (liveGwIds.length && rules) {
      const cache = {}
      for (const gwId of liveGwIds) {
        const [{ data: gwFixtures }, { data: preds }] = await Promise.all([
          supabase.from('fixtures').select('*').eq('gameweek_id', gwId).eq('status', 'completed'),
          supabase.from('predictions').select('*').eq('gameweek_id', gwId),
        ])
        const fxMap = {}; (gwFixtures || []).forEach(f => { fxMap[f.id] = f })
        const totals = {}
        for (const pred of (preds || [])) {
          const realFx = fxMap[pred.fixture_id]; if (!realFx) continue
          const { points } = scoreOnePrediction(pred, realFx, rules)
          totals[pred.user_id] = (totals[pred.user_id] || 0) + points
        }
        cache[gwId] = totals
      }
      setLivePoints(cache)
    }
  }

  if (loading) return <div className="flex justify-center py-6"><Spinner /></div>
  if (!fixtures.length) return null

  const rounds = [...new Set(fixtures.map(f => f.round_number))].sort((a,b) => a-b)

  return (
    <div className="mb-5">
      <SectionLabel className="mb-3">Group fixtures</SectionLabel>
      {rounds.map(rn => {
        const roundFixtures = fixtures.filter(f => f.round_number === rn)
        return (
          <div key={rn} className="mb-2">
            <button onClick={() => setOpenRound(openRound === rn ? null : rn)} className="text-xs flex items-center gap-1 py-1.5" style={{ color: 'var(--accent)' }}>
              <i className={`ti ti-chevron-${openRound === rn ? 'up' : 'down'} text-xs`} aria-hidden="true"/>
              Round {rn}{roundFixtures[0]?.gameweeks?.number && ` — ${roundFixtures[0].gameweeks.number}`}
            </button>
            {openRound === rn && roundFixtures.map(fx => {
              const isMe = fx.home_user_id === userId || fx.away_user_id === userId
              const live = fx.gameweek_id && livePoints[fx.gameweek_id]
              const isCompleted = fx.status === 'completed'
              return (
                <Card key={fx.id} className="p-4 mb-3" style={isMe ? { border: '1px solid var(--accent)' } : {}}>
                  <p className="text-base font-semibold" style={{ color:'var(--txt-primary)' }}>
                    {fx.home?.display_name} <span style={{ color:'var(--txt-muted)', fontWeight:400 }}>vs</span> {fx.away?.display_name}
                  </p>
                  <p className="text-xs mb-3" style={{ color:'var(--txt-muted)' }}>{fx.gameweeks?.number ? `GW: ${fx.gameweeks.number}` : 'No gameweek set yet'}</p>

                  {isCompleted ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-bold" style={{ color:'var(--green)' }}>Result: {fx.home_points}–{fx.away_points}</span>
                      <span className="text-xs font-medium px-2.5 py-1 rounded-md" style={{ background:'var(--accent-dim)', color:'var(--accent)' }}>
                        {fx.result === 'draw' ? 'Draw' : fx.result === 'home' ? `${fx.home?.display_name} wins` : `${fx.away?.display_name} wins`}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm" style={{ color:'var(--txt-second)' }}>
                        {fx.home?.display_name}: <strong style={{ color:'var(--txt-primary)' }}>{live?.[fx.home_user_id] || 0}pts so far</strong>
                      </span>
                      <span className="text-sm" style={{ color:'var(--txt-second)' }}>
                        {fx.away?.display_name}: <strong style={{ color:'var(--txt-primary)' }}>{live?.[fx.away_user_id] || 0}pts so far</strong>
                      </span>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** @param embedded  hides the competition selector when shown inside Standings. */
export default function Bracket({ embedded = false }) {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [rounds, setRounds] = useState([])
  const [liveKnockoutPts, setLiveKnockoutPts] = useState({}) // { matchId: { userId: pts } }
  const [gwNames, setGwNames] = useState({}) // { gameweekId: 'GW3' }
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (comp) load(); else setLoading(false) }, [comp])

  async function load() {
    setLoading(true)
    try {
      const { data: matches } = await supabase.from('bracket_matches')
        .select('*, home:home_user_id(display_name), away:away_user_id(display_name), winner:winner_user_id(display_name)')
        .eq('competition_id', comp).order('round_order')

      // Group matches by round, but exclude rounds where every match
      // is still an empty shell (both participants TBD) — these are
      // future rounds drawn in advance that shouldn't be visible yet.
      const all = matches || []
      const rm = {}
      all.forEach(m => {
        if (m.is_replay) return // replays are attached to their parent match below
        if (!rm[m.round]) rm[m.round] = []
        // Collect EVERY replay of this matchup, oldest first. The previous
        // .find() returned only the first, so if a replay was itself drawn the
        // follow-up replay never appeared at all. Home/away can be listed
        // either way round, so match the pair in both orders.
        const replays = all
          .filter(r => r.is_replay && r.round === m.round && (
            (r.home_user_id === m.home_user_id && r.away_user_id === m.away_user_id) ||
            (r.home_user_id === m.away_user_id && r.away_user_id === m.home_user_id)
          ))
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        rm[m.round].push({ ...m, replays })
      })

      // Only include a round if at least one match has both participants known,
      // then put the rounds in actual bracket order — the query is sorted by
      // round_order, which orders matches WITHIN a round and says nothing about
      // which round comes first.
      const visibleRounds = Object.entries(rm)
        .filter(([, ms]) => ms.some(m => m.home_user_id && m.away_user_id))
        .map(([round, ms]) => ({ round, matches: ms }))
        .sort((a, b) => {
          const ia = ROUND_SEQUENCE.indexOf(a.round), ib = ROUND_SEQUENCE.indexOf(b.round)
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
        })

      // Byes. A participant who appears in the NEXT round without having played
      // in this one went through on a bye. (A bye stored as a one-sided match
      // still renders inline in the bracket; this catches participants seeded
      // straight into the later round, which is the common case.)
      const nameOf = uid => {
        for (const m of all) {
          if (m.home_user_id === uid && m.home?.display_name) return m.home.display_name
          if (m.away_user_id === uid && m.away?.display_name) return m.away.display_name
        }
        return 'Unknown'
      }
      visibleRounds.forEach((r, i) => {
        const next = visibleRounds[i + 1]
        r.nextRoundLabel = next ? (ROUND_LABELS[next.round] || next.round) : null
        r.byes = []
        if (!next) return
        const playedHere = new Set()
        r.matches.forEach(m => {
          ;[m.home_user_id, m.away_user_id].forEach(u => u && playedHere.add(u))
          ;(m.replays || []).forEach(rp => [rp.home_user_id, rp.away_user_id].forEach(u => u && playedHere.add(u)))
        })
        const seen = new Set()
        next.matches.forEach(m => {
          ;[m.home_user_id, m.away_user_id].forEach(uid => {
            if (!uid || playedHere.has(uid) || seen.has(uid)) return
            seen.add(uid)
            r.byes.push({ user_id: uid, name: nameOf(uid) })
          })
        })
      })

      // Which gameweek(s) decide each round. Held in state as well as used for
      // live points, because participants need to see it — a cup round has
      // nothing to predict on its own screen, so the gameweek it's settled on is
      // the only actionable detail on the page.
      const { data: roundGws } = await supabase.from('bracket_round_gameweeks')
        .select('round, gameweek_id').eq('competition_id', comp)
      const roundGwMap = {}
      ;(roundGws || []).forEach(r => { (roundGwMap[r.round] = roundGwMap[r.round] || []).push(r.gameweek_id) })

      const wantedGwIds = [...new Set([
        ...(roundGws || []).map(r => r.gameweek_id),
        ...all.map(m => m.gameweek_id),
      ].filter(Boolean))]
      const { data: gwRows } = wantedGwIds.length
        ? await supabase.from('gameweeks').select('id, number').in('id', wantedGwIds)
        : { data: [] }
      const names = {}; (gwRows || []).forEach(g => { names[g.id] = g.number })
      setGwNames(names)

      visibleRounds.forEach(r => {
        // A round's gameweek can be set two ways: once for the whole round, or
        // individually on each tie. Only the round mapping was read here, so a
        // round whose ties each carry their own gameweek showed "Gameweek TBC"
        // even after every one of them had been played and decided.
        const fromRound = (roundGwMap[r.round] || [])

        const fromMatches = [...new Set(
          (r.matches || []).map(m => m.gameweek_id).filter(Boolean)
        )]

        // Prefer the round mapping when it exists — it's the admin's explicit
        // statement about the round. Fall back to whatever the ties say.
        const ids = fromRound.length ? fromRound : fromMatches

        r.gwLabel = ids.map(id => names[id]).filter(Boolean).join(', ') || null
      })

      setRounds(visibleRounds)

      // Live points for unresolved matches. Scores are fetched by gameweek_id
      // only, with no competition_id filter, since Carabao Test scores are
      // stored under ALOTO's competition_id not Carabao Test's.
      //
      // These are keyed BY MATCH. Previously they were totalled per user across
      // every gameweek in play and the same figure shown on all of that user's
      // matches, so a participant in two unresolved matches saw their combined
      // total on both — a number that matched neither match.
      // A replay is decided on its own assigned gameweek; an ordinary match on
      // the round's shared gameweeks.
      const gwIdsFor = m => m.gameweek_id ? [m.gameweek_id] : (m.is_replay ? [] : (roundGwMap[m.round] || []))

      const unresolved = all.filter(m => m.status !== 'completed' && m.home_user_id && m.away_user_id)
      const gwIds = [...new Set(unresolved.flatMap(gwIdsFor))]
      if (gwIds.length) {
        const userIds = [...new Set(unresolved.flatMap(m => [m.home_user_id, m.away_user_id]).filter(Boolean))]
        const { data: scores } = await supabase.from('gameweek_scores').select('user_id, gameweek_id, points').in('gameweek_id', gwIds).in('user_id', userIds)
        // Keep the max points per user+gameweek (the same score may exist under
        // multiple competition_ids).
        const bestPerGw = {} // { 'userId:gwId': maxPts }
        for (const s of (scores || [])) {
          const key = `${s.user_id}:${s.gameweek_id}`
          bestPerGw[key] = Math.max(bestPerGw[key] ?? -Infinity, s.points || 0)
        }
        const byMatch = {} // { matchId: { userId: pts } }
        for (const m of unresolved) {
          const ids = gwIdsFor(m)
          if (!ids.length) continue
          const tally = {}
          for (const uid of [m.home_user_id, m.away_user_id]) {
            let sum = null
            for (const g of ids) {
              const v = bestPerGw[`${uid}:${g}`]
              if (v != null) sum = (sum ?? 0) + v
            }
            // Left undefined when there's no score row at all, so an unplayed
            // match shows nothing rather than a misleading "0 pts so far".
            if (sum != null) tally[uid] = sum
          }
          byMatch[m.id] = tally
        }
        setLiveKnockoutPts(byMatch)
      }
    } finally { setLoading(false) }
  }

  return (
    <div>
      {!embedded && <CompetitionSelector value={comp} onChange={setComp} excludeFormats={['league']} />}
      <GroupTable competitionId={comp} userId={user?.id} />
      <GroupFixturesList competitionId={comp} userId={user?.id} />
      {loading ? <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        : rounds.length === 0 ? <EmptyState icon="ti-tournament" title="No cup competition yet" description="The admin will set up the knockout draw when the cup stage begins" />
        : <>
          <div className="mb-4 p-3 rounded-md text-xs" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}>
            <span style={{ color: 'var(--txt-second)' }}>Matchups are decided automatically by prediction points earned in the gameweek(s) assigned to each round — no separate prediction needed here.</span>
          </div>
          {rounds.map(({ round, matches, byes, nextRoundLabel, gwLabel }) => (
            <div key={round} className="mb-5">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <SectionLabel>{ROUND_LABELS[round] || round}</SectionLabel>
                {/* The gameweek this round is settled on. There's nothing to
                    predict on this screen, so this is what tells a participant
                    where their cup points are actually coming from. */}
                {gwLabel
                  ? <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Decided on {gwLabel}</span>
                  : <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--txt-muted)' }}>Gameweek TBC</span>}
              </div>
              {/* items-start: without it, a short card in the same row as a
                  tall one (a match with replays) stretches and gains dead
                  space under its last row. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                {matches.map(m => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    userId={user?.id}
                    roundLabel={ROUND_LABELS[round] || round}
                    livePtsByMatch={liveKnockoutPts}
                    gwNames={gwNames}
                  />
                ))}
              </div>
              {byes?.length > 0 && (
                <div className="mt-3 px-3 py-2 rounded-md" style={{ background: 'var(--green-dim)', border: '0.5px solid var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--green)' }}>
                    Bye to {nextRoundLabel}: {byes.map(b => b.name).join(', ')}
                  </span>
                </div>
              )}
            </div>
          ))}
        </>
      }
    </div>
  )
}
