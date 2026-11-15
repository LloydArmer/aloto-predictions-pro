import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatUK } from '../../../lib/time'
import { loadLms, upcomingRounds, currentSeason, LMS_ERRORS } from '../../../lib/lms'
import { Card, Button, Input, Select, Spinner, SectionLabel } from '../../ui'
import toast from 'react-hot-toast'

/** Loads the Premier League fixture list now, rather than waiting for the job. */
export async function refreshLmsFixtures() {
  const { data, error } = await supabase.functions.invoke('sync-lms', { body: { mode: 'fixtures' } })
  if (error) throw error
  if (!data?.ok) throw new Error(data?.error || 'Could not load the fixtures')
  return data
}

/**
 * Start the first game for a new Last Man Standing. Used straight after the
 * competition is created, so the admin has nothing more to do. Loads the
 * fixtures first if this project has none yet.
 */
export async function startLmsGame(competitionId, points, startRound = null) {
  let { data, error } = await supabase.rpc('lms_start_game', {
    p_competition_id: competitionId, p_points: points, p_start_round: startRound,
  })
  if (!error && data?.error === 'no_fixtures') {
    await refreshLmsFixtures()
    ;({ data, error } = await supabase.rpc('lms_start_game', {
      p_competition_id: competitionId, p_points: points, p_start_round: startRound,
    }))
  }
  if (error) throw error
  if (!data?.ok) throw new Error(LMS_ERRORS[data?.error] || 'Could not start the game')
  return data
}

/**
 * Admin → Game, for a Last Man Standing. Start a game (points each, first
 * gameweek), change it before it starts, or stop it. Results need nothing:
 * the app settles each gameweek by itself.
 */
export default function LmsAdmin({ competitionId }) {
  const [data, setData] = useState(null)
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [points, setPoints] = useState(10)
  const [startRound, setStartRound] = useState('')

  useEffect(() => { load() }, [competitionId])

  async function load() {
    setLoading(true)
    try {
      const [d, season] = await Promise.all([loadLms(supabase, competitionId), currentSeason(supabase)])
      const up = await upcomingRounds(supabase, season)
      setData(d)
      setRounds(up)
      const live = d.game && ['open', 'running'].includes(d.game.status)
      setPoints(live && d.game.status === 'open' ? d.game.points_per_player : (d.game?.points_per_player || 10))
      setStartRound(String(live && d.game.status === 'open' ? d.game.start_round : (up[0]?.round ?? '')))
    } finally { setLoading(false) }
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
  const roundLabel = r => `GW${r.round} · first kick-off ${formatUK(r.lock, { weekday: 'short', day: 'numeric', month: 'short' })}`

  const roundPicker = (
    rounds.length ? (
      <Select value={startRound} onChange={e => setStartRound(e.target.value)}>
        {rounds.map(r => <option key={r.round} value={r.round}>{roundLabel(r)}</option>)}
      </Select>
    ) : (
      <div className="flex items-center gap-2">
        <p className="text-xs flex-1" style={{ color: 'var(--txt-muted)' }}>No Premier League fixtures loaded yet.</p>
        <Button size="sm" disabled={busy} onClick={() => act(refreshLmsFixtures, 'Fixtures loaded')}>Load fixtures</Button>
      </div>
    )
  )

  return (
    <div>
      {live && (
        <Card className="p-4 mb-4">
          <SectionLabel>Game {game.game_number} · {game.status === 'open' ? 'taking entries' : 'under way'}</SectionLabel>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <Stat label="Pot" value={`${data.pot}`} sub="pts" />
            <Stat label="Players" value={data.entries.length} sub={`${data.entries.filter(e => e.status === 'alive').length} still in`} />
            <Stat label="Gameweek" value={`GW${game.current_round}`} sub={data.lock ? (data.locked ? 'locked' : `locks ${formatUK(data.lock, { weekday: 'short' })}`) : '—'} />
          </div>
          {game.carried_points > 0 && (
            <p className="text-[11px] mt-3" style={{ color: 'var(--txt-muted)' }}>Includes {game.carried_points} pts rolled over from the last game.</p>
          )}

          {game.status === 'open' && (
            <div className="mt-4 pt-4 flex flex-col gap-3" style={{ borderTop: '0.5px solid var(--border)' }}>
              <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                Anyone who joins with the code before the first kick-off is entered. It starts by itself at the first kick-off (with at least 2 players; otherwise it moves to the next gameweek).
              </p>
              <Field label="Points each player brings"><Input type="number" min={1} max={1000} value={points} onChange={e => setPoints(e.target.value)} /></Field>
              <Field label="First gameweek">{roundPicker}</Field>
              <Button variant="primary" disabled={busy || !startRound}
                onClick={() => act(() => rpc('lms_update_game', { p_game_id: game.id, p_points: pts, p_start_round: Number(startRound) }), 'Game updated')}>
                Save changes
              </Button>
            </div>
          )}

          <div className="mt-4 pt-3 flex items-center justify-between gap-2" style={{ borderTop: '0.5px solid var(--border)' }}>
            <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>Results and knock-outs are automatic.</p>
            <Button size="sm" disabled={busy} onClick={() => {
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
            <Field label="Points each player brings"><Input type="number" min={1} max={1000} value={points} onChange={e => setPoints(e.target.value)} /></Field>
            <Field label="First gameweek">{roundPicker}</Field>
            {lastNoWinner && (
              <p className="text-xs" style={{ color: 'var(--green)' }}>{lastNoWinner.pot} pts roll over from Game {lastNoWinner.game_number}.</p>
            )}
            <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>Everyone in this competition is entered. Points are bragging points only, never money.</p>
            <Button variant="primary" disabled={busy || !startRound}
              onClick={() => act(() => startLmsGame(competitionId, pts, Number(startRound)), 'Game started')}>
              Start game
            </Button>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>Fixtures and results update by themselves every few minutes.</p>
        <Button size="sm" className="flex-shrink-0 whitespace-nowrap" disabled={busy} onClick={() => act(refreshLmsFixtures, 'Fixtures refreshed')}>Refresh now</Button>
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
