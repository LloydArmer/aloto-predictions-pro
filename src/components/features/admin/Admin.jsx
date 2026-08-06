import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { supabase } from '../../../lib/supabase'
import { recalculateGameweek } from '../../../lib/scoring'
import { Card, Button, Input, Select, SectionLabel, Badge, EmptyState, Spinner } from '../../ui'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

const TABS = [
  { key: 'competitions', label: 'Competitions', icon: 'ti-trophy' },
  { key: 'rules',        label: 'Points rules', icon: 'ti-star' },
  { key: 'gameweeks',    label: 'Gameweeks & fixtures', icon: 'ti-calendar' },
  { key: 'participants', label: 'Participants', icon: 'ti-users' },
]

export default function Admin() {
  const { user, isAdmin } = useAuth()
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
          createCompetition={createCompetition} selectedComp={selectedComp} setSelectedComp={setSelectedComp} />
      )}
      {tab === 'rules' && <RulesTab competitionId={selectedComp} competitions={competitions} />}
      {tab === 'gameweeks' && <GameweeksTab competitionId={selectedComp} competitions={competitions} />}
      {tab === 'participants' && <ParticipantsTab competitionId={selectedComp} competitions={competitions} />}
    </div>
  )
}

// ───────────────────────── Competitions ─────────────────────────
function CompetitionsTab({ user, competitions, loading, createCompetition, selectedComp, setSelectedComp }) {
  const [name, setName] = useState('')
  const [format, setFormat] = useState('league')
  const [emoji, setEmoji] = useState('⚽')
  const [saving, setSaving] = useState(false)

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
      setName('')
      toast.success('Competition created!')
    } catch (err) { toast.error(err.message || 'Could not create competition') }
    finally { setSaving(false) }
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
              <Select value={format} onChange={e => setFormat(e.target.value)} className="w-full">
                <option value="league">League</option>
                <option value="knockout">Knockout</option>
                <option value="group_knockout">Group + knockout</option>
              </Select>
            </div>
            <div style={{ width: 90 }}>
              <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)' }}>Emoji</p>
              <Input value={emoji} onChange={e => setEmoji(e.target.value)} className="w-full text-center" />
            </div>
          </div>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Creating…' : 'Create competition'}</Button>
        </form>
      </Card>

      <SectionLabel className="mb-2">Your competitions</SectionLabel>
      {loading ? <div className="flex justify-center py-10"><Spinner /></div>
        : competitions.length === 0 ? <EmptyState icon="ti-trophy" title="No competitions yet" description="Create your first one above"/>
        : competitions.map(c => (
            <Card key={c.id} onClick={() => setSelectedComp(c.id)}
              className="p-3 mb-2 flex items-center justify-between cursor-pointer"
              style={{ border: selectedComp === c.id ? '1px solid var(--accent)' : '0.5px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <span>{c.emoji}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{c.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={c.status === 'active' ? 'result' : 'upcoming'}>{c.status}</Badge>
                {selectedComp === c.id && <i className="ti ti-check" style={{ color: 'var(--accent)' }} />}
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
        clean_sheet_bonus: Number(rules.clean_sheet_bonus),
        correct_finalist_points: Number(rules.correct_finalist_points),
        correct_winner_points: Number(rules.correct_winner_points),
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
    { key: 'clean_sheet_bonus',       label: 'Clean sheet bonus' },
    { key: 'correct_finalist_points', label: 'Correct knockout finalist' },
    { key: 'correct_winner_points',   label: 'Correct knockout winner' },
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

  useEffect(() => { if (competitionId) load(); else setGws([]) }, [competitionId])

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase.from('gameweeks').select('*').eq('competition_id', competitionId).order('number')
      setGws(data || [])
    } finally { setLoading(false) }
  }

  async function addGameweek() {
    const nextNum = (gws[gws.length - 1]?.number || 0) + 1
    const { error } = await supabase.from('gameweeks').insert({ competition_id: competitionId, number: nextNum })
    if (error) { toast.error('Could not add gameweek'); return }
    toast.success(`GW${nextNum} added`)
    load()
  }

  async function updateGw(id, updates) {
    const { error } = await supabase.from('gameweeks').update(updates).eq('id', id)
    if (error) { toast.error('Could not update gameweek'); return }
    setGws(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g))
  }

  if (!competitionId) return <EmptyState icon="ti-calendar" title="Create a competition first" />

  return (
    <div>
      <Button variant="primary" onClick={addGameweek} className="mb-4">+ Add gameweek</Button>
      {loading ? <div className="flex justify-center py-10"><Spinner /></div>
        : gws.length === 0 ? <EmptyState icon="ti-calendar" title="No gameweeks yet" description="Click 'Add gameweek' to start"/>
        : gws.map(gw => (
            <Card key={gw.id} className="p-3 mb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>GW{gw.number}</span>
                  <Select value={gw.status} onChange={e => updateGw(gw.id, { status: e.target.value })} style={{ width: 120 }}>
                    <option value="upcoming">Upcoming</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                  </Select>
                  <Input placeholder="2025-08" value={gw.month_key || ''} style={{ width: 100 }}
                    onChange={e => setGws(prev => prev.map(g => g.id === gw.id ? { ...g, month_key: e.target.value } : g))}
                    onBlur={e => updateGw(gw.id, { month_key: e.target.value })} />
                </div>
                <Button size="sm" onClick={() => setOpenGw(openGw === gw.id ? null : gw.id)}>
                  {openGw === gw.id ? 'Hide fixtures' : 'Manage fixtures'}
                </Button>
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
  const [venue, setVenue] = useState('')
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
      kickoff_time: new Date(kickoff).toISOString(), venue: venue.trim() || null,
    })
    if (error) { toast.error('Could not add fixture'); return }
    setHome(''); setAway(''); setKickoff(''); setVenue('')
    toast.success('Fixture added')
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
        <Input placeholder="Venue (optional)" value={venue} onChange={e => setVenue(e.target.value)} style={{ flex: '1 1 120px' }} />
        <Button type="submit" variant="primary" size="sm">Add fixture</Button>
      </form>

      {loading ? <div className="flex justify-center py-6"><Spinner size="sm"/></div>
        : fixtures.length === 0 ? <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>No fixtures yet</p>
        : <>
          {fixtures.map(fx => (
            <div key={fx.id} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
              <div>
                <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>{fx.home_team} vs {fx.away_team}</p>
                <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>{format(new Date(fx.kickoff_time), 'EEE d MMM, HH:mm')}{fx.venue ? ` · ${fx.venue}` : ''}</p>
              </div>
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

// ───────────────────────── Participants ─────────────────────────
function ParticipantsTab({ competitionId }) {
  const [participants, setParticipants] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => { if (competitionId) load(); else { setParticipants([]); setInvitations([]) } }, [competitionId])

  async function load() {
    setLoading(true)
    try {
      const { data: parts } = await supabase.from('participants').select('*, profiles(display_name, email, avatar_initials)').eq('competition_id', competitionId)
      setParticipants(parts || [])
      const { data: invs } = await supabase.from('invitations').select('*').eq('competition_id', competitionId).is('accepted_at', null)
      setInvitations(invs || [])
    } finally { setLoading(false) }
  }

  async function addParticipant(e) {
    e.preventDefault()
    const em = email.trim().toLowerCase()
    if (!em) return
    setAdding(true)
    try {
      const { data: profile } = await supabase.from('profiles').select('id').eq('email', em).maybeSingle()
      if (profile) {
        const { error } = await supabase.from('participants').insert({ competition_id: competitionId, user_id: profile.id, role: 'player' })
        if (error) { if (error.code === '23505') toast.error('Already a participant'); else throw error; return }
        toast.success('Player added!')
      } else {
        const { error } = await supabase.from('invitations').insert({ competition_id: competitionId, email: em })
        if (error) { if (error.code === '23505') toast.error('Already invited'); else throw error; return }
        toast.success("They haven't signed up yet — invite recorded. Add them here once they do.")
      }
      setEmail(''); load()
    } catch { toast.error('Could not add player') }
    finally { setAdding(false) }
  }

  if (!competitionId) return <EmptyState icon="ti-users" title="Create a competition first" />

  return (
    <div>
      <Card className="p-4 mb-4">
        <SectionLabel className="mb-3">Add a player</SectionLabel>
        <form onSubmit={addParticipant} className="flex gap-2">
          <Input type="email" placeholder="player@example.com" value={email} onChange={e => setEmail(e.target.value)} className="flex-1" />
          <Button type="submit" variant="primary" disabled={adding}>{adding ? 'Adding…' : 'Add'}</Button>
        </form>
        <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>If they've already signed up, they're added immediately. If not, share your site link with them — you can add them here once they've created an account.</p>
      </Card>

      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : <>
        <SectionLabel className="mb-2">Participants ({participants.length})</SectionLabel>
        {participants.length === 0
          ? <p className="text-xs mb-4" style={{ color: 'var(--txt-muted)' }}>No participants yet</p>
          : participants.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-sm" style={{ color: 'var(--txt-primary)' }}>{p.profiles?.display_name}</p>
                  <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>{p.profiles?.email}</p>
                </div>
                <Badge variant={p.role === 'admin' ? 'admin' : 'upcoming'}>{p.role}</Badge>
              </div>
            ))
        }

        {invitations.length > 0 && <>
          <SectionLabel className="mb-2 mt-4">Pending invites ({invitations.length})</SectionLabel>
          {invitations.map(inv => (
            <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--txt-second)' }}>{inv.email}</p>
              <Badge variant="upcoming">awaiting sign-up</Badge>
            </div>
          ))}
        </>}
      </>}
    </div>
  )
}
