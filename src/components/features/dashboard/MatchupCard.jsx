import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../ui'
import Shirt, { PlayerMark } from '../../ui/Shirt'
import { effectiveScore, isInPlay } from '../../../lib/livePoints'
import { resolvePointRules, defaultRules, scoreOnePrediction } from '../../../lib/scoring'
import { FormChips } from '../lms/LmsStats'
import { format } from 'date-fns'

/**
 * The head-to-head card at the top of the dashboard.
 *
 * Shows whichever is more interesting:
 *
 *   A CUP TIE, when there is one this gameweek — your kit and points against
 *   your opponent's, which is the thing you actually care about on a Saturday.
 *   Every OTHER tie in the same round sits behind it, one swipe away, because
 *   on a Saturday afternoon the rest of the round is half the interest: you
 *   want to know whether the person above you is getting beaten.
 *
 *   THE LAST GAMEWEEK, otherwise — what you scored, how far you moved, and who
 *   topped it. A plain league has no opponent, and a lone number with nothing
 *   to compare it against tells you very little.
 *
 * Polls while matches are in play so the numbers move as goals go in. Stops
 * polling the moment nothing is live, because a dashboard quietly hitting the
 * database every forty-five seconds all week is a waste of everyone's battery.
 */
export default function MatchupCard({ competitionId, userId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!competitionId || !userId) return
    let cancelled = false
    let timer

    async function load() {
      try {
        const next = await build(competitionId, userId)
        if (cancelled) return
        setData(next)
        setLoading(false)

        // 45 seconds while something is in play; otherwise stop entirely and
        // wait for the next mount.
        if (next?.live) timer = setTimeout(load, 45000)
      } catch (err) {
        console.warn('Matchup card failed:', err?.message || err)
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [competitionId, userId])

  if (loading || !data) return null

  const others = data.otherTies?.length
    ? <OtherTies ties={data.otherTies} gameweek={data.gameweek} live={data.live}/>
    : null

  /* ---- Cup tie ---- */
  if (data.kind === 'tie') {
    const { ties, gameweek, competitionName, roundLabel, live, inPlayCount, fromOtherCompetition } = data

    return (
      <>
      <Card className="p-0 mb-3 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5"
          style={{ borderBottom: '1px solid var(--border)' }}>
          {live && <span className="live-dot" aria-hidden="true"/>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--txt-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {competitionName}
            </p>
            {fromOtherCompetition && (
              <p style={{ fontSize: 10, color: 'var(--txt-muted)', marginTop: 1 }}>
                Scored from this gameweek
              </p>
            )}
          </div>
          <span className="text-xs font-bold px-2 py-0.5 rounded" style={{
            flexShrink: 0,
            ...(live
              ? { background: 'var(--amber-dim)', color: 'var(--amber)' }
              : { background: 'var(--bg-elevated)', color: 'var(--txt-muted)' }),
          }}>
            {gameweek}{live ? ` · ${inPlayCount} LIVE` : ''}
          </span>
        </div>

        <TieSwiper ties={ties} roundLabel={roundLabel}/>
      </Card>
      {others}
      </>
    )
  }

  /* ---- League summary ---- */
  const { gameweek, competitionName, myPoints, position, playerCount, movement, best,
          live, inPlayCount, settled, started, progress, firstKickoff } = data

  // Three states, not two. FINAL only once every fixture that counts has a
  // result; part-played shows how far through it is; a gameweek nobody has
  // played yet gets its number and nothing else.
  const badge = live     ? ` · ${inPlayCount} LIVE`
              : settled  ? ' FINAL'
              : started  ? ` · ${progress.played}/${progress.total}`
              : ''

  return (
    <>
    <Card className="p-0 mb-3 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5"
        style={{ borderBottom: '1px solid var(--border)' }}>
        {live && <span className="live-dot" aria-hidden="true"/>}
        <p className="text-xs font-semibold flex-1" style={{ color: 'var(--txt-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {competitionName}
        </p>
        <span className="text-xs font-bold px-2 py-0.5 rounded"
          style={live
            ? { background: 'var(--amber-dim)', color: 'var(--amber)' }
            : { background: 'var(--bg-elevated)', color: 'var(--txt-muted)' }}>
          {gameweek}{badge}
        </span>
      </div>

      <div className="flex items-center px-3.5 py-3.5">
        <Stat value={started ? myPoints : '—'}
          label={!started
            ? (firstKickoff ? `Kicks off ${format(new Date(firstKickoff), 'EEE HH:mm')}` : 'Not started')
            : settled ? 'Your points' : 'Points so far'}/>

        <Stat
          value={movement === 0 || movement == null
            ? (position ? `#${position}` : '—')
            : `${movement > 0 ? '▲' : '▼'}${Math.abs(movement)}`}
          // Green for climbing, red for falling, plain when static. Movement is
          // the bit people look for.
          colour={movement > 0 ? 'var(--green)' : movement < 0 ? 'var(--red)' : undefined}
          label={position ? `#${position} of ${playerCount}` : ''}
        />

        {best && <Stat value={best.points} label={`Best — ${best.name}`} muted/>}
      </div>
    </Card>
    {others}
    </>
  )
}

/**
 * Your ties in other competitions this gameweek: one small row each, under
 * the main card. The cup itself still shows the full head-to-head.
 */
function OtherTies({ ties, gameweek, live }) {
  return (
    <Card className="p-0 mb-3 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
        {live && <span className="live-dot" aria-hidden="true"/>}
        <p className="text-[11px] font-semibold uppercase tracking-wide flex-1" style={{ color: 'var(--txt-muted)' }}>
          {ties.length === 1 ? 'Your cup tie' : 'Your cup ties'}
        </p>
        <span className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>{gameweek}</span>
      </div>
      {ties.map((t, i) => (
        <div key={t.id} className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ borderTop: i ? '0.5px solid var(--border)' : 'none' }}>
          <div className="flex-1" style={{ minWidth: 0 }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.competitionName}</p>
            <p className="text-[11px]" style={{ color: 'var(--txt-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.roundLabel} · v {t.opponentName}</p>
          </div>
          <span className="font-bold text-lg" style={{ color: t.mine >= t.theirs ? 'var(--txt-primary)' : 'var(--txt-second)' }}>{t.mine}</span>
          <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>–</span>
          <span className="font-bold text-lg" style={{ color: t.theirs >= t.mine ? 'var(--txt-primary)' : 'var(--txt-second)' }}>{t.theirs}</span>
          <PlayerMark kit={t.opponentKit} displayName={t.opponentName} size={22}/>
        </div>
      ))}
    </Card>
  )
}

/**
 * The round, one tie per page, yours first.
 *
 * A plain scroll container with CSS snap points rather than a carousel
 * library: it is a horizontal list, the platform already knows how to flick
 * through one with the right momentum and rubber-banding, and anything
 * hand-rolled here would feel worse on a phone than what iOS does for free.
 *
 * With a single tie it renders exactly as it always did — no dots, nothing to
 * swipe, no hint that anything changed.
 */
function TieSwiper({ ties, roundLabel }) {
  const [index, setIndex] = useState(0)
  const trackRef = useRef(null)

  // Which page is in view. Read off scroll position rather than tracked in a
  // gesture handler, so it stays right however the scroll happened — flick,
  // drag, or a trackpad on the web build.
  function onScroll() {
    const el = trackRef.current
    if (!el || !el.clientWidth) return
    const next = Math.round(el.scrollLeft / el.clientWidth)
    if (next !== index) setIndex(next)
  }

  function goTo(i) {
    const el = trackRef.current
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <>
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="swipe-track"
        style={{
          display: 'flex',
          overflowX: ties.length > 1 ? 'auto' : 'hidden',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {ties.map(tie => (
          <div key={tie.id} style={{ flex: '0 0 100%', scrollSnapAlign: 'start' }}>
            <div className="flex items-center gap-2 px-3.5 py-4">
              <Side player={tie.left}  highlight={tie.left.points >= tie.right.points}/>
              <span className="text-xs" style={{ color: 'var(--txt-muted)', letterSpacing: '0.1em', flexShrink: 0 }}>
                {roundLabel || 'VS'}
              </span>
              <Side player={tie.right} highlight={tie.right.points >= tie.left.points}/>
            </div>
          </div>
        ))}
      </div>

      {ties.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-2.5" style={{ marginTop: -4 }}>
          {ties.map((tie, i) => (
            <button
              key={tie.id}
              onClick={() => goTo(i)}
              aria-label={tie.isMine ? 'Your tie' : `Tie ${i + 1}`}
              style={{
                width: i === index ? 14 : 5, height: 5, borderRadius: 3, padding: 0, border: 0,
                background: i === index ? 'var(--txt-second)' : 'var(--border-med)',
                transition: 'width 160ms ease, background 160ms ease',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}

/** One side of a head to head. */
function Side({ player, highlight }) {
  return (
    <div className="flex-1 text-center" style={{ minWidth: 0 }}>
      <div className="flex justify-center mb-1.5">
        <PlayerMark kit={player.kit} displayName={player.name} size={34}/>
      </div>
      <p className="font-bold" style={{
        fontSize: 30, lineHeight: 1, letterSpacing: '-0.02em',
        color: highlight ? 'var(--txt-primary)' : 'var(--txt-second)',
      }}>
        {player.points}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-second)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {player.name}
      </p>
      {player.form?.length > 0 && (
        <div className="flex justify-center mt-1.5"><FormChips form={player.form}/></div>
      )}
      {player.record && (
        <p style={{ fontSize: 10, color: 'var(--txt-muted)', marginTop: 2 }}>{player.record}</p>
      )}
    </div>
  )
}

function Stat({ value, label, colour, muted }) {
  return (
    <div className="flex-1 text-center" style={{ minWidth: 0 }}>
      <p className="font-bold" style={{
        fontSize: muted ? 24 : 30, lineHeight: 1, letterSpacing: '-0.02em',
        color: colour || (muted ? 'var(--txt-second)' : 'var(--txt-primary)'),
      }}>
        {value}
      </p>
      <p className="text-xs mt-1.5" style={{ color: 'var(--txt-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** Works out what this card should show. */
async function build(competitionId, userId) {
  const { data: comp } = await supabase.from('competitions')
    .select('name').eq('id', competitionId).single()

  // The gameweek to report on: the active one if there is one, otherwise the
  // most recently completed. A dashboard between gameweeks should show the last
  // result, not nothing.
  const { data: links } = await supabase.from('competition_gameweeks')
    .select('gameweek_id').eq('competition_id', competitionId)

  const ids = (links || []).map(l => l.gameweek_id)
  if (!ids.length) return null

  const { data: gws } = await supabase.from('gameweeks')
    .select('id, number, status').in('id', ids)

  // Put the gameweeks in order FIRST, lowest to highest.
  //
  // This used to take the rows in whatever order the database handed them back
  // and pick the last completed one. With no ORDER BY that order is not
  // guaranteed; a gameweek that has been updated more recently (recalculated,
  // say) can come back last. That is how the card stayed on GW7 after GW8 had
  // been completed.
  //
  // Sorted on the digits in the number, so it works whether the number is
  // stored as 8 or as "GW8", and GW10 sorts after GW9 rather than before it.
  const gwOrder = g => parseInt(String(g.number ?? '').replace(/\D/g, ''), 10) || 0
  const ordered = [...(gws || [])].sort((a, b) => gwOrder(a) - gwOrder(b))

  const gw = [...ordered].reverse().find(g => g.status === 'active')
    || [...ordered].reverse().find(g => g.status === 'completed')
  if (!gw) return null

  const [{ data: fixtures }, rules] = await Promise.all([
    supabase.from('fixtures')
      .select('id, status, kickoff_time, home_score, away_score, live_home_score, live_away_score, live_status')
      .eq('gameweek_id', gw.id),
    resolvePointRules(supabase, competitionId),
  ])

  const activeRules = rules || defaultRules()
  const inPlayCount = (fixtures || []).filter(isInPlay).length
  const live = inPlayCount > 0

  // How far through the gameweek are we?
  //
  // This used to be a two-way switch: something kicking off right now, or
  // "FINAL". Nothing in play before a ball is kicked reads exactly the same as
  // nothing in play after the last whistle, so a gameweek that had not started
  // was labelled FINAL — with everyone on nought, because nothing had happened
  // yet.
  //
  // Voided fixtures are left out of the count: they are not going to produce a
  // result, so waiting for one would mean the gameweek never reads as finished.
  const FINISHED = ['FT', 'AET', 'PEN']
  const counted = (fixtures || []).filter(f => f.status !== 'void')
  const played = counted.filter(f =>
    (f.home_score != null && f.away_score != null) || FINISHED.includes(f.live_status))

  const settled = counted.length > 0 && played.length === counted.length
  const started = played.length > 0 || live
  const progress = { played: played.length, total: counted.length }
  // Before a ball is kicked, say when the first one is, rather than a bare
  // "Not started" that reads as if the gameweek isn't open.
  const firstKickoff = counted.map(f => f.kickoff_time).filter(Boolean).sort()[0] || null

  // Every cup tie or group fixture this player has in this gameweek. The one
  // belonging to the competition on screen gets the big card; ties in other
  // competitions (a cup scored from the league's gameweek) show smaller,
  // underneath, so the Dashboard the app opens on always has them.
  const allTies = await myTies(gw.id)
  const opponent = allTies.find(t => t.competition_id === competitionId) || null
  const otherTies = await compactTies(allTies.filter(t => t !== opponent), gw.id, userId, fixtures)

  if (opponent?.opponent_id) {
    const [stored, liveMine, liveTheirs, meProfile] = await Promise.all([
      storedTiePoints(opponent, gw.id, userId),
      pointsFor(gw.id, userId, fixtures, activeRules),
      pointsFor(gw.id, opponent.opponent_id, fixtures, activeRules),
      supabase.from('profiles').select('display_name, badge_kit').eq('id', userId).single(),
    ])

    // Stored points win once the gameweek has been scored.
    //
    // pointsFor adds up fixtures one at a time, which can only ever see
    // per-prediction scoring. Full house bonuses and triple points are awarded
    // at GAMEWEEK level, so they are invisible to it — which is why this card
    // said 12 where the real result was 27.
    //
    // The scored fixture already holds the true total, bonuses included. Live
    // figures are still used mid-match, when nothing has been stored yet.
    const mine   = stored?.mine   ?? liveMine
    const theirs = stored?.theirs ?? liveTheirs

    // Your own tie, always. Everything else in the round is added to it below
    // and is allowed to fail without taking the card down with it.
    const myTie = {
      id: 'mine',
      isMine: true,
      left:  { uid: userId, name: meProfile.data?.display_name ?? 'You', kit: meProfile.data?.badge_kit, points: mine },
      right: { uid: opponent.opponent_id, name: opponent.opponent_name, kit: opponent.opponent_kit, points: theirs },
    }

    const ties = await roundTies(opponent, gw.id, userId, fixtures, activeRules, myTie)

    // Each player's last five results in this cup, under their name.
    const forms = await playerForms(opponent.competition_id || competitionId)
    ties.forEach(t => {
      t.left.form = forms.get(t.left.uid) || []
      t.right.form = forms.get(t.right.uid) || []
    })

    return {
      kind: 'tie',
      // The tie's OWN competition, not the one on screen. A cup runs on another
      // competition's gameweeks, so the Champions League tie is decided by the
      // Predictions League's fixtures — labelling it with whatever happened to
      // be selected was simply wrong.
      competitionName: opponent.competition_name || comp?.name || '',
      // True when the tie belongs elsewhere. Worth saying out loud rather than
      // letting someone wonder why their league has a cup round in it.
      fromOtherCompetition: !!opponent.competition_id && opponent.competition_id !== competitionId,
      gameweek: gw.number,
      roundLabel: opponent.round_label,
      live, inPlayCount,
      ties,
      otherTies,
    }
  }

  /* ---- No tie: summarise the league ---- */
  const { data: parts } = await supabase.from('participants')
    .select('user_id, profiles(display_name)').eq('competition_id', competitionId)

  const scores = await Promise.all(
    (parts || []).map(async p => ({
      userId: p.user_id,
      name: p.profiles?.display_name ?? '',
      points: await pointsFor(gw.id, p.user_id, fixtures, activeRules),
    }))
  )

  scores.sort((a, b) => b.points - a.points)
  const mine = scores.find(s => s.userId === userId)

  // Competition ranking: everyone on the same points shares a place, rather
  // than indexOf handing out 1st through 12th by whatever order the rows
  // arrived in. Two people tied on 14 are both 3rd, not 3rd and 4th.
  const ahead = mine ? scores.filter(s => s.points > mine.points).length : 0
  const tiedWithMe = mine ? scores.filter(s => s.points === mine.points).length : 0

  // A position means nothing before the gameweek has produced any points, and
  // nothing when the entire league is level — which is the same thing seen from
  // the other end. Showing "#9 of 12" off a twelve-way tie on nought is how
  // this card claimed someone had fallen seven places without a ball kicked.
  const everyoneLevel = tiedWithMe === scores.length
  const position = mine && started && !everyoneLevel ? ahead + 1 : null

  // Movement is measured against the standing BEFORE this gameweek, which is
  // the season total minus this week's points — cheaper and more reliable than
  // recomputing a historical table.
  let movement = null
  const { data: totals } = await supabase.from('gameweek_scores')
    .select('user_id, points').eq('competition_id', competitionId)

  if (totals?.length) {
    const before = {}
    totals.forEach(t => { before[t.user_id] = (before[t.user_id] || 0) + t.points })
    scores.forEach(s => { before[s.userId] = (before[s.userId] || 0) - s.points })

    // The same shared-place rule as above, or the comparison would be against
    // an arbitrary previous position and the arrow would be wrong by however
    // far the tie-break happened to put them.
    const myBefore = mine ? (before[mine.userId] || 0) : 0
    const prevPos = mine ? Object.entries(before)
      .filter(([, pts]) => pts > myBefore).length + 1 : null

    if (prevPos && position) movement = prevPos - position
  }

  return {
    kind: 'league',
    competitionName: comp?.name ?? '',
    gameweek: gw.number,
    live, inPlayCount, settled, started, progress, firstKickoff,
    myPoints: mine?.points ?? 0,
    position,
    playerCount: scores.length,
    movement,
    otherTies,
    // Nobody is "best" on a gameweek nobody has played. A name against a zero
    // reads as a result when it is just the first row of a tie.
    best: started && scores[0] && scores[0].userId !== userId && scores[0].points > 0
      ? { name: scores[0].name.split(' ')[0], points: scores[0].points }
      : null,
  }
}

/**
 * Every tie in this round, yours first.
 *
 * Deliberately forgiving: if the round can't be read for any reason — a
 * knockout table shaped differently, a competition that doesn't record its
 * gameweek, a row-level rule that hides other people's ties — it returns just
 * your own tie and the card carries on exactly as it did before. The rest of
 * the round is a nice-to-have, and it should never be able to take the main
 * thing off the dashboard.
 *
 * Points come from the same two sources as your own tie: what the gameweek
 * scored, falling back to adding up fixtures while a match is still on.
 */
async function roundTies(opponent, gameweekId, userId, fixtures, rules, myTie) {
  const table = opponent.kind === 'knockout' ? 'bracket_matches' : 'group_fixtures'

  try {
    let q = supabase.from(table)
      .select('id, home_user_id, away_user_id, home_points, away_points, home:home_user_id(display_name, badge_kit), away:away_user_id(display_name, badge_kit)')
      .eq('gameweek_id', gameweekId)

    if (opponent.competition_id) q = q.eq('competition_id', opponent.competition_id)

    const { data: rows, error } = await q
    if (error || !rows?.length) return [myTie]

    // Both players of every tie, so provisional points can be worked out for
    // the whole round in ONE query rather than one per person. Twelve players
    // polling every forty-five seconds is the difference between one request
    // and twelve.
    const everyone = [...new Set(
      rows.flatMap(r => [r.home_user_id, r.away_user_id]).filter(Boolean)
    )]
    const livePoints = await livePointsFor(gameweekId, everyone, fixtures, rules)

    const sideFor = (uid, profile, stored) => ({
      uid,
      name: profile?.display_name ?? '',
      kit: profile?.badge_kit,
      // Stored wins once scored, because only it carries the gameweek bonuses.
      points: stored ?? livePoints.get(uid) ?? 0,
    })

    const built = rows
      // A bye, or a knockout slot still waiting on a qualifier, has nobody to
      // show on one side of it.
      .filter(r => r.home_user_id && r.away_user_id)
      .map(r => {
        const iAmHome = r.home_user_id === userId
        const iAmAway = r.away_user_id === userId
        const home = sideFor(r.home_user_id, r.home, r.home_points)
        const away = sideFor(r.away_user_id, r.away, r.away_points)

        return {
          id: r.id,
          isMine: iAmHome || iAmAway,
          // Your own tie reads with you on the left, however the draw was made.
          // Everyone else's keeps the draw's own order.
          left:  iAmAway ? away : home,
          right: iAmAway ? home : away,
        }
      })

    const mine = built.filter(t => t.isMine)
    const rest = built.filter(t => !t.isMine)
    if (!mine.length) return [myTie, ...rest]

    return [...mine, ...rest]
  } catch {
    return [myTie]
  }
}

/**
 * Every player's last five results in a cup, oldest first: group fixtures,
 * then knockout ties, finished ones only. W/D/L from the player's side, the
 * same chips Last Man Standing uses for teams. Never throws: no form is
 * better than no card.
 */
async function playerForms(competitionId) {
  const forms = new Map()
  try {
    const [{ data: group }, { data: ko }] = await Promise.all([
      supabase.from('group_fixtures')
        .select('home_user_id, away_user_id, home_points, away_points, result, round_number, home:home_user_id(display_name), away:away_user_id(display_name)')
        .eq('competition_id', competitionId).eq('status', 'completed'),
      supabase.from('bracket_matches')
        .select('home_user_id, away_user_id, home_points, away_points, winner_user_id, round_order, is_replay, created_at, home:home_user_id(display_name), away:away_user_id(display_name)')
        .eq('competition_id', competitionId).eq('status', 'completed'),
    ])
    const games = [
      ...(group || []).sort((a, b) => a.round_number - b.round_number).map(g => ({
        ...g, winner: g.result === 'home' ? g.home_user_id : g.result === 'away' ? g.away_user_id : null,
      })),
      ...(ko || []).sort((a, b) => a.round_order - b.round_order || (a.is_replay ? 1 : 0) - (b.is_replay ? 1 : 0))
        .map(k => ({ ...k, winner: k.winner_user_id })),
    ]
    games.forEach(g => {
      if (!g.home_user_id || !g.away_user_id) return
      ;[[g.home_user_id, true], [g.away_user_id, false]].forEach(([uid, home]) => {
        const mine = home ? g.home_points : g.away_points
        const theirs = home ? g.away_points : g.home_points
        const res = g.winner ? (g.winner === uid ? 'W' : 'L') : 'D'
        const list = forms.get(uid) || []
        list.push({ res, home, score: `${mine ?? 0}-${theirs ?? 0}`, opp: (home ? g.away : g.home)?.display_name || '' })
        forms.set(uid, list)
      })
    })
    forms.forEach((list, uid) => forms.set(uid, list.slice(-5)))
  } catch { /* no form */ }
  return forms
}

/** Provisional points for several people at once. */
async function livePointsFor(gameweekId, userIds, fixtures, rules) {
  const out = new Map()
  if (!userIds.length) return out

  const { data: preds } = await supabase.from('predictions')
    .select('user_id, fixture_id, predicted_home, predicted_away')
    .eq('gameweek_id', gameweekId).in('user_id', userIds)

  const byUser = new Map()
  for (const p of (preds || [])) {
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, [])
    byUser.get(p.user_id).push(p)
  }

  for (const id of userIds) out.set(id, totalFor(byUser.get(id) || [], fixtures, rules))
  return out
}

/** Adds up one person's predictions against the scores so far. */
function totalFor(preds, fixtures, rules) {
  let total = 0
  for (const fx of (fixtures || [])) {
    if (fx.status === 'void') continue
    const score = effectiveScore(fx)
    if (!score) continue

    const p = preds.find(x => x.fixture_id === fx.id)
    if (!p) continue

    total += scoreOnePrediction(
      { predicted_home: p.predicted_home, predicted_away: p.predicted_away },
      { home_score: score.home, away_score: score.away },
      rules,
    ).points
  }
  return total
}

/** One person's provisional points for a gameweek. */
async function pointsFor(gameweekId, userId, fixtures, rules) {
  const { data: preds } = await supabase.from('predictions')
    .select('fixture_id, predicted_home, predicted_away')
    .eq('gameweek_id', gameweekId).eq('user_id', userId)

  return totalFor(preds || [], fixtures, rules)
}

/**
 * Every tie this player has in the gameweek, across all their competitions.
 * Uses my_gameweek_ties (138); before that has been run, falls back to the
 * single tie my_gameweek_opponent gives.
 */
async function myTies(gameweekId) {
  const { data, error } = await supabase.rpc('my_gameweek_ties', { p_gameweek_id: gameweekId })
  if (!error) return (data || []).filter(t => t.opponent_id)
  const { data: one } = await supabase.rpc('my_gameweek_opponent', { p_gameweek_id: gameweekId })
  const row = Array.isArray(one) ? one[0] : one
  return row?.opponent_id ? [row] : []
}

/** The small tie rows: each one's points, stored once scored, live until then. */
async function compactTies(ties, gameweekId, userId, fixtures) {
  return Promise.all(ties.map(async t => {
    const rules = (await resolvePointRules(supabase, t.competition_id).catch(() => null)) || defaultRules()
    const [stored, mine, theirs] = await Promise.all([
      storedTiePoints(t, gameweekId, userId),
      pointsFor(gameweekId, userId, fixtures, rules),
      pointsFor(gameweekId, t.opponent_id, fixtures, rules),
    ])
    return {
      id: `${t.kind}:${t.match_id || t.competition_id}`,
      competitionName: t.competition_name || '',
      roundLabel: t.round_label || '',
      opponentName: t.opponent_name || 'Opponent',
      opponentKit: t.opponent_kit || null,
      mine: stored?.mine ?? mine,
      theirs: stored?.theirs ?? theirs,
    }
  }))
}

/**
 * The points recorded against a cup tie or group fixture, once the gameweek has
 * been scored.
 *
 * Returns null while a gameweek is still in play — nothing has been written
 * yet, so the caller falls back to adding up fixtures live.
 *
 * This is the authoritative number: it is what the group table and the cup
 * bracket both show, and it includes every bonus.
 */
async function storedTiePoints(opponent, gameweekId, userId) {
  const table = opponent.kind === 'knockout' ? 'bracket_matches' : 'group_fixtures'

  try {
    let q = supabase.from(table)
      .select('home_user_id, away_user_id, home_points, away_points')
      .eq('gameweek_id', gameweekId)
      .or(`home_user_id.eq.${userId},away_user_id.eq.${userId}`)

    // Narrow to the tie's own competition. Without this, a player in two cups
    // running off the same gameweek could match the wrong fixture.
    if (opponent.competition_id) q = q.eq('competition_id', opponent.competition_id)

    const { data, error } = await q
    if (error || !data?.length) return null

    const row = data[0]
    if (row.home_points == null && row.away_points == null) return null

    const iAmHome = row.home_user_id === userId
    return {
      mine:   iAmHome ? row.home_points : row.away_points,
      theirs: iAmHome ? row.away_points : row.home_points,
    }
  } catch {
    // A knockout table without a gameweek_id column, say. Falling back to the
    // live calculation shows a slightly low number rather than no card at all.
    return null
  }
}
