import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Button, Spinner } from '../../ui'
import toast from 'react-hot-toast'

/**
 * Matches a gameweek's fixtures to real matches, so results and live scores
 * arrive automatically instead of being typed in.
 *
 * No competition to choose. An earlier version asked the admin to link the
 * gameweek to one league, which was wrong twice over: a gameweek routinely
 * mixes Premier League, Championship and a Champions League tie, and picking
 * "Premier League" from a list where nearly every country has one was a chore.
 *
 * Matching by date sidesteps both. The fixtures identify themselves, and a
 * gameweek can hold matches from as many competitions as the admin likes.
 *
 * Entirely optional. Anything that doesn't match — North West Counties, West
 * Lancashire, a works league — is entered by hand exactly as now.
 */
export default function GameweekFixtureLink({ gameweek, onLinked }) {
  const [open, setOpen] = useState(false)
  const [matching, setMatching] = useState(false)
  const [fixtures, setFixtures] = useState(null)
  const [lastRun, setLastRun] = useState(null)

  useEffect(() => { if (open) loadFixtures() }, [open, gameweek?.id])

  async function loadFixtures() {
    const { data } = await supabase.from('fixtures')
      .select('id, home_team, away_team, kickoff_time, api_fixture_id, live_status')
      .eq('gameweek_id', gameweek.id)
      .order('kickoff_time')
    setFixtures(data || [])
  }

  async function matchFixtures() {
    setMatching(true)
    setLastRun(null)
    try {
      const { data, error } = await supabase.functions.invoke('sync-football', {
        body: { mode: 'fixtures', gameweek_id: gameweek.id },
      })

      // Transport failure — the function couldn't be reached at all. Usually
      // means it isn't deployed to this project yet.
      if (error) {
        console.error('sync-football transport error:', error)
        toast.error('Could not reach the fixture service. Is the function deployed to this project?')
        return
      }

      // The function ran and reported a problem. Shown verbatim rather than
      // replaced with something generic — "quota reached" and "API key
      // rejected" need different responses from the admin, and hiding which is
      // which leaves them guessing.
      if (data?.ok === false || data?.error) {
        console.error('sync-football error:', data)
        toast.error(data.error || 'The fixture service reported a problem')
        setLastRun(data)
        return
      }

      const matched = data?.matched ?? 0
      const unmatched = data?.unmatched ?? 0

      if (matched && !unmatched) toast.success(`All ${matched} fixtures matched`)
      else if (matched) toast.success(`${matched} matched, ${unmatched} not found`)
      else toast.error('No fixtures matched — enter these results by hand')

      setLastRun(data)
      await loadFixtures()
      onLinked?.()
    } catch (err) {
      console.error('sync-football failed:', err)
      toast.error(`Fixture lookup failed: ${err?.message || err}`)
    } finally { setMatching(false) }
  }

  async function unlinkAll() {
    if (!window.confirm('Stop automatic results for this gameweek?\n\nYou will enter them by hand instead. Nothing already scored changes.')) return
    await supabase.from('fixtures')
      .update({ api_fixture_id: null, live_home_score: null, live_away_score: null, live_status: null })
      .eq('gameweek_id', gameweek.id)
    await loadFixtures()
    toast.success('Results are manual again')
    onLinked?.()
  }

  const linked = (fixtures || []).filter(f => f.api_fixture_id)
  const manual = (fixtures || []).filter(f => !f.api_fixture_id)
  const total  = (fixtures || []).length

  return (
    <div className="mt-2">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs"
        style={{ color: linked.length ? 'var(--green)' : 'var(--txt-muted)' }}>
        <i className={`ti ti-chevron-${open ? 'up' : 'down'} text-sm`} aria-hidden="true"/>
        <i className="ti ti-world text-sm" aria-hidden="true"/>
        {fixtures === null
          ? 'Automatic results'
          : linked.length === 0 ? 'Results entered manually'
          : linked.length === total ? 'Results arrive automatically'
          : `${linked.length} of ${total} automatic`}
      </button>

      {open && (
        <Card className="p-3 mt-2" style={{ background: 'var(--bg-elevated)' }}>
          <p className="text-xs mb-2.5" style={{ color: 'var(--txt-second)' }}>
            Looks up each fixture by its teams and kick-off date. Matches from any competition —
            a gameweek can mix the Premier League, the Championship and a European tie.
          </p>

          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Button className="btn-sm" onClick={matchFixtures} disabled={matching || !total}>
              <i className="ti ti-link text-sm mr-1" aria-hidden="true"/>
              {matching ? 'Searching…' : linked.length ? 'Match again' : 'Find these fixtures'}
            </Button>
            {linked.length > 0 && (
              <button onClick={unlinkAll} className="text-xs" style={{ color: 'var(--txt-muted)', textDecoration: 'underline' }}>
                Turn off
              </button>
            )}
          </div>

          {lastRun?.datesSearched > 1 && (
            <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
              Searched {lastRun.datesSearched} dates
            </p>
          )}

          {matching && <div className="py-3"><Spinner/></div>}

          {fixtures && total > 0 && (
            <div className="mt-3">
              <p className="text-xs mb-1.5"
                style={{ color: linked.length === total ? 'var(--green)' : linked.length ? 'var(--amber)' : 'var(--txt-muted)' }}>
                {linked.length} of {total} fixtures matched
              </p>

              {/* Named individually rather than counted. "2 unmatched" leaves an
                  admin guessing which; naming them says exactly which results
                  still need typing in. */}
              {manual.length > 0 && linked.length > 0 && (
                <div className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                  <p className="mb-1">Enter these by hand:</p>
                  {manual.map(f => (
                    <p key={f.id} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      · {f.home_team} v {f.away_team}
                    </p>
                  ))}
                </div>
              )}

              {linked.length === 0 && lastRun && (
                <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
                  None found, so enter these results yourself as usual. Coverage reaches step 4 of
                  the English pyramid — below that (North West Counties, West Lancashire, works and
                  Sunday leagues) nothing is listed. If these are professional fixtures, check the
                  team names and kick-off dates: a spelling difference is the usual cause.
                </p>
              )}
            </div>
          )}

          {total === 0 && (
            <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
              Add some fixtures first.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
