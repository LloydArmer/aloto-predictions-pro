import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card } from '../../ui'
import Shirt, { PlayerMark } from '../../ui/Shirt'
import { effectiveScore, isInPlay } from '../../../lib/livePoints'
import { resolvePointRules, defaultRules, scoreOnePrediction } from '../../../lib/scoring'

/**
 * The head-to-head card at the top of the dashboard.
 *
 * Shows whichever is more interesting:
 *
 *   A CUP TIE, when there is one this gameweek — your kit and points against
 *   your opponent's, which is the thing you actually care about on a Saturday.
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

  /* ---- Cup tie ---- */
  if (data.kind === 'tie') {
    const { me, them, gameweek, competitionName, roundLabel, live, inPlayCount, fromOtherCompetition } = data
    const leading = me.points > them.points
    const level = me.points === them.points

    return (
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

        <div className="flex items-center gap-2 px-3.5 py-4">
          <Side player={me} highlight={leading || level}/>
          <span className="text-xs" style={{ color: 'var(--txt-muted)', letterSpacing: '0.1em' }}>
            {roundLabel || 'VS'}
          </span>
          <Side player={them} highlight={!leading || level}/>
        </div>
      </Card>
    )
  }

  /* ---- League summary ---- */
  const { gameweek, competitionName, myPoints, position, playerCount, movement, best, live, inPlayCount } = data

  return (
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
          {gameweek}{live ? ` · ${inPlayCount} LIVE` : ' FINAL'}
        </span>
      </div>

      <div className="flex items-center px-3.5 py-3.5">
        <Stat value={myPoints} label={live ? 'Points so far' : 'Your points'}/>

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

  const gw = (gws || []).find(g => g.status === 'active')
    || [...(gws || [])].reverse().find(g => g.status === 'completed')
  if (!gw) return null

  const [{ data: fixtures }, rules] = await Promise.all([
    supabase.from('fixtures')
      .select('id, status, home_score, away_score, live_home_score, live_away_score, live_status')
      .eq('gameweek_id', gw.id),
    resolvePointRules(supabase, competitionId),
  ])

  const activeRules = rules || defaultRules()
  const inPlayCount = (fixtures || []).filter(isInPlay).length
  const live = inPlayCount > 0

  // Is there a cup tie or group fixture this gameweek?
  const { data: oppRows } = await supabase.rpc('my_gameweek_opponent', { p_gameweek_id: gw.id })
  const opponent = Array.isArray(oppRows) ? oppRows[0] : oppRows

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
      me:   { name: meProfile.data?.display_name ?? 'You', kit: meProfile.data?.badge_kit, points: mine },
      them: { name: opponent.opponent_name, kit: opponent.opponent_kit, points: theirs },
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
  const position = mine ? scores.indexOf(mine) + 1 : null

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

    const prev = [...scores].sort((a, b) => (before[b.userId] || 0) - (before[a.userId] || 0))
    const prevPos = mine ? prev.findIndex(s => s.userId === userId) + 1 : null
    if (prevPos && position) movement = prevPos - position
  }

  return {
    kind: 'league',
    competitionName: comp?.name ?? '',
    gameweek: gw.number,
    live, inPlayCount,
    myPoints: mine?.points ?? 0,
    position,
    playerCount: scores.length,
    movement,
    best: scores[0] && scores[0].userId !== userId
      ? { name: scores[0].name.split(' ')[0], points: scores[0].points }
      : null,
  }
}

/** One person's provisional points for a gameweek. */
async function pointsFor(gameweekId, userId, fixtures, rules) {
  const { data: preds } = await supabase.from('predictions')
    .select('fixture_id, predicted_home, predicted_away')
    .eq('gameweek_id', gameweekId).eq('user_id', userId)

  let total = 0
  for (const fx of (fixtures || [])) {
    if (fx.status === 'void') continue
    const score = effectiveScore(fx)
    if (!score) continue

    const p = (preds || []).find(x => x.fixture_id === fx.id)
    if (!p) continue

    total += scoreOnePrediction(
      { predicted_home: p.predicted_home, predicted_away: p.predicted_away },
      { home_score: score.home, away_score: score.away },
      rules,
    ).points
  }
  return total
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
