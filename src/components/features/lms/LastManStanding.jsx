import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../../hooks/useSelectedCompetition'
import { supabase } from '../../../lib/supabase'
import { formatUK } from '../../../lib/time'
import {
  loadLms, usedTeams, pickState, STATE_STYLE, scoreLine, OUT_REASON, LMS_ERRORS,
  roundName, entryTag, MAX_ENTRIES, countdown,
} from '../../../lib/lms'
import { PickGrid, LiveGames, RemainingTeams } from './LmsStats'
import { TeamPicker } from './LmsPicker'
import LmsPlanner from './LmsPlanner'
import LmsApprovals from './LmsApprovals'
import { Card, SectionLabel, Spinner, EmptyState } from '../../ui'
import CompetitionSelector from '../../layout/CompetitionSelector'
import JoinCompetition from '../competitions/JoinCompetition'
import toast from 'react-hot-toast'

// Each bottom-bar page shows its own part of the game (Brittany, 18 Nov 2026):
//   Dashboard  how the gameweek is going: the pot, the countdown, your entries
//              at a glance, approvals, and the gameweek's games live.
//   Predict    what you do: this week's pick and the planner.
//   Standings  everyone else: who's still in, the grid of picks, past games.
const PAGES = {
  dashboard: [],
  predict: [
    { key: 'pick',    label: 'This week', icon: 'ti-target-arrow' },
    { key: 'planner', label: 'Planner',   icon: 'ti-route' },
  ],
  standings: [
    { key: 'players', label: 'Players', icon: 'ti-users' },
    { key: 'grid',    label: 'Grid',    icon: 'ti-table' },
    { key: 'history', label: 'History', icon: 'ti-history' },
  ],
}

/**
 * Last Man Standing, for players. Shown in place of the football or NFL
 * Dashboard, Predict and Standings whenever the competition selected is a Last
 * Man Standing (see App.jsx), so it carries its own competition switcher.
 * `page` says which of the three it is (see PAGES):
 *
 *   dashboard  game header, your entries at a glance, approvals, games live.
 *   predict    This week: your entries and the teams to pick from, with form,
 *              table position and teams left. Planner: the gameweeks ahead.
 *   standings  Players: who's still in, out and why. Grid: every pick in every
 *              gameweek. History: past gameweeks and games.
 */
export default function LastManStanding({ page = 'dashboard' }) {
  const { user } = useAuth()
  const { competitions, loading: compsLoading } = useCompetitions()
  const [comp, setComp] = useSelectedCompetition(competitions)
  const tabs = PAGES[page] || []
  const [tab, setTab] = useState(tabs[0]?.key || null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [entryId, setEntryId] = useState(null)

  useEffect(() => { setTab((PAGES[page] || [])[0]?.key || null) }, [page])
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

  const myEntries = useMemo(
    () => (data?.allEntries || []).filter(e => e.user_id === user?.id).sort((a, b) => a.entry_no - b.entry_no),
    [data, user?.id])
  // The entry on screen: the one chosen, else the first still in.
  const entry = myEntries.find(e => e.id === entryId)
    || myEntries.find(e => e.status === 'alive') || myEntries[0] || null
  const entryPicks = useMemo(() => (data?.picks || []).filter(p => p.entry_id === entry?.id), [data, entry?.id])
  const entryPick = entryPicks.find(p => p.round === data?.game?.current_round)

  async function call(fn, args, ok) {
    const { data: r, error } = await supabase.rpc(fn, args)
    if (error) throw error
    if (!r?.ok) { toast.error(LMS_ERRORS[r?.error] || 'Something went wrong'); return null }
    if (ok) toast.success(ok)
    await load(true)
    return r
  }

  async function pick(teamId, teamName) {
    setSaving(teamId)
    try {
      const tag = myEntries.length > 1 ? ` (entry ${entry.entry_no})` : ''
      await call('lms_make_pick', { p_entry_id: entry.id, p_team_id: teamId },
        `${teamName} picked for ${roundName(data.game, data.game.current_round)}${tag}`)
    } catch (err) {
      toast.error(err.message || 'Could not save your pick')
    } finally { setSaving(null) }
  }

  async function addEntry() {
    const first = myEntries.length === 0
    const isAdmin = compObj?.my_role === 'admin'
    const ask = first
      ? `Join this game? It's for points only: no money, nothing to pay.`
      : `Add another entry? It's a separate life with its own picks.`
    if (!window.confirm(isAdmin ? ask : `${ask} The admin needs to approve it before the first kick-off.`)) return
    setSaving('entry')
    try {
      const r = await call('lms_add_entry', { p_game_id: data.game.id })
      if (r) {
        toast.success(r.approved === false ? 'Sent to the admin for approval' : (first ? "You're in" : 'Entry added'))
        setEntryId(r.entry_id)
      }
    } catch (err) { toast.error(err.message || 'Could not add an entry') }
    finally { setSaving(null) }
  }

  async function removeEntry(e) {
    if (!window.confirm(`Remove entry ${e.entry_no}?`)) return
    setSaving('entry')
    try {
      await call('lms_remove_entry', { p_entry_id: e.id }, 'Entry removed')
      setEntryId(null)
    } catch (err) { toast.error(err.message || 'Could not remove the entry') }
    finally { setSaving(null) }
  }

  const compObj = competitions.find(c => c.id === comp)

  // In the Last Man Standing section with none to show yet: how to get one.
  if (!compsLoading && competitions.length === 0) return (
    <div>
      <Card className="p-6 text-center mb-4">
        <EmptyState icon="ti-crown" title="No Last Man Standing yet"
          description="Pick one team to win each week; the last one standing wins the bragging points. Points only, never money. Join one with the code you were sent, or set one up in Admin."
          action={<Link to="/admin" className="btn btn-primary btn-sm">Set one up in Admin</Link>} />
      </Card>
      <JoinCompetition onJoined={() => window.location.reload()} />
    </div>
  )

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
        {page === 'dashboard'
          ? <GameHeader data={data} mine={myEntries} />
          : <SlimHeader data={data} mine={myEntries} />}

        {tabs.length > 0 && <div className="tab-strip mb-3">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
              style={{ background: tab === t.key ? 'var(--accent-dim)' : 'transparent', color: tab === t.key ? 'var(--accent)' : 'var(--txt-second)', fontWeight: tab === t.key ? 500 : 400 }}>
              <i className={`ti ${t.icon}`} aria-hidden="true" />{t.label}
            </button>
          ))}
        </div>}

        {page === 'dashboard' && <>
          <MyEntries data={data} mine={myEntries} />
          <LmsApprovals data={data} isAdmin={compObj?.my_role === 'admin'} onDone={() => load(true)} />
          <LiveGames data={data} userId={user?.id} />
        </>}

        {page === 'predict' && (tab === 'pick' || tab === 'planner') && (
          <EntryBar data={data} mine={myEntries} entry={entry} onSelect={setEntryId}
            onAdd={addEntry} onRemove={removeEntry} saving={saving} />
        )}
        {page === 'predict' && tab === 'pick' && <PickTab data={data} me={entry} myPicks={entryPicks} myPick={entryPick} onPick={pick} saving={saving} />}
        {page === 'standings' && tab === 'players' && (
          <LmsApprovals data={data} isAdmin={compObj?.my_role === 'admin'} onDone={() => load(true)} />
        )}
        {page === 'standings' && tab === 'players' && <PlayersTab data={data} userId={user?.id} />}
        {page === 'standings' && tab === 'grid' && <PickGrid data={data} userId={user?.id} />}
        {page === 'predict' && tab === 'planner' && <LmsPlanner data={data} entry={entry} entryPicks={entryPicks} onSaved={() => load(true)} />}
        {page === 'standings' && tab === 'history' && <HistoryTab data={data} userId={user?.id} />}
      </>}
    </div>
  )
}

// ───────────────────────── Header ─────────────────────────
function GameHeader({ data, mine }) {
  const { game, entries, pot, lock, locked, players, hasPick } = data
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])
  const rn = r => roundName(game, r)
  const aliveEntries = entries.filter(e => e.status === 'alive')
  const alive = aliveEntries.length
  const playersLeft = new Set(aliveEntries.map(e => e.user_id)).size
  const toPick = aliveEntries.filter(e => !hasPick.get(e.id)).length
  const left = lock && !locked ? countdown(lock, now) : null
  const finished = game.status === 'won' || game.status === 'no_winner'

  let line
  if (game.status === 'won') line = `Won by ${game.winner?.display_name || 'a player'} in ${rn(game.ended_round)}`
  else if (game.status === 'no_winner') line = `No winner. Everyone left went out in ${rn(game.ended_round)}, so the points carry over`
  else if (!lock) line = `${rn(game.current_round)} · fixtures loading`
  else if (locked) line = `${rn(game.current_round)} · locked, results come in automatically`
  else line = `${rn(game.current_round)} · picks lock ${formatUK(lock, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`

  const myLine = myStatus(mine)

  return (
    <Card className="p-4 mb-3">
      <div className="flex items-start justify-between gap-3">
        <div style={{ minWidth: 0 }}>
          <SectionLabel>Last Man Standing · {game.league_name} · Game {game.game_number}</SectionLabel>
          <p className="text-3xl font-bold mt-1" style={{ color: 'var(--txt-primary)' }}>
            {pot}<span className="text-sm font-medium ml-1.5" style={{ color: 'var(--txt-muted)' }}>points to play for</span>
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-muted)' }}>
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} from {players} player{players === 1 ? '' : 's'}
            {game.carried_points > 0 && ` + ${game.carried_points} carried over`}
            {' · Bragging points only, no money'}
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ color: myLine.c, background: 'var(--bg-raised)', border: '0.5px solid var(--border-med)' }}>
          {myLine.t}
        </span>
      </div>
      {!finished && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <Stat label={left ? 'Picks lock in' : 'Status'} value={left || (locked ? 'Locked' : '–')} accent={!!left} />
          <Stat label="Players left" value={`${playersLeft}/${players}`} />
          <Stat label={locked ? 'Entries left' : 'Picks'}
            value={locked ? `${alive}/${entries.length}` : toPick === 0 && alive > 0 ? 'All in ✓' : `${toPick} to pick`}
            color={!locked ? (toPick === 0 && alive > 0 ? 'var(--green)' : 'var(--amber)') : undefined} />
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-3 text-xs" style={{ borderTop: '0.5px solid var(--border)' }}>
        <span style={{ color: finished ? 'var(--txt-primary)' : 'var(--txt-second)' }}>{line}</span>
        {!finished && <span className="font-semibold flex-shrink-0 ml-2" style={{ color: 'var(--txt-primary)' }}>{alive} left</span>}
      </div>
    </Card>
  )
}

/** Predict and Standings: one line with the gameweek, the deadline and your status. */
function SlimHeader({ data, mine }) {
  const { game, lock, locked, entries } = data
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])
  const rn = r => roundName(game, r)
  const finished = !['open', 'running'].includes(game.status)
  const left = lock && !locked ? countdown(lock, now) : null
  const alive = entries.filter(e => e.status === 'alive').length
  const s = myStatus(mine)
  return (
    <Card className="px-4 py-2.5 mb-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span style={{ color: 'var(--txt-second)', minWidth: 0 }} className="truncate">
          <span className="font-semibold" style={{ color: 'var(--txt-primary)' }}>{finished ? `Game ${game.game_number} finished` : rn(game.current_round)}</span>
          {!finished && (left
            ? <> · picks lock in <span className="font-semibold" style={{ color: 'var(--accent)' }}>{left}</span></>
            : locked ? ' · locked' : '')}
          {!finished && ` · ${alive} left`}
        </span>
        <span className="font-semibold flex-shrink-0" style={{ color: s.c }}>{s.t}</span>
      </div>
    </Card>
  )
}

function myStatus(mine) {
  const myIn = mine.filter(e => e.approved !== false)
  const myAlive = myIn.filter(e => e.status === 'alive').length
  return !mine.length ? { t: 'Not in this game', c: 'var(--txt-muted)' }
    : mine.every(e => e.approved === false) ? { t: 'Waiting for approval', c: 'var(--amber)' }
    : mine.some(e => e.status === 'winner') ? { t: 'Winner 🏆', c: 'var(--gold, var(--amber))' }
    : myAlive === 0 ? { t: 'Out', c: 'var(--red)' }
    : { t: myIn.length > 1 ? `${myAlive} of ${myIn.length} still in` : 'Still in', c: 'var(--green)' }
}

/** Dashboard: each of your entries in one line, with this gameweek's pick. */
function MyEntries({ data, mine }) {
  const { game, picks, locked, fixturesById } = data
  const rn = r => roundName(game, r)
  const running = ['open', 'running'].includes(game.status)
  const canJoin = game.status === 'open' && !locked && mine.length < MAX_ENTRIES
  if (!running && !mine.length) return null

  const needPick = !locked && mine.some(e => e.status === 'alive' && !picks.some(p => p.entry_id === e.id && p.round === game.current_round))

  return (
    <Card className="mb-3 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <SectionLabel>{mine.length > 1 ? 'Your entries' : 'Your entry'}</SectionLabel>
        {running && (mine.length ? (needPick || canJoin) : canJoin) && (
          <Link to="/predict" className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: needPick ? 'var(--accent)' : 'var(--accent-dim)', color: needPick ? 'var(--on-accent)' : 'var(--accent)' }}>
            {needPick ? 'Make your pick →' : mine.length ? '+ Add entry →' : 'Join this game →'}
          </Link>
        )}
      </div>
      {!mine.length && (
        <p className="px-4 pb-3 text-xs" style={{ color: 'var(--txt-muted)' }}>
          {canJoin ? "You're not in this game yet. Join on Predict before the first kick-off." : "You're not in this game. You can join the next one."}
        </p>
      )}
      {mine.map(e => {
        const p = picks.find(x => x.entry_id === e.id && x.round === game.current_round)
        const outPick = e.status === 'out' ? picks.find(x => x.entry_id === e.id && x.round === e.out_round) : null
        const st = locked && p ? STATE_STYLE[pickState(p, fixturesById.get(p.api_fixture_id))] : null
        let right
        if (e.approved === false) right = <span style={{ color: 'var(--amber)' }}>Waiting for approval</span>
        else if (e.status === 'winner') right = <span style={{ color: 'var(--gold, var(--amber))' }}>Winner 🏆</span>
        else if (e.status === 'out') right = <span style={{ color: 'var(--red)' }}>Out {rn(e.out_round)}{outPick ? ` · ${outPick.team_name}` : ''}</span>
        else if (locked) right = p
          ? <span><span style={{ color: 'var(--txt-primary)' }}>{p.team_name}</span>{p.auto && <AutoTag />} <span style={{ color: st.color }}>· {st.label}</span></span>
          : <span style={{ color: 'var(--amber)' }}>Auto pick coming</span>
        else right = p
          ? <span style={{ color: 'var(--green)' }}>{p.team_name} ✓</span>
          : <span style={{ color: 'var(--amber)' }}>Not picked yet</span>
        return (
          <div key={e.id} className="flex items-center gap-2 px-4 py-2 text-xs" style={{ borderTop: '0.5px solid var(--border)' }}>
            <span className="flex-1 text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{mine.length > 1 ? `Entry ${e.entry_no}` : 'You'}</span>
            <span className="text-right">{right}</span>
          </div>
        )
      })}
    </Card>
  )
}

function Stat({ label, value, accent, color }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--bg-raised)', border: `0.5px solid ${accent ? 'var(--accent-line)' : 'var(--border)'}` }}>
      <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--txt-muted)' }}>{label}</p>
      <p className="text-sm font-bold mt-0.5" style={{ color: color || (accent ? 'var(--accent)' : 'var(--txt-primary)') }}>{value}</p>
    </div>
  )
}

// ───────────────────────── Entries ─────────────────────────
function EntryBar({ data, mine, entry, onSelect, onAdd, onRemove, saving }) {
  const { game, locked, picks } = data
  const canAdd = game.status === 'open' && !locked && mine.length < MAX_ENTRIES
  if (!mine.length && !canAdd) return null
  if (mine.length === 1 && !canAdd && mine[0].approved !== false) return null

  return (
    <Card className="p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>Your entries</SectionLabel>
        {canAdd && entry && (mine.length > 1 || entry.approved === false) && (
          <button type="button" className="text-[11px]" style={{ color: 'var(--txt-muted)' }}
            disabled={saving != null} onClick={() => onRemove(entry)}>Remove entry {entry.entry_no}</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {mine.map(e => {
          const on = e.id === entry?.id
          const picked = picks.some(p => p.entry_id === e.id && p.round === game.current_round)
          const waiting = e.approved === false
          const color = e.status === 'out' ? 'var(--red)' : e.status === 'winner' ? 'var(--amber)' : picked ? 'var(--green)' : 'var(--amber)'
          return (
            <button key={e.id} type="button" onClick={() => onSelect(e.id)}
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                background: on ? 'var(--accent-dim)' : 'var(--bg-raised)',
                color: on ? 'var(--accent)' : 'var(--txt-primary)',
                border: `0.5px solid ${on ? 'var(--accent)' : 'var(--border-med)'}`,
              }}>
              Entry {e.entry_no}
              {waiting
                ? <span className="ml-1.5 text-[9px] font-bold" style={{ color: 'var(--amber)' }}>PENDING</span>
                : <span className="ml-1.5" style={{ color }}>●</span>}
            </button>
          )
        })}
        {canAdd && (
          <button type="button" onClick={onAdd} disabled={saving != null}
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: 'transparent', color: 'var(--accent)', border: '0.5px dashed var(--accent)' }}>
            {mine.length ? '+ Add entry' : 'Join this game'}
          </button>
        )}
      </div>
      {canAdd && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--txt-muted)' }}>
          Each entry is a separate life with its own picks. The admin approves each entry. Entries close at the first kick-off.
        </p>
      )}
    </Card>
  )
}

// ───────────────────────── My pick ─────────────────────────
function PickTab({ data, me, myPicks, myPick, onPick, saving }) {
  const { game, current, locked, fixturesById, teamCount } = data
  const rn = r => roundName(game, r)
  const finished = !['open', 'running'].includes(game.status)

  if (finished) return (
    <Card className="p-4">
      <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>
        {game.status === 'won'
          ? `${game.winner?.display_name || 'The winner'} won ${game.pot} bragging points.`
          : `Nobody was left standing, so the ${game.pot} points carry into the next game.`}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>
        {game.status === 'won'
          ? 'The next game starts when the admin sets it up. Everyone in the competition gets an entry.'
          : `Everyone in this game is re-entered in the next one for ${game.base_points} more points. New entries are worth ${game.base_points * (game.rollover_level + 2)}.`}
      </p>
    </Card>
  )

  if (!me && game.status === 'open' && !locked) return (
    <Card className="p-4">
      <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>You're not in this game yet.</p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>Tap Join this game above. The admin approves each entry, and you can join more than once for extra lives.</p>
    </Card>
  )

  if (!me) return (
    <Card className="p-4">
      <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>You joined after this game started.</p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>You'll be in the next game. Follow how this one goes in Standings.</p>
    </Card>
  )

  if (me.status === 'out') {
    const lastPick = myPicks.find(p => p.round === me.out_round)
    return (
      <Card className="p-4">
        <p className="text-sm font-semibold" style={{ color: 'var(--red)' }}>{me.entry_no > 1 ? `Entry ${me.entry_no} is out` : "You're out"}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--txt-second)' }}>
          {me.out_reason === 'no_pick'
            ? `No team left to give in ${rn(me.out_round)}.`
            : `${lastPick?.team_name || 'Your team'}${lastPick?.auto ? ' (given automatically)' : ''} ${me.out_reason} in ${rn(me.out_round)}.`}
          {' '}Keep an eye on who's left in Standings.
        </p>
      </Card>
    )
  }

  const used = usedTeams(myPicks, game.current_round, teamCount)

  if (locked) {
    const f = myPick ? fixturesById.get(myPick.api_fixture_id) : null
    const state = myPick ? pickState(myPick, f) : null
    const st = state ? STATE_STYLE[state] : null
    return (
      <Card className="p-4">
        <SectionLabel>{me.entry_no > 1 ? `Entry ${me.entry_no} · ` : 'Your '}{rn(game.current_round)} pick</SectionLabel>
        {myPick ? <>
          <div className="flex items-center justify-between mt-2">
            <p className="text-lg font-bold" style={{ color: 'var(--txt-primary)' }}>
              {myPick.team_name}
              {myPick.auto && <span className="text-[10px] font-semibold ml-2 px-1.5 py-0.5 rounded" style={{ color: 'var(--amber)', background: 'var(--amber-dim)' }}>AUTO</span>}
            </p>
            <span className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>
            {scoreLine(f) || (f ? `${f.home_team} v ${f.away_team} · ${formatUK(f.kickoff, { weekday: 'short' })}` : '')}
          </p>
          <p className="text-[11px] mt-2" style={{ color: 'var(--txt-muted)' }}>
            {myPick.auto && 'No pick was made, so this entry was given its planned team, or the lowest-placed team it had not used. '}
            Scores update every few minutes. Entries move on automatically once every game has finished.
          </p>
        </> : (
          <p className="text-sm mt-2" style={{ color: 'var(--amber)' }}>No pick made. This entry is being given its planned team, or the lowest-placed team it hasn't used; it shows here within a few minutes.</p>
        )}
      </Card>
    )
  }

  if (!current.length) return (
    <Card className="p-4">
      <p className="text-sm" style={{ color: 'var(--txt-muted)' }}>The {rn(game.current_round)} fixtures aren't loaded yet. They appear automatically.</p>
    </Card>
  )

  return (
    <div>
      {me.approved === false && (
        <Card className="p-3 mb-3" style={{ background: 'var(--amber-dim)', borderColor: 'var(--amber-line)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--amber)' }}>Waiting for the admin to approve this entry</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-muted)' }}>You can pick now. If it isn't approved by the first kick-off, it's removed.</p>
        </Card>
      )}
      <Card className="p-3 mb-3" style={myPick ? undefined : { background: 'var(--amber-dim)', borderColor: 'var(--amber-line)' }}>
        <p className="text-sm font-semibold" style={{ color: myPick ? 'var(--green)' : 'var(--amber)' }}>
          {me.entry_no > 1
            ? `Entry ${me.entry_no}: ${myPick ? `your pick is ${myPick.team_name}` : 'pick a team to win'}`
            : (myPick ? `Your pick: ${myPick.team_name}` : 'Pick a team to win')}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-muted)' }}>
          {myPick ? 'You can change it until the first kick-off. ' : 'Win and you go through, draw or lose and you are out. No pick by the first kick-off and you get your planned team, or the lowest-placed team. '}
          Nobody sees your pick until picks lock.
        </p>
      </Card>

      <TeamPicker data={data} used={used} myPick={myPick} saving={saving} onPick={onPick}
        planned={data.plans.find(p => p.entry_id === me.id && p.round === game.current_round)} />

      <RemainingTeams data={data} entryPicks={myPicks} />
    </div>
  )
}

// ───────────────────────── Players ─────────────────────────
function PlayersTab({ data, userId }) {
  const { game, entries, picks, locked, hasPick, fixturesById } = data
  const rn = r => roundName(game, r)
  const name = e => `${e.profile?.display_name || 'Player'}${entryTag(e, entries) ? ` ${entryTag(e, entries)}` : ''}`
  const thisRound = new Map(picks.filter(p => p.round === game.current_round).map(p => [p.entry_id, p]))
  const pickIn = (entryId, r) => picks.find(p => p.entry_id === entryId && p.round === r)

  const winners = entries.filter(e => e.status === 'winner')
  const alive = entries.filter(e => e.status === 'alive').sort((a, b) => name(a).localeCompare(name(b)))
  const out = entries.filter(e => e.status === 'out')
    .sort((a, b) => (b.out_round ?? 0) - (a.out_round ?? 0) || name(a).localeCompare(name(b)))
  const running = ['open', 'running'].includes(game.status)
  const picked = alive.filter(e => hasPick.get(e.id)).length
  const winnerIds = [...new Set(winners.map(e => e.user_id))]

  return (
    <div>
      {winnerIds.map(uid => {
        const e = winners.find(w => w.user_id === uid)
        return (
          <Card key={uid} className="p-3 mb-3" style={{ borderColor: 'var(--gold-line, var(--amber-line))', background: 'var(--gold-dim, var(--amber-dim))' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--txt-primary)' }}>🏆 {e.profile?.display_name || 'Player'}{uid === userId && ' (you)'}</p>
            <p className="text-[11px]" style={{ color: 'var(--txt-second)' }}>Last one standing, won {game.pot} pts in {rn(game.ended_round)}</p>
          </Card>
        )
      })}

      {running && (
        <Card className="mb-3 overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <SectionLabel>Still in ({alive.length})</SectionLabel>
            {!locked && <span className="text-[11px]" style={{ color: 'var(--txt-muted)' }}>{picked} of {alive.length} picked</span>}
          </div>
          {alive.map(e => {
            const p = thisRound.get(e.id)
            const st = locked && p ? STATE_STYLE[pickState(p, fixturesById.get(p.api_fixture_id))] : null
            return (
              <Row key={e.id} mine={e.user_id === userId} name={name(e)}
                right={locked
                  ? (p ? <span><span style={{ color: 'var(--txt-primary)' }}>{p.team_name}</span>{p.auto && <AutoTag />} <span style={{ color: st.color }}>· {st.label}</span></span>
                       : <span style={{ color: 'var(--amber)' }}>Auto pick coming</span>)
                  : (hasPick.get(e.id)
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
            const p = pickIn(e.id, e.out_round)
            return (
              <Row key={e.id} mine={e.user_id === userId} name={name(e)} faded
                right={<span style={{ color: 'var(--txt-muted)' }}>
                  {rn(e.out_round)} · {e.out_reason === 'no_pick' ? OUT_REASON.no_pick : `${p?.team_name || 'team'}${p?.auto ? ' (auto)' : ''} ${OUT_REASON[e.out_reason]}`}
                </span>} />
            )
          })}
        </Card>
      )}
    </div>
  )
}

function AutoTag() {
  return <span className="text-[9px] font-semibold ml-1 px-1 py-px rounded" style={{ color: 'var(--amber)', background: 'var(--amber-dim)' }}>AUTO</span>
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
  const rn = r => roundName(game, r)
  const byId = new Map(entries.map(e => [e.id, e]))
  const label = id => {
    const e = byId.get(id)
    if (!e) return 'Player'
    const t = entryTag(e, entries)
    return `${e.profile?.display_name || 'Player'}${t ? ` ${t}` : ''}`
  }
  const lastShown = locked || !['open', 'running'].includes(game.status) ? game.current_round : game.current_round - 1
  const rounds = []
  for (let r = lastShown; r >= game.start_round; r--) rounds.push(r)

  return (
    <div>
      {rounds.length === 0 && (
        <Card className="p-4 mb-3">
          <p className="text-sm" style={{ color: 'var(--txt-muted)' }}>Picks show here once the first {game.sport === 'nfl' ? 'week' : 'gameweek'} locks.</p>
        </Card>
      )}

      {rounds.map(r => {
        const list = picks.filter(p => p.round === r).sort((a, b) => label(a.entry_id).localeCompare(label(b.entry_id)))
        return (
          <Card key={r} className="mb-3 overflow-hidden">
            <div className="px-4 pt-3 pb-2"><SectionLabel>{rn(r)}</SectionLabel></div>
            {list.length === 0 && <p className="px-4 pb-3 text-xs" style={{ color: 'var(--txt-muted)' }}>No picks.</p>}
            {list.map(p => {
              const st = STATE_STYLE[pickState(p, data.fixturesById.get(p.api_fixture_id))]
              return (
                <Row key={p.id} mine={p.user_id === userId} name={label(p.entry_id)}
                  right={<span><span style={{ color: 'var(--txt-primary)' }}>{p.team_name}</span>{p.auto && <AutoTag />} <span style={{ color: st.color }}>· {st.label}</span></span>} />
              )
            })}
          </Card>
        )
      })}

      {games.filter(g => g.status === 'won' || g.status === 'no_winner').length > 0 && (
        <Card className="mb-3 overflow-hidden">
          <div className="px-4 pt-3 pb-2"><SectionLabel>Past games</SectionLabel></div>
          {games.filter(g => g.status === 'won' || g.status === 'no_winner').map(g => (
            <Row key={g.id} name={`Game ${g.game_number} · ${g.league_name}`}
              right={<span style={{ color: 'var(--txt-second)' }}>
                {g.status === 'won' ? `${g.winner?.display_name || 'Winner'} won ${g.pot} pts` : `No winner · ${g.pot} pts carried over`}
              </span>} />
          ))}
        </Card>
      )}
    </div>
  )
}
