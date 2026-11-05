import { resolvePointRules, recalculateGameweek } from '../scoring'
import { nflPointRules, recalculateNflGameweek } from './nfl/scoring'

/**
 * Score a gameweek for every competition it is linked to, each by its own
 * sport's rules.
 *
 * This is the one place that knows more than one sport exists. Football
 * competitions go to football's own scoring exactly as before — the same two
 * calls recalculateGameweekForAllLinkedCompetitions makes — and NFL
 * competitions go to the NFL scorer. Neither scorer knows about the other.
 *
 * A competition with no sport (before migration 111) counts as football.
 */
export async function recalculateGameweekForEachSport(supabase, gameweekId) {
  const { data: links } = await supabase.from('competition_gameweeks')
    .select('competition_id').eq('gameweek_id', gameweekId)
  const competitionIds = [...new Set((links || []).map(l => l.competition_id))]
  if (!competitionIds.length) return competitionIds

  const { data: comps } = await supabase.from('competitions').select('*').in('id', competitionIds)
  const sportById = {}
  ;(comps || []).forEach(c => { sportById[c.id] = c.sport || 'football' })

  for (const competitionId of competitionIds) {
    if (sportById[competitionId] === 'nfl') {
      const rules = await nflPointRules(supabase, competitionId)
      await recalculateNflGameweek(supabase, competitionId, gameweekId, rules)
    } else {
      const rules = await resolvePointRules(supabase, competitionId)
      if (rules) await recalculateGameweek(supabase, competitionId, gameweekId, rules)
    }
  }
  return competitionIds
}
