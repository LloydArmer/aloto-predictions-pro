import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Button, Input, Select, Spinner } from '../../ui'
import toast from 'react-hot-toast'

/**
 * Links a gameweek to a real competition, so results and live scores arrive
 * automatically instead of being typed in.
 *
 * Entirely optional. A gameweek with no competition linked behaves exactly as
 * it always has — the admin enters results by hand. That matters: coverage
 * stops at step 4 of the English pyramid, so North West Counties, West
 * Lancashire, works leagues and Sunday leagues are all outside it, and those
 * admins must not be left with a feature that looks broken.
 *
 * Every league in the provider's list is searchable rather than a curated
 * handful. There are over a thousand, and someone wanting the Portuguese league
 * or the MLS shouldn't have to ask for it to be added.
 */
export default function GameweekFixtureLink({ gameweek, onLinked }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [linking, setLinking] = useState(false)
  const [league, setLeague] = useState(null)
  const [fixtureState, setFixtureState] = useState(null)

  // The competition currently linked, if any.
  useEffect(() => {
    if (!gameweek?.api_league_id) { setLeague(null); return }
    supabase.from('api_leagues').select('*').eq('id', gameweek.api_league_id).maybeSingle()
      .then(({ data }) => setLeague(data))
  }, [gameweek?.api_league_id])

  // How many of this gameweek's fixtures are matched to a real match.
  useEffect(() => { if (open) loadFixtureState() }, [open, gameweek?.id])

  async function loadFixtureState() {
    const { data } = await supabase.from('fixtures')
      .select('id, home_team, away_team, api_fixture_id')
      .eq('gameweek_id', gameweek.id)
    setFixtureState(data || [])
  }

  async function runSearch(term) {
    if (term.trim().length < 3) { setResults([]); return }
    setSearching(true)
    try {
      const { data } = await supabase.from('api_leagues')
        .select('id, name, country, type, current_season, has_live_events')
        .ilike('name', `%${term.trim()}%`)
        .order('name')
        .limit(25)
      setResults(data || [])
    } finally { setSearching(false) }
  }

  async function linkLeague(l) {
    const { error } = await supabase.from('gameweeks')
      .update({ api_league_id: l.id, api_season: l.current_season })
      .eq('id', gameweek.id)

    if (error) { toast.error('Could not link the competition'); return }
    setLeague(l)
    setResults([])
    setSearch('')
    toast.success(`Linked to ${l.name}`)
    onLinked?.()
  }

  async function unlink() {
    // Clears the fixture links too. Leaving them would mean results kept
    // arriving from a competition the admin has just detached, which is worse
    // than not linking at all.
    await supabase.from('fixtures').update({ api_fixture_id: null }).eq('gameweek_id', gameweek.id)
    await supabase.from('gameweeks')
      .update({ api_league_id: null, api_season: null }).eq('id', gameweek.id)

    setLeague(null)
    loadFixtureState()
    toast.success('Unlinked — results are manual again')
    onLinked?.()
  }

  /** Asks the sync function to find real matches for these fixtures. */
  async function matchFixtures() {
    setLinking(true)
    try {
      const { data, error } = await supabase.functions.invoke('sync-football', {
        body: { mode: 'fixtures', gameweek_id: gameweek.id },
      })
      if (error) throw error

      if (data?.skipped) { toast.error(data.skipped); return }

      const matched = data?.matched ?? 0
      const unmatched = data?.unmatched ?? 0

      if (matched && !unmatched) toast.success(`All ${matched} fixtures matched`)
      else if (matched) toast.success(`${matched} matched, ${unmatched} not found — those stay manual`)
      else toast.error('No fixtures matched. Check the team names and kick-off dates.')

      loadFixtureState()
    } catch {
      toast.error('Could not reach the fixture service')
    } finally { setLinking(false) }
  }

  const linked = (fixtureState || []).filter(f => f.api_fixture_id)
  const unlinkedFixtures = (fixtureState || []).filter(f => !f.api_fixture_id)

  return (
    <div className="mt-2">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs"
        style={{ color: league ? 'var(--green)' : 'var(--txt-muted)' }}>
        <i className={`ti ti-chevron-${open ? 'up' : 'down'} text-sm`} aria-hidden="true"/>
        <i className="ti ti-world text-sm" aria-hidden="true"/>
        {league ? `Results from ${league.name}` : 'Results entered manually'}
      </button>

      {open && (
        <Card className="p-3 mt-2" style={{ background: 'var(--bg-elevated)' }}>
          {!league ? (
            <>
              <p className="text-xs mb-2" style={{ color: 'var(--txt-second)' }}>
                Link this gameweek to a real competition and results arrive on their own. Leave it
                unlinked and you enter them yourself, exactly as now.
              </p>

              <Input
                value={search}
                placeholder="Search competitions — e.g. Premier League"
                onChange={e => { setSearch(e.target.value); runSearch(e.target.value) }}
                className="w-full"
              />

              {searching && <div className="py-3"><Spinner/></div>}

              {results.length > 0 && (
                <div className="mt-2 rounded-md overflow-hidden" style={{ border: '0.5px solid var(--border-med)' }}>
                  {results.map(l => (
                    <button key={l.id} onClick={() => linkLeague(l)}
                      className="flex items-center justify-between w-full px-3 py-2 text-left gap-2"
                      style={{ borderBottom: '0.5px solid var(--border)' }}>
                      <span style={{ minWidth: 0 }}>
                        <span className="text-sm block" style={{ color: 'var(--txt-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {l.name}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                          {l.country} · {l.type}
                          {/* Said plainly here rather than discovered on a
                              Saturday: some competitions report only the final
                              score, so a live table would sit still until full
                              time. The FA Cup is one. */}
                          {!l.has_live_events && ' · results only, no live updates'}
                        </span>
                      </span>
                      <i className="ti ti-plus text-sm flex-shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true"/>
                    </button>
                  ))}
                </div>
              )}

              {search.trim().length >= 3 && !searching && results.length === 0 && (
                <p className="text-xs mt-2" style={{ color: 'var(--amber)' }}>
                  Nothing found. Coverage stops at step 4 of the English pyramid, so leagues below
                  that — North West Counties, West Lancashire, works and Sunday leagues — aren't
                  listed. Enter those results by hand as usual.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <span style={{ minWidth: 0 }}>
                  <span className="text-sm font-medium block" style={{ color: 'var(--txt-primary)' }}>{league.name}</span>
                  <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                    {league.country} · season {gameweek.api_season}
                    {!league.has_live_events && ' · results only, no live updates'}
                  </span>
                </span>
                <button onClick={unlink} className="text-xs" style={{ color: 'var(--txt-muted)', textDecoration: 'underline' }}>
                  Unlink
                </button>
              </div>

              <Button className="btn-sm" onClick={matchFixtures} disabled={linking}>
                <i className="ti ti-link text-sm mr-1" aria-hidden="true"/>
                {linking ? 'Matching…' : 'Match fixtures'}
              </Button>

              {fixtureState && (
                <div className="mt-3">
                  <p className="text-xs mb-1.5" style={{ color: linked.length === fixtureState.length ? 'var(--green)' : 'var(--amber)' }}>
                    {linked.length} of {fixtureState.length} fixtures matched
                  </p>

                  {/* Named individually rather than counted. "2 unmatched" leaves
                      an admin guessing which; naming them says exactly which
                      results still need typing in. */}
                  {unlinkedFixtures.length > 0 && (
                    <div className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                      <p className="mb-1">Enter these by hand — no match was found:</p>
                      {unlinkedFixtures.map(f => (
                        <p key={f.id} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          · {f.home_team} v {f.away_team}
                        </p>
                      ))}
                      <p className="mt-1.5">
                        Usually a spelling difference. Editing the team name to match the official
                        one and matching again normally fixes it.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  )
}
