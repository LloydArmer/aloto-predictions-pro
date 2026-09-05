import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Spinner } from '../../ui'
import { resolvePointRules, defaultRules } from '../../../lib/scoring'
import { liveStandings, anyInPlay, liveLabel, effectiveScore } from '../../../lib/livePoints'
import { fitName } from '../../../lib/names'

/**
 * The table as it stands while matches are being played.
 *
 * Shown only when something is actually in play, and hidden entirely otherwise.
 * A permanent "live" panel sitting empty all week trains people to ignore it,
 * and then they miss it on the one afternoon it matters.
 *
 * Everything here is PROVISIONAL and says so. The figures are computed in the
 * browser from live scores and never written anywhere: a goal moves the table
 * instantly, a disallowed goal moves it back, and nobody's real points change
 * until the admin confirms the results. That separation is what lets the live
 * table be wrong for ten seconds without consequence.
 */
export default function LiveStandings({ competitionId }) {
  const [rows, setRows] = useState([])
  const [fixtures, setFixtures] = useState([])
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [gameweek, setGameweek] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    if (!competitionId) { setLive(false); setLoading(false); return }

    let cancelled = false
    let timer

    async function load() {
      // The active gameweek, found through the join table — a cup runs on
      // gameweeks that belong to another competition, so filtering on
      // gameweeks.competition_id would find nothing for it.
      const { data: links } = await supabase.from('competition_gameweeks')
        .select('gameweek_id').eq('competition_id', competitionId)

      const gwIds = (links || []).map(l => l.gameweek_id)
      if (!gwIds.length) { if (!cancelled) { setLive(false); setLoading(false) } return }

      const { data: gws } = await supabase.from('gameweeks')
        .select('id, number').in('id', gwIds).eq('status', 'active').limit(1)

      const gw = gws?.[0]
      if (!gw) { if (!cancelled) { setLive(false); setLoading(false) } return }

      const [{ data: fx }, { data: preds }, { data: parts }, rules] = await Promise.all([
        supabase.from('fixtures')
          .select('id, home_team, away_team, is_void, home_score, away_score, live_home_score, live_away_score, live_status, live_minute, live_updated_at, kickoff_time')
          .eq('gameweek_id', gw.id).order('kickoff_time'),
        supabase.from('predictions')
          .select('user_id, fixture_id, predicted_home, predicted_away').eq('gameweek_id', gw.id),
        supabase.from('participants')
          .select('user_id, profiles(display_name)').eq('competition_id', competitionId),
        resolvePointRules(supabase, competitionId),
      ])

      if (cancelled) return

      // resolvePointRules returns NULL when a competition has no point_rules
      // row, and passing null into the scoring function throws on
      // rules.correct_result_points — which killed this component silently and
      // left the panel invisible even when everything else was correct.
      const activeRules = rules || defaultRules()

      const inPlay = anyInPlay(fx || [])
      setLive(inPlay)
      setGameweek(gw)
      setFixtures(fx || [])
      setRows(liveStandings(parts || [], fx || [], preds || [], activeRules))
      setUpdatedAt(new Date())
      setLoading(false)

      // 45 seconds while matches are on, and nothing at all otherwise. There
      // is no point re-querying every 45 seconds on a Tuesday.
      if (inPlay && !cancelled) timer = setTimeout(load, 45000)
    }

    // Wrapped so a failure hides the panel rather than taking the whole
    // Standings page down with it. A missing live table is a disappointment;
    // a blank screen is a bug report.
    load().catch(err => {
      console.error('LiveStandings failed:', err)
      if (!cancelled) { setLive(false); setLoading(false) }
    })

    return () => { cancelled = true; clearTimeout(timer) }
  }, [competitionId])

  if (loading || !live) return null

  const playing = fixtures.filter(f =>
    ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(f.live_status))

  return (
    <Card className="p-0 mb-4 overflow-hidden"
      style={{ borderColor: 'rgba(255,170,51,0.35)' }}>

      <div className="px-3 py-2.5 flex items-center justify-between gap-2 flex-wrap"
        style={{ background: 'var(--amber-dim)' }}>
        <span className="flex items-center gap-2">
          <span className="live-dot" aria-hidden="true"/>
          <span className="text-sm font-semibold" style={{ color: 'var(--amber)' }}>
            Live — gameweek {gameweek?.number}
          </span>
        </span>
        <span className="text-xs" style={{ color: 'var(--amber)' }}>
          {playing.length} match{playing.length !== 1 ? 'es' : ''} in play
        </span>
      </div>

      {/* The matches driving the numbers below, so a change in the table can be
          traced to a goal rather than looking like a glitch. */}
      <div className="px-3 py-2" style={{ borderBottom: '0.5px solid var(--border)' }}>
        {playing.map(f => {
          const s = effectiveScore(f)
          return (
            <div key={f.id} className="flex items-center justify-between gap-2 py-1">
              <span className="text-xs" style={{ color: 'var(--txt-second)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {f.home_team} v {f.away_team}
              </span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-xs font-semibold num" style={{ color: 'var(--txt-primary)' }}>
                  {s ? `${s.home}–${s.away}` : '–'}
                </span>
                <span className="text-xs" style={{ color: 'var(--amber)', minWidth: 30, textAlign: 'right' }}>
                  {liveLabel(f)}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <table className="data-table">
        <thead><tr>
          <th style={{ width: 28, paddingLeft: 12 }}>#</th>
          <th className="name-cell">Player</th>
          <th style={{ width: 62, textAlign: 'right', paddingRight: 12 }}>Pts</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.user_id}>
              <td style={{ paddingLeft: 12 }}>
                <span className="text-xs font-medium"
                  style={{ color: i === 0 ? 'var(--gold)' : 'var(--txt-muted)' }}>{i + 1}</span>
              </td>
              <td className="name-cell">
                <p className="text-sm" title={r.display_name} style={{ color: 'var(--txt-primary)' }}>
                  {fitName(r.display_name)}
                </p>
              </td>
              <td style={{ textAlign: 'right', paddingRight: 12 }}>
                <span className="text-sm font-semibold num" style={{ color: 'var(--txt-primary)' }}>
                  {r.total}
                </span>
                {/* How much of the total could still change. "14, 6 in play"
                    is more use than a bare 14 that might drop. */}
                {r.provisional > 0 && (
                  <span className="text-xs ml-1" style={{ color: 'var(--amber)' }}>
                    ({r.provisional})
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs px-3 py-2" style={{ color: 'var(--txt-muted)', borderTop: '0.5px solid var(--border)' }}>
        Provisional. Points in amber are still in play and don't count until your admin confirms
        the results. Full house bonuses aren't shown until every match has finished.
        {updatedAt && ` Updated ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`}
      </p>
    </Card>
  )
}
