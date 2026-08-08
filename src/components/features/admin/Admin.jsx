import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { supabase } from '../../../lib/supabase'
import { recalculateGameweek, resolveBracketRound } from '../../../lib/scoring'
import { ukLocalToISO, formatUK } from '../../../lib/time'
import { Card, Button, Input, Select, SectionLabel, Badge, EmptyState, Spinner } from '../../ui'
import toast from 'react-hot-toast'

const TABS = [
  { key: 'competitions', label: 'Competitions', icon: 'ti-trophy' },
  { key: 'rules',        label: 'Points rules', icon: 'ti-star' },
  { key: 'gameweeks',    label: 'Gameweeks & fixtures', icon: 'ti-calendar' },
  { key: 'bracket',      label: 'Bracket', icon: 'ti-tournament' },
  { key: 'participants', label: 'Participants', icon: 'ti-users' },
]

export default function Admin() {
  const { user, profile, isAdmin } = useAuth()
  const { competitions, loading: compsLoading, createCompetition, refetch: refetchComps } = useCompetitions()
  const [tab, setTab] = useState('competitions')
  const [selectedComp, setSelectedComp] = useState(null)

  useEffect(() => { if (competitions.length && !selectedComp) setSelectedComp(competitions[0].id) }, [competitions])

  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <i className="ti ti-lock text-4xl mb-4" style={{ color: 'var(--txt-muted)' }} />
      <p className="text-sm font-medium" style={{ color: 'var(--txt-second)' }}>Admin access only</p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>You need admin role to access this page</p>
    </div>
  )

  return (
    <div className="max-w-2xl">
      <h1 className="text-base font-medium mb-4" style={{ color: 'var(--txt-primary)' }}>Admin</h1>

      <div className="flex gap-1 mb-5 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
            style={{ background: tab === t.key ? 'var(--accent-dim)' : 'transparent', color: tab === t.key ? 'var(--accent)' : 'var(--txt-second)', fontWeight: tab === t.key ? 500 : 400 }}>
            <i className={`ti ${t.icon}`} aria-hidden="true" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'competitions' && (
        <CompetitionsTab user={user} competitions={competitions} loading={compsLoading}
          createCompetition={createCompetition} refetchComps={refetchComps}
          selectedComp={selectedComp} setSelectedComp={setSelectedComp} />
      )}
      {tab === 'rules' && <RulesTab competitionId={selectedComp} competitions={competitions} />}
      {tab === 'gameweeks' && <GameweeksTab competitionId={selectedComp} competitions={competitions} />}
      {tab === 'bracket' && <BracketTab competitionId={selectedComp} competitions={competitions} />}
      {tab === 'participants' && <ParticipantsTab competitionId={selectedComp} competitions={competitions} inviterName={profile?.display_name} />}
    </div>
  )
}

const FORMAT_EMOJI = { league: '📊', knockout: '🏆', group_knockout: '🏆' }

// ───────────────────────── Competitions ─────────────────────────
function CompetitionsTab({ user, competitions, loading, createCompetition, refetchComps, selectedComp, setSelectedComp }) {
  const [name, setName] = useState('')
  const [format, setFormat] = useState('league')
  const [emoji, setEmoji] = useState(FORMAT_EMOJI.league)
  const [emojiTouched, setEmojiTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  function changeFormat(newFormat) {
    setFormat(newFormat)
    if (!emojiTouched) setEmoji(FORMAT_EMOJI[newFormat])
  }

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Give the competition a name'); return }
    setSaving(true)
    try {
      const comp = await createCompetition({ name: name.trim(), format, emoji, created_by: user.id })
      // Add the creator as an admin participant so they can see/manage it immediately — no manual SQL needed
      const { error } = await supabase.from('participants').insert({ competition_id: comp.id, user_id: user.id, role: 'admin' })
      if (error) throw error
      setSelectedComp(comp.id)
      setName(''); setFormat('league'); setEmoji(FORMAT_EMOJI.league); setEmojiTouched(false)
      toast.success('Competition created!')
    } catch (err) { toast.error(err.message || 'Could not create competition') }
    finally { setSaving(false) }
  }

  async function onDelete(comp) {
    const confirmed = window.confirm(`Delete "${comp.name}"? This permanently removes its gameweeks, fixtures, predictions, scores, and bracket — this cannot be undone. Are you sure you want to do this?`)
    if (!confirmed) return
    const { error } = await supabase.from('competitions').delete().eq('id', comp.id)
    if (error) { toast.error('Could not delete competition'); return }
    toast.success(`"${comp.name}" deleted`)
    if (selectedComp === comp.id) setSelectedComp(null)
    refetchComps()
  }

  return (
    <div>
      <Card className="p-4 mb-5">
        <SectionLabel className="mb-3">Create competition</SectionLabel>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Name</p>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Premier League Preds 2025/26" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Format</p>
              <Select value={format} onChange={e => changeFormat(e.target.value)} className="w-full">
                <option value="league">League</option>
                <option value="knockout">Knockout</option>
                <option value="group_knockout">Group + knockout</option>
              </Select>
            </div>
            <div style={{ width: 90 }}>
              <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Emoji</p>
              <Input value={emoji} onChange={e => { setEmoji(e.target.value); setEmojiTouched(true) }} className="w-full text-center" />
            </div>
          </div>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Creating…' : 'Create competition'}</Button>
        </form>
      </Card>

      <SectionLabel className="mb-2">Your competitions</SectionLabel>
      {loading ? <div className="flex justify-center py-10"><Spinner /></div>
        : competitions.length === 0 ? <EmptyState icon="ti-trophy" title="No competitions yet" description="Create your first one above"/>
        : competitions.map(c => (
            <Card key={c.id}
              className="p-3 mb-2 flex items-center justify-between flex-wrap gap-2"
              style={{ border: selectedComp === c.id ? '1px solid var(--accent)' : '0.5px solid var(--border)' }}>
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setSelectedComp(c.id)} style={{ flex: '1 1 140px', minWidth: 0 }}>
                <span>{c.emoji}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={c.status === 'active' ? 'result' : 'upcoming'}>{c.status}</Badge>
                {selectedComp === c.id && <i className="ti ti-check" style={{ color: 'var(--accent)' }} />}
                <button onClick={() => onDelete(c)} title="Delete competition"
                  className="flex items-center justify-center" style={{ width: 24, height: 24, color: 'var(--txt-muted)' }}>
                  <i className="ti ti-trash text-sm" aria-hidden="true" />
                </button>
              </div>
            </Card>
          ))
      }
      {competitions.length > 0 && (
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>Selected competition applies to the other Admin tabs above.</p>
      )}
    </div>
  )
}

// ───────────────────────── Points rules ─────────────────────────
function RulesTab({ competitionId, competitions }) {
  const [rules, setRules] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (competitionId) load(); else setRules(null) }, [competitionId])

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase.from('point_rules').select('*').eq('competition_id', competitionId).single()
      setRules(data)
    } finally { setLoading(false) }
  }

  async function save() {
    setSaving(true)
    try {
      const { error } = await supabase.from('point_rules').update({
        exact_score_points: Number(rules.exact_score_points),
        correct_result_points: Number(rules.correct_result_points),
        full_house_results_bonus: Number(rules.full_house_results_bonus),
        full_house_scores_bonus: Number(rules.full_house_scores_bonus),
      }).eq('competition_id', competitionId)
      if (error) throw error
      toast.success('Rules saved!')
    } catch { toast.error('Could not save rules') }
    finally { setSaving(false) }
  }

  if (!competitionId) return <EmptyState icon="ti-star" title="Create a competition first" />
  if (loading || !rules) return <div className="flex justify-center py-10"><Spinner /></div>

  const fields = [
    { key: 'exact_score_points',      label: 'Exact score' },
    { key: 'correct_result_points',   label: 'Correct result (W/D/L)' },
    { key: 'full_house_results_bonus', label: 'Full house — all results correct in a GW' },
    { key: 'full_house_scores_bonus',  label: 'Full house — all scores exact in a GW' },
  ]

  return (
    <Card className="p-4">
      <SectionLabel className="mb-3">Points & bonus rules</SectionLabel>
      {fields.map(f => (
        <div key={f.key} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
          <span className="text-sm" style={{ color: 'var(--txt-primary)' }}>{f.label}</span>
          <Input type="number" min="0" value={rules[f.key]} style={{ width: 70 }}
            onChange={e => setRules(r => ({ ...r, [f.key]: e.target.value }))} />
        </div>
      ))}
      <Button variant="primary" className="mt-3" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rules'}</Button>
    </Card>
  )
}

// ───────────────────────── Gameweeks & fixtures ─────────────────────────
function GameweeksTab({ competitionId }) {
  const [gws, setGws] = useState([])
  const [loading, setLoading] = useState(false)
  const [openGw, setOpenGw] = useState(null)
  const [newNumber, setNewNumber] = useState('')

  useEffect(() => { if (competitionId) load(); else setGws([]) }, [competitionId])
  useEffect(() => {
    const last = gws[gws.length - 1]?.number
    // Only auto-suggest a "next" value when the last one was a plain number —
    // for anything alphanumeric (e.g. "QF1") there's no sensible auto-increment.
    setNewNumber(last && /^\d+$/.test(last) ? String(Number(last) + 1) : '')
  }, [gws])

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase.from('gameweeks').select('*').eq('competition_id', competitionId).order('number')
      setGws(data || [])
    } finally { setLoading(false) }
  }

  async function addGameweek(e) {
    e.preventDefault()
    const num = newNumber.trim()
    if (!num) { toast.error('Enter a gameweek label'); return }
    if (gws.some(g => g.number === num)) { toast.error(`"${num}" already exists`); return }
    const { error } = await supabase.from('gameweeks').insert({ competition_id: competitionId, number: num })
    if (error) { toast.error('Could not add gameweek'); return }
    toast.success(`"${num}" added`)
    load()
  }

  async function updateGw(id, updates) {
    const { error } = await supabase.from('gameweeks').update(updates).eq('id', id)
    if (error) { toast.error('Could not update gameweek'); return }
    setGws(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g))
  }

  // Setting a gameweek active automatically marks whichever gameweek was
  // previously active (if any) as completed — this is the single value
  // Dashboard/Predict use to know "what's the current gameweek".
  async function setActive(gw) {
    const prevActive = gws.find(g => g.status === 'active' && g.id !== gw.id)
    if (prevActive) await updateGw(prevActive.id, { status: 'completed' })
    await updateGw(gw.id, { status: 'active' })
  }

  async function deleteGameweek(gw) {
    const confirmed = window.confirm(`Delete "${gw.number}"? This permanently removes its fixtures, predictions, and scores — this cannot be undone. Are you sure you want to do this?`)
    if (!confirmed) return
    const { error } = await supabase.from('gameweeks').delete().eq('id', gw.id)
    if (error) { toast.error('Could not delete gameweek'); return }
    toast.success(`"${gw.number}" deleted`)
    if (openGw === gw.id) setOpenGw(null)
    load()
  }

  if (!competitionId) return <EmptyState icon="ti-calendar" title="Create a competition first" />

  return (
    <div>
      <Card className="p-4 mb-4">
        <SectionLabel className="mb-3">Add a gameweek</SectionLabel>
        <form onSubmit={addGameweek} className="flex items-end gap-2">
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Gameweek label</p>
            <Input value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="1, R16, QF1…" style={{ width: 100 }} />
          </div>
          <Button type="submit" variant="primary" size="sm">Add gameweek</Button>
        </form>
      </Card>

      {loading ? <div className="flex justify-center py-10"><Spinner /></div>
        : gws.length === 0 ? <EmptyState icon="ti-calendar" title="No gameweeks yet" description="Add one above to start"/>
        : gws.map(gw => (
            <Card key={gw.id} className="p-3 mb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{gw.number}</span>
                  <Badge variant={gw.status === 'active' ? 'result' : gw.status === 'completed' ? 'exact' : 'upcoming'}>{gw.status}</Badge>
                  {gw.status !== 'active' && <Button size="sm" onClick={() => setActive(gw)}>Set as current gameweek</Button>}
                  {gw.status === 'active' && <Button size="sm" onClick={() => updateGw(gw.id, { status: 'completed' })}>Mark completed</Button>}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>Month (for monthly leaderboard):</span>
                    <Input placeholder="2025-08" value={gw.month_key || ''} style={{ width: 90 }}
                      onChange={e => setGws(prev => prev.map(g => g.id === gw.id ? { ...g, month_key: e.target.value } : g))}
                      onBlur={e => updateGw(gw.id, { month_key: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" onClick={() => setOpenGw(openGw === gw.id ? null : gw.id)}>
                    {openGw === gw.id ? 'Hide fixtures' : 'Manage fixtures'}
                  </Button>
                  <button onClick={() => deleteGameweek(gw)} title="Delete gameweek"
                    className="flex items-center justify-center" style={{ width: 24, height: 24, color: 'var(--txt-muted)' }}>
                    <i className="ti ti-trash text-sm" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {openGw === gw.id && <FixturesPanel gameweekId={gw.id} />}
            </Card>
          ))
      }
    </div>
  )
}

function FixturesPanel({ gameweekId }) {
  const [fixtures, setFixtures] = useState([])
  const [loading, setLoading] = useState(false)
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [kickoff, setKickoff] = useState('')
  const [scores, setScores] = useState({})
  const [recalculating, setRecalculating] = useState(false)

  useEffect(() => { load() }, [gameweekId])

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase.from('fixtures').select('*').eq('gameweek_id', gameweekId).order('kickoff_time')
      setFixtures(data || [])
    } finally { setLoading(false) }
  }

  async function addFixture(e) {
    e.preventDefault()
    if (!home.trim() || !away.trim() || !kickoff) { toast.error('Home team, away team and kickoff time are required'); return }
    const { error } = await supabase.from('fixtures').insert({
      gameweek_id: gameweekId, home_team: home.trim(), away_team: away.trim(),
      kickoff_time: ukLocalToISO(kickoff),
    })
    if (error) { toast.error('Could not add fixture'); return }
    setHome(''); setAway(''); setKickoff('')
    toast.success('Fixture added')
    load()
  }

  async function deleteFixture(fx) {
    const confirmed = window.confirm(`Delete ${fx.home_team} vs ${fx.away_team}? Any predictions already made for it will be deleted too. Are you sure?`)
    if (!confirmed) return
    const { error } = await supabase.from('fixtures').delete().eq('id', fx.id)
    if (error) { toast.error('Could not delete fixture'); return }
    toast.success('Fixture deleted')
    load()
  }

  async function saveResult(fx) {
    const s = scores[fx.id]
    if (!s || s.home === '' || s.away === '') { toast.error('Enter both scores'); return }
    const { error } = await supabase.from('fixtures').update({ home_score: Number(s.home), away_score: Number(s.away), status: 'completed' }).eq('id', fx.id)
    if (error) { toast.error('Could not save result'); return }
    toast.success('Result saved')
    load()
  }

  async function recalc() {
    setRecalculating(true)
    try {
      const { data: gw } = await supabase.from('gameweeks').select('competition_id').eq('id', gameweekId).single()
      const { data: r } = await supabase.from('point_rules').select('*').eq('competition_id', gw.competition_id).single()
      await recalculateGameweek(supabase, gameweekId, r)
      toast.success('Gameweek recalculated!')
    } catch { toast.error('Could not recalculate') }
    finally { setRecalculating(false) }
  }

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
      <form onSubmit={addFixture} className="flex flex-wrap gap-2 mb-3">
        <Input placeholder="Home team" value={home} onChange={e => setHome(e.target.value)} style={{ flex: '1 1 120px' }} />
        <Input placeholder="Away team" value={away} onChange={e => setAway(e.target.value)} style={{ flex: '1 1 120px' }} />
        <Input type="datetime-local" value={kickoff} onChange={e => setKickoff(e.target.value)} style={{ flex: '1 1 170px' }} />
        <Button type="submit" variant="primary" size="sm">Add fixture</Button>
      </form>
      <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>Kickoff times are treated as UK local time (GMT/BST automatically) and locked for predictions exactly at kickoff.</p>

      {loading ? <div className="flex justify-center py-6"><Spinner size="sm"/></div>
        : fixtures.length === 0 ? <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>No fixtures yet</p>
        : <>
          {fixtures.map(fx => (
            <div key={fx.id} className="flex items-center justify-between py-2 border-b last:border-0 flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
              <div style={{ minWidth: 0, flex: '1 1 160px' }}>
                <p className="text-sm" style={{ color: 'var(--txt-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fx.home_team} vs {fx.away_team}</p>
                <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>{formatUK(fx.kickoff_time, { weekday: 'short', day: '2-digit', month: 'short' })} UK</p>
              </div>
              <div className="flex items-center gap-2">
                {fx.status === 'completed'
                  ? <Badge variant="result">{fx.home_score} – {fx.away_score}</Badge>
                  : <div className="flex items-center gap-1.5">
                      <Input type="number" min="0" placeholder="H" style={{ width: 46 }}
                        value={scores[fx.id]?.home ?? ''} onChange={e => setScores(s => ({ ...s, [fx.id]: { ...s[fx.id], home: e.target.value } }))} />
                      <span style={{ color: 'var(--txt-muted)' }}>–</span>
                      <Input type="number" min="0" placeholder="A" style={{ width: 46 }}
                        value={scores[fx.id]?.away ?? ''} onChange={e => setScores(s => ({ ...s, [fx.id]: { ...s[fx.id], away: e.target.value } }))} />
                      <Button size="sm" onClick={() => saveResult(fx)}>Save</Button>
                    </div>
                }
                <button onClick={() => deleteFixture(fx)} title="Delete fixture"
                  className="flex items-center justify-center" style={{ width: 24, height: 24, color: 'var(--txt-muted)' }}>
                  <i className="ti ti-trash text-sm" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          <Button variant="primary" size="sm" className="mt-3" onClick={recalc} disabled={recalculating}>
            {recalculating ? 'Recalculating…' : 'Recalculate GW'}
          </Button>
        </>
      }
    </div>
  )
}

// ───────────────────────── Bracket ─────────────────────────
const ROUND_OPTIONS = [
  { value: 'r64', label: 'Round of 64' },
  { value: 'r32', label: 'Round of 32' },
  { value: 'r16', label: 'Round of 16' },
  { value: 'qf',  label: 'Quarter-final' },
  { value: 'sf',  label: 'Semi-final' },
  { value: 'f',   label: 'Final' },
]
const SIZE_FOR_ROUND = { r64: 64, r32: 32, r16: 16, qf: 8, sf: 4, f: 2 }
const ROUND_FOR_SIZE = { 64: 'r64', 32: 'r32', 16: 'r16', 8: 'qf', 4: 'sf', 2: 'f' }
const ALL_ROUND_TABS = [{ value: 'playoff', label: 'Playoff' }, ...ROUND_OPTIONS]
function roundLabel(v) { return ALL_ROUND_TABS.find(r => r.value === v)?.label || v }

function BracketTab({ competitionId, competitions }) {
  const comp = competitions.find(c => c.id === competitionId)
  const [matches, setMatches] = useState([])
  const [gameweeks, setGameweeks] = useState([])
  const [participants, setParticipants] = useState([])
  const [roundGwMap, setRoundGwMap] = useState({}) // { round: [gameweek_id, ...] }
  const [loading, setLoading] = useState(false)
  const [round, setRound] = useState('r16')
  const [selectedGws, setSelectedGws] = useState([])
  const [selectedParticipants, setSelectedParticipants] = useState([])
  const [resolving, setResolving] = useState(false)

  useEffect(() => { if (competitionId) load(); else { setMatches([]); setGameweeks([]); setParticipants([]) } }, [competitionId])
  useEffect(() => { setSelectedGws(roundGwMap[round] || []) }, [round, roundGwMap])

  async function load() {
    setLoading(true)
    try {
      const [{ data: m }, { data: gws }, { data: parts }, { data: rgws }] = await Promise.all([
        supabase.from('bracket_matches').select('*, home:home_user_id(display_name), away:away_user_id(display_name), winner:winner_user_id(display_name)').eq('competition_id', competitionId).order('round_order'),
        supabase.from('gameweeks').select('*').eq('competition_id', competitionId).order('number'),
        supabase.from('participants').select('user_id, profiles(display_name, email)').eq('competition_id', competitionId),
        supabase.from('bracket_round_gameweeks').select('*').eq('competition_id', competitionId),
      ])
      setMatches(m || [])
      setGameweeks(gws || [])
      setParticipants(parts || [])
      const map = {}
      ;(rgws || []).forEach(r => { if (!map[r.round]) map[r.round] = []; map[r.round].push(r.gameweek_id) })
      setRoundGwMap(map)
    } finally { setLoading(false) }
  }

  async function saveRoundGameweeks() {
    await supabase.from('bracket_round_gameweeks').delete().eq('competition_id', competitionId).eq('round', round)
    if (selectedGws.length) {
      await supabase.from('bracket_round_gameweeks').insert(selectedGws.map(gw_id => ({ competition_id: competitionId, round, gameweek_id: gw_id })))
    }
    setRoundGwMap(prev => ({ ...prev, [round]: selectedGws }))
    toast.success(`GW mapping saved for ${roundLabel(round)}`)
  }

  // Computes, purely for the preview UI, how a knockout draw of the current
  // participant pool would break down: a straight power-of-2 needs no
  // playoff; anything else needs a preliminary round to trim the extras.
  function drawPreview() {
    const N = participants.length
    if (N < 2) return null
    let T = 1
    while (T * 2 <= N) T *= 2
    const targetRoundValue = ROUND_FOR_SIZE[T]
    if (!targetRoundValue) return null
    if (T === N) return { N, T, targetRoundValue, byeCount: N, playoffCount: 0 }
    return { N, T, targetRoundValue, byeCount: 2 * T - N, playoffCount: N - T }
  }

  async function autoGenerateDraw() {
    const preview = drawPreview()
    if (!preview) { toast.error('Need at least 2 participants, and no more than 64'); return }
    const { N, T, targetRoundValue, byeCount, playoffCount } = preview
    const shuffled = [...participants].map(p => p.user_id).sort(() => Math.random() - 0.5)

    // Build the full chain of round sizes from T down to 2 (the Final) —
    // e.g. T=8 → [8, 4, 2] → Quarter-final, Semi-final, Final.
    const sizes = []
    for (let s = T; s >= 2; s /= 2) sizes.push(s)

    // Create every round's match "shells" first (empty — participants get
    // filled in below), so we have real IDs to chain feeds_into links across.
    const shellsBySize = {}
    for (const size of sizes) {
      const roundValue = ROUND_FOR_SIZE[size]
      const roundIndex = ROUND_OPTIONS.findIndex(r => r.value === roundValue)
      const shells = []
      for (let i = 0; i < size / 2; i++) shells.push({ competition_id: competitionId, round: roundValue, round_order: roundIndex })
      const { data: created, error } = await supabase.from('bracket_matches').insert(shells).select()
      if (error || !created) { toast.error(`Could not create ${ROUND_OPTIONS[roundIndex].label} matches`); return }
      shellsBySize[size] = created
    }

    // Chain each round's matches to feed their winner into the next round —
    // match i and i+1 of this round feed into match floor(i/2) of the next.
    for (let idx = 0; idx < sizes.length - 1; idx++) {
      const cur = shellsBySize[sizes[idx]], next = shellsBySize[sizes[idx + 1]]
      for (let i = 0; i < cur.length; i++) {
        const nextMatchIndex = Math.floor(i / 2)
        const side = i % 2 === 0 ? 'home' : 'away'
        await supabase.from('bracket_matches').update({ feeds_into_match_id: next[nextMatchIndex].id, feeds_into_side: side }).eq('id', cur[i].id)
      }
    }

    const targetLabel = ROUND_OPTIONS.find(r => r.value === targetRoundValue)?.label
    const targetMatches = shellsBySize[T]

    if (playoffCount === 0) {
      for (let i = 0; i < targetMatches.length; i++) {
        await supabase.from('bracket_matches').update({ home_user_id: shuffled[i * 2], away_user_id: shuffled[i * 2 + 1] }).eq('id', targetMatches[i].id)
      }
      toast.success(`${N} participants — full bracket generated from ${targetLabel} through to the Final`)
      setRound(targetRoundValue)
      load(); return
    }

    const byes = shuffled.slice(0, byeCount)
    const playoffPlayers = shuffled.slice(byeCount)

    for (let i = 0; i < byeCount; i++) {
      const matchIndex = Math.floor(i / 2)
      const side = i % 2 === 0 ? 'home_user_id' : 'away_user_id'
      await supabase.from('bracket_matches').update({ [side]: byes[i] }).eq('id', targetMatches[matchIndex].id)
    }

    const targetIndex = ROUND_OPTIONS.findIndex(r => r.value === targetRoundValue)
    const playoffInserts = []
    for (let k = 0; k < playoffCount; k++) {
      const slotIndex = byeCount + k
      const matchIndex = Math.floor(slotIndex / 2)
      const side = slotIndex % 2 === 0 ? 'home' : 'away'
      playoffInserts.push({
        competition_id: competitionId, round: 'playoff', round_order: targetIndex - 1,
        home_user_id: playoffPlayers[k * 2], away_user_id: playoffPlayers[k * 2 + 1],
        feeds_into_match_id: targetMatches[matchIndex].id, feeds_into_side: side,
      })
    }
    const { error: playoffErr } = await supabase.from('bracket_matches').insert(playoffInserts)
    if (playoffErr) { toast.error('Could not create playoff round'); return }

    toast.success(`Full bracket generated: ${byeCount} byes into ${targetLabel}, ${playoffCount} playoff match${playoffCount !== 1 ? 'es' : ''}, chained all the way through to the Final`)
    setRound('playoff')
    load()
  }

  async function randomDraw() {
    if (selectedParticipants.length < 2) { toast.error('Select at least 2 participants'); return }
    const shuffled = [...selectedParticipants].sort(() => Math.random() - 0.5)
    const roundOrder = ROUND_OPTIONS.findIndex(r => r.value === round)
    const inserts = []
    for (let i = 0; i < shuffled.length; i += 2) {
      if (shuffled[i + 1]) inserts.push({ competition_id: competitionId, round, round_order: roundOrder, home_user_id: shuffled[i], away_user_id: shuffled[i + 1] })
      else inserts.push({ competition_id: competitionId, round, round_order: roundOrder, home_user_id: shuffled[i] }) // bye
    }
    const { error } = await supabase.from('bracket_matches').insert(inserts)
    if (error) { toast.error('Could not create matches'); return }
    toast.success(`${inserts.length} match${inserts.length !== 1 ? 'es' : ''} drawn`)
    setSelectedParticipants([])
    load()
  }

  async function setWinnerManually(matchId, winnerUserId) {
    const { error } = await supabase.from('bracket_matches').update({ winner_user_id: winnerUserId, status: 'completed' }).eq('id', matchId)
    if (error) { toast.error('Could not set winner'); return }
    const match = matches.find(m => m.id === matchId)
    if (match?.feeds_into_match_id && match?.feeds_into_side) {
      await supabase.from('bracket_matches').update({ [match.feeds_into_side + '_user_id']: winnerUserId }).eq('id', match.feeds_into_match_id)
    }
    toast.success('Winner set')
    load()
  }

  async function resolve() {
    setResolving(true)
    try {
      const result = await resolveBracketRound(supabase, competitionId, round)
      if (result.tied.length) toast.error(`${result.resolved} resolved, ${result.tied.length} still tied — pick winner manually below`)
      else toast.success(`${result.resolved} match${result.resolved !== 1 ? 'es' : ''} resolved`)
      load()
    } catch { toast.error('Could not resolve round') }
    finally { setResolving(false) }
  }

  if (!competitionId) return <EmptyState icon="ti-tournament" title="Create a competition first" />
  if (comp && comp.format === 'league') {
    return <EmptyState icon="ti-tournament" title="This competition is League format" description="The bracket only applies to Knockout or Group + knockout competitions." />
  }
  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>

  const matchedIds = new Set(matches.flatMap(m => [m.home_user_id, m.away_user_id]).filter(Boolean))
  const availableParticipants = participants.filter(p => !matchedIds.has(p.user_id))
  const roundMatches = matches.filter(m => m.round === round)
  const preview = drawPreview()
  const hasAnyMatches = matches.length > 0

  return (
    <div>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {ALL_ROUND_TABS.map(r => (
          <button key={r.value} onClick={() => setRound(r.value)}
            className="px-3 py-1.5 rounded-full text-xs"
            style={{ background: round === r.value ? 'var(--accent-dim)' : 'var(--bg-surface)', color: round === r.value ? 'var(--accent)' : 'var(--txt-second)', border: '0.5px solid var(--border)' }}>
            {r.label}
          </button>
        ))}
      </div>

      {!hasAnyMatches && preview && (
        <Card className="p-4 mb-4" style={{ background: 'var(--accent-dim)', borderColor: 'rgba(79,142,247,0.35)' }}>
          <SectionLabel className="mb-2">Auto-generate full knockout bracket</SectionLabel>
          {preview.playoffCount === 0
            ? <p className="text-xs mb-3" style={{ color: 'var(--txt-second)' }}>{preview.N} participants is already a clean bracket size — the whole bracket, from <strong>{ROUND_OPTIONS.find(r => r.value === preview.targetRoundValue)?.label}</strong> through to the <strong>Final</strong>, will be created and linked in one go.</p>
            : <p className="text-xs mb-3" style={{ color: 'var(--txt-second)' }}>
                {preview.N} participants doesn't divide evenly. <strong>{preview.byeCount}</strong> randomly-chosen participant{preview.byeCount !== 1 ? 's' : ''} get a bye straight to <strong>{ROUND_OPTIONS.find(r => r.value === preview.targetRoundValue)?.label}</strong>, and <strong>{preview.playoffCount}</strong> playoff match{preview.playoffCount !== 1 ? 'es' : ''} decide who joins them — every round after that, all the way to the <strong>Final</strong>, is created and linked at the same time, so winners automatically advance as each round resolves.
              </p>
          }
          <Button variant="primary" size="sm" onClick={autoGenerateDraw}>Generate full bracket for all {preview.N} participants</Button>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <SectionLabel className="mb-2">Which gameweek(s) decide this round?</SectionLabel>
        <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>Points earned in these gameweeks decide who wins each {roundLabel(round).toLowerCase()} matchup.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {gameweeks.length === 0 && <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>No gameweeks yet — add some in the Gameweeks tab first</span>}
          {gameweeks.map(gw => (
            <label key={gw.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-elevated)', cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedGws.includes(gw.id)}
                onChange={e => setSelectedGws(prev => e.target.checked ? [...prev, gw.id] : prev.filter(id => id !== gw.id))} />
              {gw.number}
            </label>
          ))}
        </div>
        <Button size="sm" onClick={saveRoundGameweeks} disabled={!gameweeks.length}>Save mapping</Button>
      </Card>

      <Card className="p-4 mb-4">
        <SectionLabel className="mb-2">Manually draw this round</SectionLabel>
        <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>Only needed if you want a different pairing than what auto-generate created, or you're setting up a round from scratch without it.</p>
        {availableParticipants.length === 0
          ? <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>All participants already have a match — check other rounds, or the matches below.</p>
          : <>
            <div className="flex flex-wrap gap-2 mb-3">
              {availableParticipants.map(p => (
                <label key={p.user_id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-elevated)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedParticipants.includes(p.user_id)}
                    onChange={e => setSelectedParticipants(prev => e.target.checked ? [...prev, p.user_id] : prev.filter(id => id !== p.user_id))} />
                  {p.profiles?.display_name}
                </label>
              ))}
            </div>
            <Button size="sm" variant="primary" onClick={randomDraw}>Randomly pair selected ({selectedParticipants.length})</Button>
          </>
        }
      </Card>

      <SectionLabel className="mb-2">{roundLabel(round)} matches</SectionLabel>
      {roundMatches.length === 0
        ? <EmptyState icon="ti-tournament" title="No matches drawn for this round yet" />
        : <>
          {roundMatches.map(m => (
            <Card key={m.id} className="p-3 mb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--txt-primary)' }}>
                  <span style={{ fontWeight: m.winner_user_id === m.home_user_id ? 600 : 400 }}>{m.home?.display_name || 'TBD'}</span>
                  {m.home_points != null && <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>({m.home_points}pts)</span>}
                  <span style={{ color: 'var(--txt-muted)' }}>vs</span>
                  {m.away_user_id
                    ? <><span style={{ fontWeight: m.winner_user_id === m.away_user_id ? 600 : 400 }}>{m.away?.display_name}</span>
                        {m.away_points != null && <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>({m.away_points}pts)</span>}</>
                    : <span style={{ color: 'var(--txt-muted)' }}>bye</span>
                  }
                </div>
                {m.status === 'completed'
                  ? <Badge variant="result">{m.winner?.display_name} advances</Badge>
                  : m.home_user_id && m.away_user_id && (
                    <Select style={{ width: 160 }} onChange={e => e.target.value && setWinnerManually(m.id, e.target.value)} defaultValue="">
                      <option value="" disabled>Pick winner manually…</option>
                      <option value={m.home_user_id}>{m.home?.display_name}</option>
                      <option value={m.away_user_id}>{m.away?.display_name}</option>
                    </Select>
                  )
                }
              </div>
            </Card>
          ))}
          <Button variant="primary" size="sm" className="mt-2" onClick={resolve} disabled={resolving || !roundGwMap[round]?.length}>
            {resolving ? 'Resolving…' : 'Resolve round from gameweek points'}
          </Button>
          {!roundGwMap[round]?.length && <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>Save a gameweek mapping above first.</p>}
        </>
      }
    </div>
  )
}

// ───────────────────────── Participants ─────────────────────────
function ParticipantsTab({ competitionId, competitions, inviterName }) {
  const comp = competitions.find(c => c.id === competitionId)
  const [participants, setParticipants] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState('whatsapp_share')
  const [adding, setAdding] = useState(false)
  const [sendingId, setSendingId] = useState(null)

  useEffect(() => { if (competitionId) load(); else { setParticipants([]); setInvitations([]) } }, [competitionId])

  async function load() {
    setLoading(true)
    try {
      const { data: parts } = await supabase.from('participants').select('*, profiles(display_name, email, phone_number, avatar_initials)').eq('competition_id', competitionId)
      setParticipants(parts || [])
      const { data: invs } = await supabase.from('invitations').select('*').eq('competition_id', competitionId).is('accepted_at', null)
      setInvitations(invs || [])
    } finally { setLoading(false) }
  }

  async function sendInvite(toPhone, toName) {
    if (!toPhone) return { skipped: true }
    try {
      const { data, error } = await supabase.functions.invoke('send-invite', {
        body: { phone: toPhone, name: toName, channel, competitionName: comp?.name, inviterName },
      })
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Invite failed')
      return { sent: true }
    } catch (err) {
      return { sent: false, error: err.message }
    }
  }

  // Opens the admin's own WhatsApp to send the invite personally — this
  // works for anyone, unlike the Twilio-sent WhatsApp option above, which
  // only works once someone has already joined your sandbox.
  function whatsappShareLink(toPhone, toName) {
    const site = window.location.origin
    const greeting = toName ? `Hi ${toName}!` : 'Hi!'
    const what = comp?.name ? `invited you to join "${comp.name}" on ALOTO Prediction Pro` : 'invited you to join ALOTO Prediction Pro'
    const text = `🎯 ${greeting} ${inviterName || 'You\'ve been'} ${what}. Sign up here: ${site}/signup`
    const digits = (toPhone || '').replace(/[^\d+]/g, '').replace(/^\+/, '')
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
  }

  async function addParticipant(e) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Name is required'); return }
    const em = email.trim().toLowerCase()
    setAdding(true)
    try {
      let inviteResult = { skipped: true }
      if (em) {
        const { data: profile } = await supabase.from('profiles').select('id').eq('email', em).maybeSingle()
        if (profile) {
          if (name.trim() || phone.trim()) await supabase.rpc('admin_update_participant', { target_id: profile.id, new_display_name: name.trim(), new_phone: phone.trim() })
          const { error } = await supabase.from('participants').insert({ competition_id: competitionId, user_id: profile.id, role: 'player' })
          if (error) { if (error.code === '23505') toast.error('Already a participant'); else throw error; return }
          toast.success('Player added!')
          setName(''); setEmail(''); setPhone(''); load()
          return
        }
      }

      // No email, or an email that hasn't signed up yet — record as a
      // placeholder invite with whatever details were given. Without an
      // email there's nothing to auto-match against a future signup, so
      // once they've joined, add them again here (with their email this
      // time) as normal, and remove this placeholder.
      const { error } = await supabase.from('invitations').insert({ competition_id: competitionId, email: em || null, display_name: name.trim(), phone_number: phone.trim() || null })
      if (error) { if (error.code === '23505') toast.error('Already invited'); else throw error; return }
      if (channel === 'whatsapp_share') {
        // Open it right now, in the same click, rather than making the
        // admin hunt for the link afterwards in the pending list below.
        // Works with or without a phone number — without one, WhatsApp
        // just lets the admin pick who to send it to themselves.
        window.open(whatsappShareLink(phone.trim(), name.trim()), '_blank')
        toast.success('Invite recorded — opening WhatsApp for you to send it now.')
      } else if (phone.trim()) {
        inviteResult = await sendInvite(phone.trim(), name.trim())
        toast.success("They haven't signed up yet — invite recorded with their details. Add them here once they do.")
      } else {
        toast.success("They haven't signed up yet — invite recorded. Add them here once they do.")
      }
      if (phone.trim() && channel !== 'whatsapp_share' && inviteResult.sent) toast.success(`Invite text sent via ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}!`)
      if (phone.trim() && channel !== 'whatsapp_share' && inviteResult.sent === false) toast.error(`Added, but the invite message failed to send: ${inviteResult.error}`)
      setName(''); setEmail(''); setPhone(''); load()
    } catch { toast.error('Could not add player') }
    finally { setAdding(false) }
  }

  async function deleteParticipant(p) {
    const confirmed = window.confirm(`Remove ${p.profiles?.display_name || 'this player'} from this competition? Their account isn't deleted, just removed from here. Are you sure?`)
    if (!confirmed) return
    const { error } = await supabase.from('participants').delete().eq('id', p.id)
    if (error) { toast.error('Could not remove player'); return }
    toast.success(`${p.profiles?.display_name || 'Player'} removed`)
    load()
  }

  async function deleteInvite(inv) {
    const confirmed = window.confirm(`Delete the pending invite for ${inv.display_name || inv.email}? Are you sure?`)
    if (!confirmed) return
    const { error } = await supabase.from('invitations').delete().eq('id', inv.id)
    if (error) { toast.error('Could not delete invite'); return }
    toast.success('Invite deleted')
    load()
  }

  async function resendInvite(inv) {
    if (!inv.phone_number) { toast.error('No phone number on file for this invite'); return }
    setSendingId(inv.id)
    const result = await sendInvite(inv.phone_number, inv.display_name)
    if (result.sent) toast.success(`Invite resent via ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}!`)
    else if (result.sent === false) toast.error(`Could not send: ${result.error}`)
    setSendingId(null)
  }

  if (!competitionId) return <EmptyState icon="ti-users" title="Create a competition first" />

  return (
    <div>
      <Card className="p-4 mb-4">
        <SectionLabel className="mb-3">Add a player</SectionLabel>
        <form onSubmit={addParticipant} className="flex flex-wrap gap-2 items-center">
          <Input placeholder="Name (required)" value={name} onChange={e => setName(e.target.value)} style={{ flex: '1 1 130px' }} />
          <Input type="email" placeholder="Email (optional)" value={email} onChange={e => setEmail(e.target.value)} style={{ flex: '1 1 160px' }} />
          <Input type="tel" placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} style={{ flex: '1 1 140px' }} />
          <Select value={channel} onChange={e => setChannel(e.target.value)} style={{ width: 150 }}>
            <option value="whatsapp_share">Share via my WhatsApp</option>
            <option value="sms">Auto-send SMS</option>
            <option value="whatsapp">Auto-send WhatsApp</option>
          </Select>
          <Button type="submit" variant="primary" disabled={adding}>{adding ? 'Adding…' : 'Add'}</Button>
        </form>
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>Only a name is required — send them the signup link via <strong>Share via my WhatsApp</strong>, which works for anyone with just a phone number. If you also give an email and they've already signed up, they're added straight away.</p>
      </Card>

      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : <>
        <SectionLabel className="mb-2">Participants ({participants.length})</SectionLabel>
        {participants.length === 0
          ? <p className="text-xs mb-4" style={{ color: 'var(--txt-muted)' }}>No participants yet</p>
          : participants.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0 flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
                <div style={{ minWidth: 0, flex: '1 1 160px' }}>
                  <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>{p.profiles?.display_name}</p>
                  <p className="text-xs" style={{ color: 'var(--txt-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.profiles?.email}{p.profiles?.phone_number ? ` · ${p.profiles.phone_number}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.role === 'admin' ? 'admin' : 'upcoming'}>{p.role}</Badge>
                  <button onClick={() => deleteParticipant(p)} title="Remove participant"
                    className="flex items-center justify-center" style={{ width: 24, height: 24, color: 'var(--txt-muted)' }}>
                    <i className="ti ti-trash text-sm" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))
        }

        {invitations.length > 0 && <>
          <SectionLabel className="mb-2 mt-4">Pending invites ({invitations.length})</SectionLabel>
          {invitations.map(inv => (
            <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0 flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
              <div style={{ minWidth: 0, flex: '1 1 140px' }}>
                <p className="text-sm" style={{ color: 'var(--txt-second)' }}>{inv.display_name || inv.email}</p>
                <p className="text-xs" style={{ color: 'var(--txt-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.email}{inv.phone_number ? ` · ${inv.phone_number}` : ''}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <a href={whatsappShareLink(inv.phone_number, inv.display_name)} target="_blank" rel="noreferrer"
                  className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--txt-second)', border: '0.5px solid var(--border)' }}>
                  Share via WhatsApp
                </a>
                {inv.phone_number && <Button size="sm" onClick={() => resendInvite(inv)} disabled={sendingId === inv.id}>{sendingId === inv.id ? 'Sending…' : 'Resend SMS'}</Button>}
                <Badge variant="upcoming">awaiting sign-up</Badge>
                <button onClick={() => deleteInvite(inv)} title="Delete invite"
                  className="flex items-center justify-center" style={{ width: 24, height: 24, color: 'var(--txt-muted)' }}>
                  <i className="ti ti-trash text-sm" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </>}
      </>}
    </div>
  )
}
