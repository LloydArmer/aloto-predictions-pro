import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { formatUK } from '../../../lib/time'
import {
  loadLms, usedTeams, pickState, STATE_STYLE, scoreLine, OUT_REASON, LMS_ERRORS, VOID,
} from '../../../lib/lms'
import { Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import toast from 'react-hot-toast'

const TABS = [
  { key: 'pick',    label: 'My pick',  icon: 'ti-target-arrow' },
  { key: 'players', label: 'Players',  icon: 'ti-users' },
  { key: 'history', label: 'History',  icon: 'ti-history' },
]

/**
 * Last Man Standing, for players. Shown in place of the football Dashboard,
 * Predict and Standings whenever the competition selected is a Last Man
 * Standing (see App.jsx), so it carries its own competition switcher.
 *
 *   My pick   the gameweek's fixtures; tap the team you think will win.
 *   Players   who's still in, who's out and why, who has picked.
 *   History   every gameweek's picks once locked, and past games.
 */
export default function LastManStanding({ initialTab = 'pick' }) {
  const { user } = useAuth()
  const { competitions } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const [tab, setTab] = useState(initialTab)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  useEffect(() => { setTab(initialTab) }, [initialTab])
  useEffect(() => { if (comp && user) load(); }, [comp, user?.id])

  async function load(quiet = false) {
    if (!quiet) setLoading(true)
    try { setData(await loadLms(supabase, comp)) }
    finally { setLoading(false) }
  }

  // While the gameweek is being played, keep the scores fresh.
  const playing = data?.locked && data?.game?.status === 'running'
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => load(true), 60000)
    return () => clearInterval(t)
  }, [playing, comp])

  const me = data?.entries?.find(e => e.user_id === user?.id)
  const myPicks = useMemo(() => (data?.picks || []).filter(p => p.user_id === user?.id), [data, user?.id])
  const myPick = myPicks.find(p => p.round === data?.game?.current_round)

  async function pick(teamId, teamName) {
    setSaving(teamId)
    try {
      const { data: r, error } = await supabase.rpc('lms_make_pick', { p_game_id: data.game.id, p_team_id: teamId })
      if (error) throw error
      if (!r?.ok) { toast.error(LMS_ERRORS[r?.error] || 'Could not save your pick'); return }
      toast.success(`${teamName} picked for GW${data.game.current_round}`)
      await load(true)
    } catch (err) {
      toast.error(err.message || 'Could not save your pick')
    } finally { setSaving(null) }
  }

  const compObj = competitions.find(c => c.id === comp)

  return (
    <div>
      <CompetitionSelector value={comp} onChange={setComp} />
      {loading || !data ? <div className="flex justify-center py-20"><Spinner size="lg" /></div> : !data.game ? (
        <Card className="p-6 text-center">
          <EmptyState icon="ti-crown" title="No game yet"
            description={compObj?.my_role === 'admin'
              ? 'Start the first game in Admin → Game.'
              : 'The admin will start the first game soon. You are already in it.'}
            action={compObj?.my_role === 'admin' ? <Link to="/admin" className="btn btn-primary btn-sm">Go to Admin</Link> : null} />
        </Card>
      ) : <>
        <GameHeader data={data} me={me} />

        <div className="tab-strip mb-3">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
              style={{ background: tab === t.key ? 'var(--accent-dim)' : 'transparent', color: tab === t.key ? 'var(--accent)' : 'var(--txt-second)', fontWeight: tab === t.key ? 500 : 400 }}>
              <i className={`ti ${t.icon}`} aria-hidden="true" />{t.label}
            </button>
          ))}
        </div>

        {tab === 'pick' && <PickTab data={data} me={me} myPicks={myPicks} myPick={myPick} onPick={pick} saving={saving} />}
        {tab === 'players' && <PlayersTab data={data} userId={user?.id} />}
        {tab === 'history' && <HistoryTab data={data} userId={user?.id} />}
      </>}
    </div>
  )
}

// ───────────────────────── Header ─────────────────────────
function GameHeader({ data, me }) {
  const { game, entries, pot, lock, locked } = data
  const alive = entries.filter(e => e.status === 'alive').length
  const finished = game.status === 'won' || game.status === 'no_winner'

  let line
  if (game.status === 'won') line = `Won by ${game.winner?.display_name || 'a player'} in GW${game.ended_round}`
  else if (game.status === 'no_winner') line = `No winner. Everyone left went out in GW${game.ended_round}, so the pot rolls over`
  else if (!lock) line = `GW${game.current_round} · fixtures loading`
  else if (locked) line = `GW${game.current_round} · locked, results come in automatically`
  else line = `GW${game.current_round} · picks lock ${formatUK(lock, { weekday: 'short', day: 'numeric', month: 'short' })}`

  const myLine = !me ? { t: 'Not in this game', c: 'var(--txt-muted)' }
    : me.status === 'winner' ? { t: 'Winner 🏆', c: 'var(--gold, var(--amber))' }
    : me.status === 'out' ? { t: `Out in GW${me.out_round}`, c: 'var(--red)' }
    : { t: 'Still in', c: 'var(--green)' }

  return (
    <Card className="p-4 mb-3">
      <div className="flex items-start justify-between gap-3">
        <div style={{ minWidth: 0 }}>
          <SectionLabel>Last Man Standing · Game {game.game_number}</SectionLabel>
          <p className="text-3xl font-bold mt-1" style={{ color: 'var(--txt-primary)' }}>
            {pot}<span className="text-sm font-medium ml-1.5" style={{ color: 'var(--txt-muted)' }}>pts in the pot</span>
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-muted)' }}>
            {game.points_per_player} × {entries.length} player{entries.length === 1 ? '' : 's'}
            {game.carried_points > 0 && ` + ${game.carried_points} rolled over`}
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ color: myLine.c, background: 'var(--bg-raised)', border: '0.5px solid var(--border-med)' }}>
          {myLine.t}
        </span>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 text-xs" style={{ borderTop: '0.5px solid var(--border)' }}>
        <span style={{ color: finished ? 'var(--txt-primary)' : 'var(--txt-second)' }}>{line}</span>
        {!finished && <span className="font-semibold" style={{ color: 'var(--txt-primary)' }}>{alive} left</span>}
      </div>
    </Card>
  )
}

// ───────────────────────── My pick ─────────────────────────
function PickTab({ data, me, myPicks, myPick, onPick, saving }) {
  const { game, current, locked, fixturesById } = data
  const finished = !['open', 'running'].includes(game.status)

  if (finished) return (
    <Card className="p-4">
      <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>
        {game.status === 'won'
          ? `${game.winner?.display_name || 'The winner'} took the ${game.pot} point pot.`
          : `Nobody was left standing, so the ${game.pot} points roll into the next game.`}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>The next game starts when the admin sets it up. Everyone in the competition is entered.</p>
    </Card>
  )

  if (!me) return (
    <Card className="p-4">
      <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>You joined after this game started.</p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>You'll be in the next game. Follow how this one goes in Players.</p>
    </Card>
  )

  if (me.status === 'out') {
    const lastPick = myPicks.find(p => p.round === me.out_round)
    return (
      <Card className="p-4">
        <p className="text-sm font-semibold" style={{ color: 'var(--red)' }}>You're out</p>
        <p className="text-xs mt-1" style={{ color: 'var(--txt-second)' }}>
          {me.out_reason === 'no_pick'
            ? `No pick for GW${me.out_round}.`
            : `${lastPick?.team_name || 'Your team'} ${me.out_reason} in GW${me.out_round}.`}
          {' '}Keep an eye on who's left in Players.
        </p>
      </Card>
    )
  }

  const used = usedTeams(myPicks, game.current_round)

  if (locked) {
    const f = myPick ? fixturesById.get(myPick.api_fixture_id) : null
    const state = myPick ? pickState(myPick, f) : null
    const st = state ? STATE_STYLE[state] : null
    return (
      <Card className="p-4">
        <SectionLabel>Your GW{game.current_round} pick</SectionLabel>
        {myPick ? <>
          <div className="flex items-center justify-between mt-2">
            <p className="text-lg font-bold" style={{ color: 'var(--txt-primary)' }}>{myPick.team_name}</p>
            <span className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>
            {scoreLine(f) || (f ? `${f.home_team} v ${f.away_team} · ${formatUK(f.kickoff, { weekday: 'short' })}` : '')}
          </p>
          <p className="text-[11px] mt-2" style={{ color: 'var(--txt-muted)' }}>
            Scores update every few minutes. Players move on automatically once every game this gameweek has finished.
          </p>
        </> : (
          <p className="text-sm mt-2" style={{ color: 'var(--red)' }}>No pick made. You'll be out when the gameweek is settled.</p>
        )}
      </Card>
    )
  }

  if (!current.length) return (
    <Card className="p-4">
      <p className="text-sm" style={{ color: 'var(--txt-muted)' }}>The GW{game.current_round} fixtures aren't loaded yet. They appear automatically.</p>
    </Card>
  )

  return (
    <div>
      <Card className="p-3 mb-3" style={myPick ? undefined : { background: 'var(--amber-dim)', borderColor: 'var(--amber-line)' }}>
        <p className="text-sm font-semibold" style={{ color: myPick ? 'var(--green)' : 'var(--amber)' }}>
          {myPick ? `Your pick: ${myPick.team_name}` : 'Pick a team to win'}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-muted)' }}>
          {myPick ? 'You can change it until the first kick-off. ' : 'Win and you go through, draw or lose and you are out. '}
          Nobody sees your pick until picks lock.
        </p>
      </Card>

      {current.map(f => {
        const off = VOID.includes(f.status)
        return (
          <Card key={f.api_fixture_id} className="p-2.5 mb-2">
            <p className="text-[11px] text-center mb-1.5" style={{ color: 'var(--txt-muted)' }}>
              {off ? 'Postponed' : formatUK(f.kickoff, { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
            <div className="flex items-center gap-2">
              <TeamButton id={f.home_team_id} name={f.home_team} off={off} used={used} myPick={myPick} saving={saving} onPick={onPick} />
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--txt-muted)' }}>v</span>
              <TeamButton id={f.away_team_id} name={f.away_team} off={off} used={used} myPick={myPick} saving={saving} onPick={onPick} />
            </div>
          </Card>
        )
      })}

      {used.size > 0 && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--txt-muted)' }}>
          Already used: {[...used.entries()].map(([, r]) => myPicks.find(p => p.round === r)?.team_name).filter(Boolean).join(', ')}
        </p>
      )}
    </div>
  )
}

function TeamButton({ id, name, off, used, myPick, saving, onPick }) {
  const chosen = myPick?.team_id === id
  const usedRound = used.get(id)
  const disabled = off || usedRound != null || saving != null
  return (
    <button type="button" disabled={disabled} onClick={() => !chosen && onPick(id, name)}
      className="flex-1 rounded-lg px-2 py-2.5 text-sm font-semibold text-center transition-colors"
      style={{
        minWidth: 0,
        background: chosen ? 'var(--accent)' : 'var(--bg-raised)',
        color: chosen ? 'var(--on-accent)' : usedRound != null || off ? 'var(--txt-muted)' : 'var(--txt-primary)',
        border: `0.5px solid ${chosen ? 'var(--accent)' : 'var(--border-med)'}`,
        textDecoration: usedRound != null ? 'line-through' : 'none',
        opacity: saving === id ? 0.6 : 1,
      }}>
      <span className="block truncate">{name}</span>
      {usedRound != null && <span className="block text-[10px] font-normal" style={{ textDecoration: 'none' }}>used GW{usedRound}</span>}
      {chosen && <span className="block text-[10px] font-normal">your pick ✓</span>}
    </button>
  )
}

// ───────────────────────── Players ─────────────────────────
function PlayersTab({ data, userId }) {
  const { game, entries, picks, locked, hasPick, fixturesById } = data
  const name = e => e.profile?.display_name || 'Player'
  const thisRound = new Map(picks.filter(p => p.round === game.current_round).map(p => [p.user_id, p]))
  const pickIn = (uid, r) => picks.find(p => p.user_id === uid && p.round === r)

  const winners = entries.filter(e => e.status === 'winner')
  const alive = entries.filter(e => e.status === 'alive').sort((a, b) => name(a).localeCompare(name(b)))
  const out = entries.filter(e => e.status === 'out')
    .sort((a, b) => (b.out_round ?? 0) - (a.out_round ?? 0) || name(a).localeCompare(name(b)))
  const running = ['open', 'running'].includes(game.status)
  const picked = alive.filter(e => hasPick.get(e.user_id)).length

  return (
    <div>
      {winners.map(e => (
        <Card key={e.user_id} className="p-3 mb-3" style={{ borderColor: 'var(--gold-line, var(--amber-line))', background: 'var(--gold-dim, var(--amber-dim))' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--txt-primary)' }}>🏆 {name(e)}{e.user_id === userId && ' (you)'}</p>
          <p className="text-[11px]" style={{ color: 'var(--txt-second)' }}>Last one standing, won {game.pot} pts in GW{game.ended_round}</p>
        </Card>
      ))}

      {running && (
        <Card className="mb-3 overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <SectionLabel>Still in ({alive.length})</SectionLabel>
            {!locked && <span className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>{picked} of {alive.length} picked</span>}
          </div>
          {alive.map(e => {
            const p = thisRound.get(e.user_id)
            const st = locked && p ? STATE_STYLE[pickState(p, fixturesById.get(p.api_fixture_id))] : null
            return (
              <Row key={e.user_id} mine={e.user_id === userId} name={name(e)}
                right={locked
                  ? (p ? <span><span style={{ color: 'var(--txt-primary)' }}>{p.team_name}</span> <span style={{ color: st.color }}>· {st.label}</span></span>
                       : <span style={{ color: 'var(--red)' }}>No pick</span>)
                  : (hasPick.get(e.user_id)
                      ? <span style={{ color: 'var(--green)' }}>Picked ✓</span>
                      : <span style={{ color: 'var(--txt-muted)' }}>Not picked yet</span>)} />
            )
          })}
        </Card>
      )}

      {out.length > 0 && (
        <Card className="mb-3 overflow-hidden">
          <div className="px-4 pt-3 pb-2"><SectionLabel>Out ({out.length})</SectionLabel></div>
          {out.map(e => {
            const p = pickIn(e.user_id, e.out_round)
            return (
              <Row key={e.user_id} mine={e.user_id === userId} name={name(e)} faded
                right={<span style={{ color: 'var(--txt-muted)' }}>
                  GW{e.out_round} · {e.out_reason === 'no_pick' ? 'no pick' : `${p?.team_name || 'team'} ${OUT_REASON[e.out_reason]}`}
                </span>} />
            )
          })}
        </Card>
      )}
    </div>
  )
}

function Row({ name, right, mine, faded }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs"
      style={{ borderTop: '0.5px solid var(--border)', background: mine ? 'var(--accent-dim)' : 'transparent' }}>
      <span className="flex-1 truncate text-sm" style={{ color: faded ? 'var(--txt-second)' : mine ? 'var(--accent)' : 'var(--txt-primary)', fontWeight: mine ? 700 : 500 }}>
        {name}{mine && ' (you)'}
      </span>
      <span className="text-right" style={{ minWidth: 0 }}>{right}</span>
    </div>
  )
}

// ───────────────────────── History ─────────────────────────
function HistoryTab({ data, userId }) {
  const { game, games, entries, picks, locked } = data
  const names = new Map(entries.map(e => [e.user_id, e.profile?.display_name || 'Player']))
  const lastShown = locked || !['open', 'running'].includes(game.status) ? game.current_round : game.current_round - 1
  const rounds = []
  for (let r = lastShown; r >= game.start_round; r--) rounds.push(r)

  return (
    <div>
      {rounds.length === 0 && (
        <Card className="p-4 mb-3">
          <p className="text-sm" style={{ color: 'var(--txt-muted)' }}>Picks show here once the first gameweek locks.</p>
        </Card>
      )}

      {rounds.map(r => {
        const list = picks.filter(p => p.round === r)
          .sort((a, b) => (names.get(a.user_id) || '').localeCompare(names.get(b.user_id) || ''))
        return (
          <Card key={r} className="mb-3 overflow-hidden">
            <div className="px-4 pt-3 pb-2"><SectionLabel>GW{r}</SectionLabel></div>
            {list.length === 0 && <p className="px-4 pb-3 text-xs" style={{ color: 'var(--txt-muted)' }}>No picks.</p>}
            {list.map(p => {
              const st = STATE_STYLE[pickState(p, data.fixturesById.get(p.api_fixture_id))]
              return (
                <Row key={p.id} mine={p.user_id === userId} name={names.get(p.user_id) || 'Player'}
                  right={<span><span style={{ color: 'var(--txt-primary)' }}>{p.team_name}</span> <span style={{ color: st.color }}>· {st.label}</span></span>} />
              )
            })}
          </Card>
        )
      })}

      {games.filter(g => g.status === 'won' || g.status === 'no_winner').length > 0 && (
        <Card className="mb-3 overflow-hidden">
          <div className="px-4 pt-3 pb-2"><SectionLabel>Past games</SectionLabel></div>
          {games.filter(g => g.status === 'won' || g.status === 'no_winner').map(g => (
            <Row key={g.id} name={`Game ${g.game_number}`}
              right={<span style={{ color: 'var(--txt-second)' }}>
                {g.status === 'won' ? `${g.winner?.display_name || 'Winner'} won ${g.pot} pts` : `No winner · ${g.pot} pts rolled over`}
              </span>} />
          ))}
        </Card>
      )}
    </div>
  )
}
