import { useState, useEffect } from 'react'
import LmsApprovals, { LmsAddPlayers } from './LmsApprovals'
import { supabase } from '../../../lib/supabase'
import { registerDevice } from '../../../lib/deviceId'
import { formatUK } from '../../../lib/time'
import {
  loadLms, upcomingRounds, lmsLeagueOptions, leagueLabel, roundName, LMS_ERRORS, NFL_LEAGUE,
} from '../../../lib/lms'
import { Card, Button, Input, Select, Spinner, SectionLabel } from '../../ui'
import toast from 'react-hot-toast'

/**
 * Loads a league's season from API-Sports now, rather than waiting for the
 * job. Returns { season }. The NFL is always league 1.
 */
export async function refreshLmsFixtures(sport, leagueId) {
  const { data, error } = await supabase.functions.invoke('sync-lms', {
    body: { mode: 'fixtures', sport, league_id: sport === 'nfl' ? NFL_LEAGUE.id : leagueId },
  })
  if (error) throw error
  if (!data?.ok) throw new Error(data?.error || 'Could not load the fixtures')
  return data
}

/**
 * Start a game. Used straight after a Last Man Standing is created, so the
 * admin has nothing more to do, and from Admin → Game. Loads the league's
 * fixtures first if this project has none yet.
 */
export async function startLmsGame(competitionId, { sport, leagueId, leagueName, points, startRound = null }) {
  const id = sport === 'nfl' ? NFL_LEAGUE.id : leagueId
  const args = {
    p_competition_id: competitionId, p_sport: sport, p_league_id: id,
    p_league_name: sport === 'nfl' ? NFL_LEAGUE.name : leagueName,
    p_points: points, p_start_round: startRound,
  }
  await registerDevice()
  let { data, error } = await supabase.rpc('lms_start_game', args)
  if (!error && data?.error === 'no_fixtures') {
    await refreshLmsFixtures(sport, id)
    ;({ data, error } = await supabase.rpc('lms_start_game', args))
  }
  if (error) throw error
  if (!data?.ok) throw new Error(LMS_ERRORS[data?.error] || 'Could not start the game')
  return data
}

/** Football or NFL, for a game in the Last Man Standing section. */
export function GameSportField({ value, onChange, disabled }) {
  const opts = [['football', '⚽ Football'], ['nfl', '🏈 NFL']]
  return (
    <div className="flex gap-2">
      {opts.map(([id, label]) => (
        <button key={id} type="button" disabled={disabled} onClick={() => onChange(id)}
          className="flex-1 rounded-lg py-2 text-sm font-semibold"
          style={{
            background: value === id ? 'var(--accent-dim)' : 'var(--bg-raised)',
            color: value === id ? 'var(--accent)' : 'var(--txt-second)',
            border: `0.5px solid ${value === id ? 'var(--accent)' : 'var(--border-med)'}`,
          }}>{label}</button>
      ))}
    </div>
  )
}

/** Which league the game runs on. Football: any league; NFL: the NFL. */
export function LeagueField({ sport, value, onChange, disabled }) {
  const [options, setOptions] = useState(null)
  useEffect(() => {
    if (sport !== 'nfl') lmsLeagueOptions(supabase).then(setOptions)
  }, [sport])

  if (sport === 'nfl') {
    return <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>NFL · regular season, one pick a week</p>
  }
  if (!options) return <Select disabled><option>Loading leagues…</option></Select>

  const all = [...options.popular, ...options.more]
  return (
    <Select value={value?.id ?? ''} disabled={disabled} style={{ width: '100%' }} onChange={e => {
      const l = all.find(x => String(x.id) === e.target.value)
      if (l) onChange({ id: l.id, name: l.name })
    }}>
      <optgroup label="Main leagues">
        {options.popular.map(l => <option key={l.id} value={l.id}>{leagueLabel(l)}</option>)}
      </optgroup>
      {options.more.length > 0 && (
        <optgroup label="More leagues">
          {options.more.map(l => <option key={l.id} value={l.id}>{leagueLabel(l)}</option>)}
        </optgroup>
      )}
    </Select>
  )
}

/**
 * Admin → Game, for a Last Man Standing. Start a game (league, points per
 * entry, first gameweek), change it before it starts, or stop it. Results
 * need nothing: the app settles each gameweek by itself.
 */
export default function LmsAdmin({ competitionId, sport: compSport = 'football' }) {
  // A Last Man Standing made inside Football or NFL keeps that sport; one in
  // the Last Man Standing section chooses it for each game.
  const chooseSport = !['football', 'nfl'].includes(compSport)
  const [sport, setSport] = useState(chooseSport ? 'football' : compSport)
  const [data, setData] = useState(null)
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [points, setPoints] = useState(10)
  const [startRound, setStartRound] = useState('')
  const [league, setLeague] = useState(sport === 'nfl' ? NFL_LEAGUE : { id: 39, name: 'Premier League' })
  const [loadingRounds, setLoadingRounds] = useState(false)
  const [isPro, setIsPro] = useState(null)

  useEffect(() => { supabase.rpc('has_pro').then(({ data }) => setIsPro(data === true)) }, [])

  useEffect(() => { load() }, [competitionId])

  async function load() {
    setLoading(true)
    try {
      const d = await loadLms(supabase, competitionId)
      setData(d)
      const g = d.game
      const live = g && ['open', 'running'].includes(g.status)
      setPoints(g?.base_points || 10)
      const s = chooseSport ? (g?.sport || 'football') : compSport
      setSport(s)
      if (live) {
        const up = await upcomingRounds(supabase, g.sport, g.league_id, g.season)
        setRounds(up)
        setStartRound(String(g.status === 'open' ? g.start_round : (up[0]?.round ?? '')))
      } else {
        // Start the next game on the same league as the last one.
        const l = g ? { id: g.league_id, name: g.league_name } : (s === 'nfl' ? NFL_LEAGUE : league)
        setLeague(l)
        await loadRounds(l, s)
      }
    } finally { setLoading(false) }
  }

  // The gameweeks still to come in a league, loading its season if needed.
  async function loadRounds(l, sport) {
    setLoadingRounds(true)
    setRounds([]); setStartRound('')
    try {
      // Use what is already loaded; only ask API-Sports when the league is new
      // here or its season has nothing left to play (it saves the daily quota).
      const id = sport === 'nfl' ? NFL_LEAGUE.id : l.id
      const { data: last } = await supabase.from('lms_fixtures').select('season')
        .eq('sport', sport).eq('league_id', id).order('season', { ascending: false }).limit(1)
      let up = last?.length ? await upcomingRounds(supabase, sport, id, last[0].season) : []
      if (!up.length) {
        const r = await refreshLmsFixtures(sport, id)
        up = await upcomingRounds(supabase, sport, id, r.season)
      }
      setRounds(up)
      setStartRound(String(up[0]?.round ?? ''))
    } catch (err) {
      toast.error(err.message || 'Could not load that league')
    } finally { setLoadingRounds(false) }
  }

  async function act(fn, ok) {
    setBusy(true)
    try { await fn(); toast.success(ok); await load() }
    catch (err) { toast.error(err.message || 'Something went wrong') }
    finally { setBusy(false) }
  }

  const rpc = async (name, args) => {
    const { data: r, error } = await supabase.rpc(name, args)
    if (error) throw error
    if (!r?.ok) throw new Error(LMS_ERRORS[r?.error] || 'Something went wrong')
    return r
  }

  if (loading || !data) return <div className="flex justify-center py-10"><Spinner /></div>

  const game = data.game
  const live = game && ['open', 'running'].includes(game.status)
  const lastNoWinner = data.games.find(g => g.status === 'no_winner' && !g.rolled_into)
  const pts = Math.max(1, Math.min(1000, Number(points) || 0))
  const nextLevel = lastNoWinner ? lastNoWinner.rollover_level + 1 : 0
  const rn = r => roundName({ sport }, r)
  const roundLabel = r => `${rn(r.round)} · first kick-off ${formatUK(r.lock, { weekday: 'short', day: 'numeric', month: 'short' })}`

  const roundPicker = loadingRounds ? (
    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt-muted)' }}><Spinner size="sm" /> Loading fixtures…</div>
  ) : rounds.length ? (
    <Select value={startRound} onChange={e => setStartRound(e.target.value)}>
      {rounds.map(r => <option key={r.round} value={r.round}>{roundLabel(r)}</option>)}
    </Select>
  ) : (
    <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>No gameweeks still to come in this league's season.</p>
  )

  return (
    <div>
      {live && (
        <Card className="p-4 mb-4">
          <SectionLabel>Game {game.game_number} · {game.league_name} · {game.status === 'open' ? 'taking entries' : 'under way'}</SectionLabel>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <Stat label="Pot" value={`${data.pot}`} sub="pts" />
            <Stat label="Entries" value={data.entries.length}
              sub={`${data.players} player${data.players === 1 ? '' : 's'} · ${data.entries.filter(e => e.status === 'alive').length} in`} />
            <Stat label={sport === 'nfl' ? 'Week' : 'Gameweek'} value={rn(game.current_round)} sub={data.lock ? (data.locked ? 'locked' : `locks ${formatUK(data.lock, { weekday: 'short' })}`) : '—'} />
          </div>
          <p className="text-[11px] mt-3" style={{ color: 'var(--txt-muted)' }}>
            {game.entry_points} pts per entry
            {game.rollover_level > 0 && ` (roll-over ${game.rollover_level}; entries carried from the last game add ${game.base_points})`}
            {game.carried_points > 0 && `. Includes ${game.carried_points} pts rolled over.`}
          </p>

          {game.status === 'open' && (
            <div className="mt-4 pt-4 flex flex-col gap-3" style={{ borderTop: '0.5px solid var(--border)' }}>
              <LmsApprovals data={data} isAdmin onDone={load} />
              <LmsAddPlayers competitionId={competitionId} data={data} onDone={load} />
              <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                Players join with the code, then tap Join this game (more than once for extra entries) until the first kick-off. You approve each entry here or under Players; any still waiting at the first kick-off are removed. The game starts by itself then (with at least 2 players; otherwise it moves on a {sport === 'nfl' ? 'week' : 'gameweek'}).
              </p>
              <Field label="Points per entry (before any roll-over)"><Input type="number" min={1} max={1000} value={points} onChange={e => setPoints(e.target.value)} /></Field>
              <Field label={sport === 'nfl' ? 'First week' : 'First gameweek'}>{roundPicker}</Field>
              <Button variant="primary" disabled={busy || !startRound}
                onClick={() => act(() => rpc('lms_update_game', { p_game_id: game.id, p_points: pts, p_start_round: Number(startRound) }), 'Game updated')}>
                Save changes
              </Button>
            </div>
          )}

          <div className="mt-4 pt-3 flex items-center justify-between gap-2" style={{ borderTop: '0.5px solid var(--border)' }}>
            <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>Results, knock-outs and missed picks are automatic.</p>
            <Button size="sm" className="flex-shrink-0 whitespace-nowrap" disabled={busy} onClick={() => {
              if (!window.confirm(`Stop Game ${game.game_number}? Nobody wins it${game.carried_points ? ', and the rolled-over points go back for the next game' : ''}. This cannot be undone.`)) return
              act(() => rpc('lms_cancel_game', { p_game_id: game.id }), 'Game stopped')
            }}>Stop game</Button>
          </div>
        </Card>
      )}

      {!live && (
        <Card className="p-4 mb-4">
          <SectionLabel>Start {data.games.some(g => g.status !== 'cancelled') ? 'the next game' : 'a game'}</SectionLabel>
          {game && (
            <p className="text-xs mt-2" style={{ color: 'var(--txt-second)' }}>
              Last game: {game.status === 'won' ? `won by ${game.winner?.display_name || 'a player'} (${game.pot} pts)` : `no winner, ${game.pot} pts`}.
            </p>
          )}
          <div className="flex flex-col gap-3 mt-3">
            {chooseSport && (
              <Field label="Sport">
                <GameSportField value={sport} disabled={busy || loadingRounds} onChange={s => {
                  const l = s === 'nfl' ? NFL_LEAGUE : { id: 39, name: 'Premier League' }
                  setSport(s); setLeague(l); loadRounds(l, s)
                }} />
              </Field>
            )}
            <Field label="League">
              <LeagueField sport={sport} value={league} disabled={busy || loadingRounds}
                onChange={l => { setLeague(l); loadRounds(l, sport) }} />
            </Field>
            <Field label="Points per entry"><Input type="number" min={1} max={1000} value={points} onChange={e => setPoints(e.target.value)} /></Field>
            <Field label={sport === 'nfl' ? 'First week' : 'First gameweek'}>{roundPicker}</Field>
            {lastNoWinner && (
              <p className="text-xs" style={{ color: 'var(--green)' }}>
                {lastNoWinner.pot} pts roll over from Game {lastNoWinner.game_number}. New entries cost {pts * (nextLevel + 1)} pts; everyone from Game {lastNoWinner.game_number} is re-entered for {pts} more.
              </p>
            )}
            <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>Everyone in this competition gets one entry. Points are bragging points only, never money.</p>
            {isPro === false && data.games.some(g => g.status !== 'cancelled' || g.started_at) && (
              <p className="text-xs" style={{ color: 'var(--amber)' }}>
                The free plan includes one Last Man Standing game. Another game, including one after a roll-over, needs Pro: Settings → ALOTO Pro.
              </p>
            )}
            <Button variant="primary" disabled={busy || loadingRounds || !startRound}
              onClick={() => act(() => startLmsGame(competitionId, {
                sport, leagueId: league.id, leagueName: league.name, points: pts, startRound: Number(startRound),
              }), 'Game started')}>
              Start game
            </Button>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>Fixtures, results and the league table update by themselves.</p>
        {live && (
          <Button size="sm" className="flex-shrink-0 whitespace-nowrap" disabled={busy}
            onClick={() => act(() => refreshLmsFixtures(game.sport, game.league_id), 'Fixtures refreshed')}>Refresh now</Button>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'var(--bg-raised)' }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-muted)' }}>{label}</p>
      <p className="text-lg font-bold" style={{ color: 'var(--txt-primary)' }}>{value}</p>
      <p className="text-[10px]" style={{ color: 'var(--txt-muted)' }}>{sub}</p>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>{label}</p>
      {children}
    </div>
  )
}
