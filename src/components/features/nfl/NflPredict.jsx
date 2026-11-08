import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { useFixtures, usePredictions } from '../../../hooks/useFixtures'
import { supabase } from '../../../lib/supabase'
import { sortGameweeks, latestGameweek } from '../../../lib/gameweeks'
import { nflPointRules, marginScore, bandStyle, marginText, MARGIN_BANDS } from '../../../lib/sports/nfl/scoring'
import { Card, Button, Select, Spinner, EmptyState } from '../../ui'
import NflTeamBadge, { nflTeam } from './NflTeamBadge'
import { FORMAT_MARK } from '../../ui/CompetitionIcon'
import { noteGoodMoment } from '../../../lib/review'
import SeasonPredictions from '../season/SeasonPredictions'
import toast from 'react-hot-toast'
import { format, isPast } from 'date-fns'

/**
 * The NFL Predict screen.
 *
 * Separate from football's Predict on purpose: nothing here is shared with it
 * except the data hooks every screen uses. Each game is picked as a score, the
 * margin that score implies is shown underneath ("Philadelphia by 7"), and once
 * the result is in the game shows which band it paid.
 *
 * Each game locks at its own kickoff, which is what NFL weeks need — Thursday
 * night to Monday night, one game at a time.
 *
 * Not here yet, because they are not built or not decided: live scores (they
 * arrive with the NFL feed), a week results grid, Triple Points.
 */
export default function NflPredict() {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [gameweeks, setGameweeks] = useState([])
  const [selectedGW, setSelectedGW] = useState(null)
  const [rules, setRules] = useState(null)
  const [counts, setCounts] = useState({})
  const { fixtures, loading: lf } = useFixtures(selectedGW?.id)
  const { predictions, loading: lp, savePrediction } = usePredictions(selectedGW?.id, user?.id)

  useEffect(() => { if (comp) { loadWeeks(); nflPointRules(supabase, comp).then(setRules) } }, [comp])
  useEffect(() => { if (selectedGW) loadCounts() }, [selectedGW])

  // Live scores from the NFL feed, polled every 30 seconds while a game is on
  // (the feed itself updates every 30) and every three minutes otherwise, so a
  // kickoff is noticed without a reload. Only the live columns are re-read.
  const [live, setLive] = useState({})
  // Weekly games, or the season questions (Super Bowl, MVP, divisions). The
  // season side is the same screen football uses: it only reads the questions
  // the admin set up, so nothing in it is football specific.
  const [tab, setTab] = useState('week')
  // A season reminder opens this on the Season tab (?tab=season).
  const location = useLocation()
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'season') setTab('season')
  }, [location.search])
  useEffect(() => {
    if (!selectedGW?.id) { setLive({}); return }
    let cancelled = false, timer
    async function poll() {
      const { data } = await supabase.from('fixtures')
        .select('id, live_home_score, live_away_score, live_status, live_clock, live_updated_at, home_score, away_score, status')
        .eq('gameweek_id', selectedGW.id)
      if (cancelled) return
      const map = {}; (data || []).forEach(f => { map[f.id] = f })
      setLive(map)
      const playing = (data || []).some(f => isPlaying(f.live_status))
      timer = setTimeout(poll, playing ? 30000 : 180000)
    }
    poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [selectedGW?.id])

  async function loadWeeks() {
    const { data: links } = await supabase.from('competition_gameweeks').select('gameweek_id').eq('competition_id', comp)
    const ids = (links || []).map(l => l.gameweek_id)
    const { data: raw } = ids.length
      ? await supabase.from('gameweeks').select('*').in('id', ids)
      : { data: [] }
    const weeks = sortGameweeks(raw)
    setGameweeks(weeks)
    setSelectedGW(weeks.find(g => g.status === 'active') || latestGameweek(weeks) || null)
  }

  async function loadCounts() {
    const { data } = await supabase.from('predictions').select('fixture_id').eq('gameweek_id', selectedGW.id)
    const c = {}; (data || []).forEach(p => { c[p.fixture_id] = (c[p.fixture_id] || 0) + 1 })
    setCounts(c)
  }

  if (!competitions.length) return (
    <EmptyState icon="ti-ball-american-football" title="No NFL competitions yet"
      description="Enter the code your league admin sent you to join one." />
  )

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-4">
        <Select value={comp || ''} onChange={e => setComp(e.target.value)} style={{ flex: '1 1 200px' }}>
          {competitions.map(c => <option key={c.id} value={c.id}>{FORMAT_MARK[c.format] || ''} {c.name}</option>)}
        </Select>
        {tab === 'week' && (
        <Select value={selectedGW?.id || ''} onChange={e => setSelectedGW(gameweeks.find(g => g.id === e.target.value) || null)} style={{ flex: '1 1 140px' }}>
          {gameweeks.length === 0 && <option value="">No weeks yet</option>}
          {gameweeks.map(gw => <option key={gw.id} value={gw.id}>{gw.number}{gw.status === 'active' ? ' (current)' : ''}</option>)}
        </Select>
        )}
      </div>

      <div className="flex gap-4 mb-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
        {[['week', 'This week'], ['season', 'Season']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="text-sm pb-2"
            style={{ color: tab === k ? 'var(--accent)' : 'var(--txt-muted)', fontWeight: tab === k ? 600 : 400, borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'season' && comp && <SeasonPredictions competitionId={comp} userId={user?.id} />}

      {tab === 'week' && <>
      {rules && <PointsKey rules={rules} />}

      {lf || lp ? <div className="flex justify-center py-20"><Spinner size="lg" /></div>
        : fixtures.length === 0 ? <EmptyState icon="ti-calendar-off" title="No games this week" description="Games will appear when the admin adds them" />
        : fixtures.map(f => (
          <GameCard key={f.id} fixture={{ ...f, ...(live[f.id] || {}) }} prediction={predictions[f.id]} userId={user?.id}
            count={counts[f.id]} rules={rules} weekLabel={selectedGW?.number}
            onSave={(fid, h, a) => savePrediction(fid, h, a, selectedGW.id, user.id)} />
        ))}
      </>}
    </div>
  )
}

// The feed's in-play codes. FT and AOT (after overtime) are final; a game tied
// after the fourth quarter shows OT, never FT, so it is never final too early.
const FINAL_CODES = ['FT', 'AOT']
const PLAYING_CODES = ['Q1', 'Q2', 'Q3', 'Q4', 'HT', 'OT', 'LIVE']
function isPlaying(code) { return PLAYING_CODES.includes(code) }
function quarterLabel(code) {
  return { Q1: '1st', Q2: '2nd', Q3: '3rd', Q4: '4th', HT: 'Half time', OT: 'Overtime', FT: 'Final', AOT: 'Final (OT)' }[code] || code
}

// The points, above the games. Everything is added on top of the right
// winner, and a wrong winner scores nothing.
function PointsKey({ rules }) {
  const n = key => Number(rules[key]) || 0
  const exact = n('winner_only_points') + 2 * n('team_score_points') + n('margin_exact_points')
  const color = band => band === 'exact_margin' || band === 'within_2' ? 'var(--green)'
    : band === 'within_4' || band === 'within_7' ? 'var(--amber)' : 'var(--txt-primary)'
  return (
    <div className="mb-4 p-3 rounded-md text-xs" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)', color: 'var(--txt-second)', lineHeight: 1.6 }}>
      <div>
        Right winner <strong style={{ color: 'var(--txt-primary)' }}>{n('winner_only_points')}</strong>
        &nbsp;+&nbsp; each team's score exact <strong style={{ color: 'var(--green)' }}>{n('team_score_points')}</strong>
        &nbsp;+&nbsp; your margin:
      </div>
      <div>
        {MARGIN_BANDS.map(b => (
          <span key={b.band} className="inline-block whitespace-nowrap mr-3">
            {b.band === 'exact_margin' ? 'Exact' : `Within ${b.max}`} <strong style={{ color: color(b.band) }}>{n(b.key)}</strong>
          </span>
        ))}
      </div>
      <div style={{ color: 'var(--txt-muted)' }}>
        Exact score = {exact}. Wrong winner = 0. Final scores include overtime.
      </div>
    </div>
  )
}

function ScoreInput({ value, onChange, disabled, label }) {
  return <input type="number" min="0" max="99" aria-label={label}
    value={value === '' ? '' : value}
    onChange={e => {
      const raw = e.target.value
      if (raw === '') { onChange(''); return }
      const n = parseInt(raw, 10)
      if (!isNaN(n)) onChange(Math.max(0, Math.min(99, n)))
    }}
    disabled={disabled} className="score-box"
    style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}} />
}

function GameCard({ fixture, prediction, userId, count, rules, weekLabel, onSave }) {
  const [home, setHome] = useState(prediction?.predicted_home ?? '')
  const [away, setAway] = useState(prediction?.predicted_away ?? '')
  const [saving, setSaving] = useState(false)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { setHome(prediction?.predicted_home ?? ''); setAway(prediction?.predicted_away ?? '') }, [prediction])

  const kickoff = new Date(fixture.kickoff_time)
  const isVoid = fixture.status === 'void'
  const isLocked = isVoid || isPast(kickoff)
  // home_score / away_score are the FINAL score, overtime included. Nothing is
  // scored from a score at the end of regulation: a tied game that goes to
  // overtime is only final once overtime is over.
  const hasResult = !isVoid && fixture.home_score !== null && fixture.home_score !== undefined
  const scored = hasResult && prediction && rules ? marginScore(prediction, fixture, rules) : null

  // The feed's score while the result isn't confirmed. Provisional, in amber,
  // and never used for points that count.
  const inPlay = !isVoid && !hasResult && isPlaying(fixture.live_status)
  const feedFinal = !isVoid && !hasResult && FINAL_CODES.includes(fixture.live_status)
  const showLive = (inPlay || feedFinal) && fixture.live_home_score != null
  const liveScored = showLive && prediction && rules
    ? marginScore(prediction, { home_score: fixture.live_home_score, away_score: fixture.live_away_score }, rules)
    : null
  const readout = marginText(fixture.home_team, fixture.away_team, home, away)

  // Which side the pick backs, so that team's card is outlined like a choice.
  const backs = home === '' || away === '' ? null
    : Number(home) > Number(away) ? 'home' : Number(away) > Number(home) ? 'away' : 'tie'
  const winner = !hasResult ? null
    : fixture.home_score > fixture.away_score ? 'home' : fixture.away_score > fixture.home_score ? 'away' : 'tie'

  const header = isVoid ? 'VOID'
    : hasResult ? `${format(kickoff, 'EEE d MMM').toUpperCase()} · FINAL`
    : inPlay ? `LIVE · ${quarterLabel(fixture.live_status).toUpperCase()}${fixture.live_clock && fixture.live_status !== 'HT' ? ` ${fixture.live_clock}` : ''}`
    : feedFinal ? `${quarterLabel(fixture.live_status).toUpperCase()} · AWAITING CONFIRMATION`
    : isLocked ? `${format(kickoff, 'EEE d MMM').toUpperCase()} · LOCKED`
    : `${format(kickoff, 'EEE d MMM').toUpperCase()} · LOCKS @ ${format(kickoff, 'HH:mm')}`

  async function save() {
    if (home === '' || away === '') { toast.error('Enter both scores'); return }
    setSaving(true)
    try {
      await onSave(fixture.id, Number(home), Number(away))
      toast.success('Prediction saved!')
      noteGoodMoment()
    }
    catch { toast.error('Could not save prediction') }
    finally { setSaving(false) }
  }

  // NFL lists the away side first ("Ravens @ Jaguars"), so the away card sits
  // on the left and the home card on the right.
  const sides = [
    { key: 'away', team: fixture.away_team, value: away, onChange: setAway, final: fixture.away_score, picked: prediction?.predicted_away, liveScore: showLive ? fixture.live_away_score : null },
    { key: 'home', team: fixture.home_team, value: home, onChange: setHome, final: fixture.home_score, picked: prediction?.predicted_home, liveScore: showLive ? fixture.live_home_score : null },
  ]

  return (
    <Card className="p-4 mb-3" style={isVoid ? { opacity: 0.75 } : {}}>
      <p className="text-xs font-semibold text-center mb-3 flex items-center justify-center gap-1.5" style={{ color: inPlay ? 'var(--amber)' : 'var(--txt-muted)', letterSpacing: '0.06em' }}>
        {inPlay && <span className="live-dot" aria-hidden="true" />}
        {weekLabel} · {header}
      </p>
      {isVoid && fixture.void_reason && (
        <p className="text-xs text-center mb-2" style={{ color: 'var(--amber)' }}>{fixture.void_reason} · scores nothing</p>
      )}

      <div className="grid grid-cols-2 gap-2.5 mb-3">
        {sides.map(s => (
          <TeamPanel key={s.key} side={s.key} team={s.team}
            value={s.value} onChange={s.onChange} locked={isLocked}
            hasResult={hasResult} final={s.final} picked={s.picked} liveScore={s.liveScore}
            highlighted={hasResult ? winner === s.key : backs === s.key} />
        ))}
      </div>

      {liveScored && (
        <p className="text-xs text-center mb-2" style={{ color: 'var(--amber)' }}>
          {liveScored.label || 'No points'} · {liveScored.points}pts so far
        </p>
      )}

      {hasResult ? (
        <div className="text-center mb-1">
          <p className="text-sm mb-2" style={{ color: 'var(--txt-second)' }}>
            {marginText(fixture.home_team, fixture.away_team, fixture.home_score, fixture.away_score)}
            {prediction
              ? <span style={{ color: 'var(--txt-muted)' }}> · you said {marginText(fixture.home_team, fixture.away_team, prediction.predicted_home, prediction.predicted_away)}</span>
              : <span style={{ color: 'var(--txt-muted)' }}> · no pick</span>}
          </p>
          {scored && <BandChip scored={scored} />}
        </div>
      ) : (
        <p className="text-sm text-center mb-2 font-medium" style={{ color: readout ? 'var(--accent)' : 'var(--txt-muted)', minHeight: 20 }}>
          {isLocked ? (prediction ? `Your pick: ${marginText(fixture.home_team, fixture.away_team, prediction.predicted_home, prediction.predicted_away)}` : 'No pick made')
            : (readout || 'Enter both scores to see your margin')}
        </p>
      )}

      {!isLocked && !hasResult && (
        <div className="flex items-center justify-between mt-1 flex-wrap gap-2">
          <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
            {prediction
              ? <span style={{ color: 'var(--green)' }}>Saved {format(new Date(prediction.submitted_at), 'd MMM, HH:mm')} · you can change it until kickoff</span>
              : 'Final score, overtime included'}
          </p>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            <i className="ti ti-check text-xs" />{saving ? 'Saving…' : prediction ? 'Update' : 'Save'}
          </Button>
        </div>
      )}

      {isLocked && (
        <button onClick={() => setShowAll(v => !v)} className="text-xs flex items-center gap-1 mt-2" style={{ color: 'var(--accent)' }}>
          <i className={`ti ti-chevron-${showAll ? 'up' : 'down'} text-xs`} aria-hidden="true" />
          {showAll ? 'Hide' : 'Show'} everyone's picks {count != null && `(${count})`}
        </button>
      )}
      {isLocked && showAll && <EveryonesPicks fixture={fixture} userId={userId} rules={rules} />}
    </Card>
  )
}

// One team: its colours and badge across the top, its name, and either the box
// for the predicted score or, once final, the real score with the pick beneath.
function TeamPanel({ side, team, value, onChange, locked, hasResult, final, picked, highlighted, liveScore }) {
  const t = nflTeam(team)
  return (
    <div className="rounded-xl overflow-hidden flex flex-col"
      style={{
        background: 'var(--bg-elevated)',
        border: highlighted ? '2px solid var(--accent)' : '2px solid transparent',
      }}>
      <div className="flex justify-center items-center py-3"
        style={{ background: `linear-gradient(180deg, ${t.primary} 0%, ${t.primary}55 70%, transparent 100%)` }}>
        <NflTeamBadge team={team} size={48} />
      </div>
      <div className="px-2 pt-2 pb-3 text-center flex flex-col items-center gap-1 flex-1">
        <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--txt-primary)' }}>{team}</p>
        <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>{side === 'home' ? 'Home' : 'Away'}</p>
        <div className="mt-auto pt-1">
          {hasResult ? (
            <div>
              <p className="text-2xl font-bold" style={{ color: highlighted ? 'var(--green)' : 'var(--txt-primary)' }}>{final}</p>
              <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>you said {picked ?? '—'}</p>
            </div>
          ) : liveScore != null ? (
            <div>
              <p className="text-2xl font-bold" style={{ color: 'var(--amber)' }}>{liveScore}</p>
              <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>you said {picked ?? '—'}</p>
            </div>
          ) : (
            <ScoreInput value={value} onChange={onChange} disabled={locked} label={`${team} points`} />
          )}
        </div>
      </div>
    </div>
  )
}

// What a pick paid, e.g. "Winner + 1 score + within 4 · 15pts".
function BandChip({ scored }) {
  const s = bandStyle(scored.band)
  const label = scored.label || 'No points'
  return (
    <span className="inline-flex text-xs font-medium px-2.5 py-1 rounded-md mb-2" style={{ background: s.bg, color: s.color }}>
      {label} · {scored.points}pts
    </span>
  )
}

function EveryonesPicks({ fixture, userId, rules }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    supabase.from('predictions').select('predicted_home, predicted_away, points_earned, user_id, profiles(display_name)')
      .eq('fixture_id', fixture.id)
      .then(({ data }) => setRows(data || []))
  }, [fixture.id])

  if (!rows) return <div className="flex justify-center py-4"><Spinner size="sm" /></div>
  if (!rows.length) return <p className="text-xs py-2" style={{ color: 'var(--txt-muted)' }}>No one picked this game.</p>

  const hasResult = fixture.home_score !== null && fixture.home_score !== undefined && fixture.status !== 'void'
  const scoredRows = rows.map(r => ({ ...r, scored: hasResult && rules ? marginScore(r, fixture, rules) : null }))
  scoredRows.sort((a, b) => {
    if (a.user_id === userId) return -1
    if (b.user_id === userId) return 1
    return (b.scored?.points || 0) - (a.scored?.points || 0)
  })

  return (
    <div className="mt-2 rounded-md overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
      {scoredRows.map((r, i) => {
        const isMe = r.user_id === userId
        const s = r.scored ? bandStyle(r.scored.band) : null
        return (
          <div key={i} className="flex items-center justify-between px-3 py-2"
            style={{ background: isMe ? 'var(--accent-dim)' : 'transparent', borderBottom: i < scoredRows.length - 1 ? '0.5px solid var(--border)' : '' }}>
            <span className="text-xs" style={{ color: isMe ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: isMe ? 700 : 400 }}>
              {r.profiles?.display_name}{isMe && ' (you)'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--txt-second)' }}>{r.predicted_home}–{r.predicted_away}</span>
              {r.scored && (
                <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: s.bg, color: s.color }}>{r.scored.points}pts</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
