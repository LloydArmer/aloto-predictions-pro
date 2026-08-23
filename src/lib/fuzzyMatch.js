/**
 * Matching typed answers against a correct one.
 *
 * Free-text questions get answers like "Haaland", "Erling Haaland",
 * "E. Haaland", "haaland" and "Halland" — all meaning the same thing. Marking
 * twenty of those by hand every season is exactly the tedium that leads to
 * mistakes, so this suggests which ones match and the admin confirms.
 *
 * Suggests, not decides. Nobody's season points get awarded by a similarity
 * score without a person agreeing — the admin ticks the final list.
 */

/**
 * Abbreviations and nicknames people type instead of the full name.
 *
 * Deliberately short and football-specific. A general fuzzy algorithm will
 * never get "Spurs" to "Tottenham Hotspur" — they share no letters in common
 * order — so the handful that actually come up are listed rather than hoped
 * for. Add to it as you meet new ones.
 */
const ALIASES = {
  utd: 'united',
  man: 'manchester',
  spurs: 'tottenham hotspur',
  wolves: 'wolverhampton wanderers',
  brighton: 'brighton hove albion',
  west: 'west',
  forest: 'nottingham forest',
  nufc: 'newcastle united',
  lfc: 'liverpool',
  mcfc: 'manchester city',
  mufc: 'manchester united',
  thfc: 'tottenham hotspur',
  cfc: 'chelsea',
  psg: 'paris saint germain',
  atleti: 'atletico madrid',
  barca: 'barcelona',
  inter: 'internazionale',
  juve: 'juventus',
}

/**
 * Strips everything that varies without changing meaning: case, accents,
 * punctuation, the club suffixes people include or omit at random, and the
 * common abbreviations.
 */
export function normalise(text) {
  if (!text) return ''
  const base = String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // café -> cafe
    .replace(/[^a-z0-9\s]/g, ' ')                        // drop punctuation
    // Club words carrying no distinguishing information: "Arsenal" and
    // "Arsenal FC" are the same answer.
    .replace(/\b(fc|afc|cf|sc|ac|the|club)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return base.split(' ')
    .map(w => ALIASES[w] || w)
    // Single letters are initials — "E Haaland" carries the same information as
    // "Haaland", and keeping the "e" only makes the two look different.
    .filter(w => w.length > 1)
    .join(' ')
    .trim()
}

/** Edit distance — how many single-character changes turn a into b. */
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,                                     // deletion
        curr[j - 1] + 1,                                 // insertion
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),   // substitution
      )
    }
    prev = curr
  }
  return prev[b.length]
}

/**
 * 0 to 1, where 1 is identical after normalising.
 *
 * Two signals, not one:
 *
 *   Edit distance catches typos — "Halland" against "Haaland".
 *   Word containment catches partial names — "Haaland" against "Erling
 *   Haaland" is only 0.54 by edit distance, but every word of the shorter
 *   answer appears in the longer one, which is what actually matters.
 */
export function similarity(a, b) {
  const x = normalise(a)
  const y = normalise(b)
  if (!x || !y) return 0
  if (x === y) return 1

  const wordsX = x.split(' ').filter(Boolean)
  const wordsY = y.split(' ').filter(Boolean)
  const shorter = wordsX.length <= wordsY.length ? wordsX : wordsY
  const longer  = wordsX.length <= wordsY.length ? wordsY : wordsX

  // Does this word appear in the longer answer — exactly, as a prefix, or
  // close enough to be a typo of it? Per-word rather than whole-string,
  // because one misspelled surname shouldn't sink an otherwise clear match.
  const wordMatches = (w, candidates) => candidates.some(l => {
    if (l === w) return true
    if (w.length >= 3 && l.startsWith(w)) return true
    if (l.length >= 3 && w.startsWith(l)) return true
    // "Halland" against "haaland": one edit in seven characters.
    const maxLen = Math.max(w.length, l.length)
    return maxLen >= 4 && 1 - levenshtein(w, l) / maxLen >= 0.75
  })

  // Surname-only answers, abbreviations, and single-word typos.
  const allWordsPresent = shorter.length > 0 && shorter.every(w => wordMatches(w, longer))
  if (allWordsPresent) return 0.95

  const distance = levenshtein(x, y)
  return 1 - distance / Math.max(x.length, y.length)
}

/** Above this, an answer is suggested as correct. */
export const MATCH_THRESHOLD = 0.82

export function looksCorrect(answer, correctAnswer) {
  return similarity(answer, correctAnswer) >= MATCH_THRESHOLD
}

/**
 * Groups identical-after-normalising answers so the admin sees "Haaland x7"
 * rather than seven separate rows saying the same thing.
 */
export function groupAnswers(answers) {
  const groups = new Map()

  for (const a of answers) {
    const key = normalise(a.answer_text)
    if (!groups.has(key)) {
      groups.set(key, { key, display: a.answer_text, answers: [] })
    }
    groups.get(key).answers.push(a)
  }

  return [...groups.values()].sort((x, y) => y.answers.length - x.answers.length)
}
