import { supabase } from './supabase'

/**
 * Scores the season predictions for a competition and writes the totals to
 * season_scores.
 *
 * Written once when the admin runs it, rather than derived on every page load.
 * A season score is final by the time it exists, and the standings shouldn't
 * have to recompute a whole league table comparison every time someone opens
 * the Table tab.
 *
 * Safe to run repeatedly — it upserts, so re-running after correcting a result
 * simply overwrites the previous figures.
 */
export async function calculateSeasonScores(competitionId) {
  const totals = {} // userId -> { table_points, table_correct, picks_points, picks_correct }

  const seed = uid => {
    if (!totals[uid]) totals[uid] = { table_points: 0, table_correct: 0, picks_points: 0, picks_correct: 0 }
    return totals[uid]
  }

  // ---- Final league table -------------------------------------------------
  const { data: tableConfig } = await supabase
    .from('season_table_configs')
    .select('id, points_per_position, results_entered')
    .eq('competition_id', competitionId).maybeSingle()

  if (tableConfig?.results_entered) {
    const { data: results } = await supabase
      .from('season_table_results').select('position, team_id').eq('config_id', tableConfig.id)

    // position -> the team that actually finished there
    const actual = {}
    ;(results || []).forEach(r => { actual[r.position] = r.team_id })

    const { data: preds } = await supabase
      .from('season_table_predictions').select('user_id, position, team_id').eq('config_id', tableConfig.id)

    for (const p of (preds || [])) {
      const t = seed(p.user_id)
      // Exact position only. A team one place out scores nothing — the rule the
      // admin sets is "points for a correct position", and anything else would
      // be a different game.
      if (actual[p.position] && actual[p.position] === p.team_id) {
        t.table_correct += 1
        t.table_points  += tableConfig.points_per_position
      }
    }
  }

  // ---- Individual picks ---------------------------------------------------
  const { data: pickConfig } = await supabase
    .from('season_pick_configs').select('id')
    .eq('competition_id', competitionId).maybeSingle()

  if (pickConfig) {
    const { data: picks } = await supabase
      .from('season_picks').select('id, points, correct_option_id, allow_free_text').eq('config_id', pickConfig.id)

    const pickIds = (picks || []).map(p => p.id)
    const { data: answers } = pickIds.length
      ? await supabase.from('season_pick_answers').select('pick_id, user_id, option_id, is_correct').in('pick_id', pickIds)
      : { data: [] }

    const byId = Object.fromEntries((picks || []).map(p => [p.id, p]))

    for (const a of (answers || [])) {
      const pick = byId[a.pick_id]
      if (!pick) continue

      // Two ways to be right, depending on the question:
      //   free text — the admin read the answer and ticked it
      //   options   — the chosen option matches the correct one, no judgement
      const correct = pick.allow_free_text
        ? a.is_correct === true
        : (pick.correct_option_id != null && a.option_id === pick.correct_option_id)

      if (!correct) continue
      const t = seed(a.user_id)
      t.picks_correct += 1
      t.picks_points  += pick.points || 0
    }
  }

  // ---- Write --------------------------------------------------------------
  const rows = Object.entries(totals).map(([user_id, v]) => ({
    competition_id: competitionId,
    user_id,
    ...v,
    updated_at: new Date().toISOString(),
  }))

  if (!rows.length) return { scored: 0, totalPoints: 0 }

  const { error } = await supabase.from('season_scores').upsert(rows, { onConflict: 'competition_id,user_id' })
  if (error) throw error

  return {
    scored: rows.length,
    totalPoints: rows.reduce((s, r) => s + r.table_points + r.picks_points, 0),
  }
}

/**
 * Season points per participant, for adding into the overall standings.
 * Returns { userId: points } — empty when nothing has been scored yet.
 */
export async function fetchSeasonPoints(competitionId) {
  const { data } = await supabase
    .from('season_scores').select('user_id, table_points, picks_points').eq('competition_id', competitionId)

  const map = {}
  ;(data || []).forEach(r => { map[r.user_id] = (r.table_points || 0) + (r.picks_points || 0) })
  return map
}

/** Days until a deadline. Negative once it has passed; null if there isn't one. */
export function daysUntil(deadline) {
  if (!deadline) return null
  const ms = new Date(deadline).getTime() - Date.now()
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

/** "3 days left", "Last day", "Closed" — for the dashboard countdown. */
export function deadlineLabel(deadline) {
  const days = daysUntil(deadline)
  if (days === null) return 'No deadline set'
  if (days < 0) return 'Closed'
  if (days === 0) return 'Closes today'
  if (days === 1) return '1 day left'
  return `${days} days left`
}
