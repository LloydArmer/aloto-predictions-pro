import { useState } from 'react'
import { Card, SectionLabel } from '../../ui'

/**
 * How-to Guides (version 2.2).
 *
 * One short guide per job someone actually comes here to do. Each guide is the
 * same shape, so people learn where to look:
 *
 *   summary  one or two sentences: what it is and when it matters
 *   steps    numbered, each one a screen path in bold and what to do there
 *   notes    the rules that catch people out, as term + explanation
 *   tip      one practical tip, in the purple callout
 *
 * Everything starts closed so the whole list fits a phone screen and people can
 * see what's covered before reading any of it.
 *
 * Deliberately vague about specific football point values: every admin sets
 * their own, so quoting numbers would be wrong for most leagues. The NFL screen
 * shows its own values above the games, so the guide points there.
 *
 * REVIEW THIS FILE WITH EVERY APP UPDATE BUILD. If a screen, tab, menu item,
 * reminder or Pro rule changes, the guide that mentions it changes too.
 */
export default function HowToPlay({ isAdmin = false }) {
  const [open, setOpen] = useState(null)

  const groups = [
    { title: 'Playing', guides: PLAYING },
    { title: 'NFL', guides: NFL },
    { title: 'Free and Pro', guides: PLANS },
    ...(isAdmin ? [{ title: 'Running a competition', guides: ADMIN }] : []),
  ]

  return (
    <div>
      <SectionLabel className="mb-1">How-to Guides</SectionLabel>
      <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)', lineHeight: 1.5 }}>
        Short guides to every part of the app. Tap one to open it.
      </p>

      {groups.map(g => (
        <div key={g.title} className="mb-4">
          <p className="text-xs font-semibold uppercase mb-2"
            style={{ color: 'var(--accent-txt, var(--accent))', letterSpacing: '0.06em' }}>
            {g.title}
          </p>

          {g.guides.map(guide => {
            const isOpen = open === guide.key
            return (
              <Card key={guide.key} className="mb-2 p-0 overflow-hidden">
                <button
                  onClick={() => setOpen(isOpen ? null : guide.key)}
                  aria-expanded={isOpen}
                  className="flex items-center justify-between w-full px-4 py-3 text-left gap-3">
                  <span className="flex items-center gap-2.5 min-w-0">
                    <i className={`ti ${guide.icon} text-base flex-shrink-0`}
                      style={{ color: 'var(--accent)' }} aria-hidden="true"/>
                    <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{guide.title}</span>
                  </span>
                  <i className={`ti ti-chevron-${isOpen ? 'up' : 'down'} text-base flex-shrink-0`}
                    style={{ color: 'var(--txt-muted)' }} aria-hidden="true"/>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4" style={{ borderTop: '0.5px solid var(--border)' }}>
                    <div className="pt-3"><Guide guide={guide}/></div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/* ========================================================================== */
/*  The guides                                                                */
/* ========================================================================== */

const PLAYING = [
  {
    key: 'start',
    icon: 'ti-rocket',
    title: 'Getting started',
    summary: 'ALOTO is invite-only. You join a competition with the six-character code your admin shares, and everything else is set up for you.',
    steps: [
      ['Join', 'Dashboard → Join a competition. Enter the code (for example ABC123) and tap Join.'],
      ['Pick a competition', 'If you are in more than one, choose it from the selector at the top of Predict or Standings.'],
      ['Switch sport', 'If you play football and NFL, tap the sport chooser in the top bar. Each sport keeps its own competitions.'],
      ['Turn on reminders', 'Settings → Push notifications, on each phone you use.'],
    ],
    tip: 'Got a second code? Settings → Join a competition works too. There is no limit to how many competitions you can play in.',
  },
  {
    key: 'predict',
    icon: 'ti-pencil',
    title: 'Making your predictions',
    summary: 'Predict the score of every fixture in the gameweek. Each fixture locks at its own kick-off, not at one weekly deadline.',
    steps: [
      ['Open the gameweek', 'Predict → My Predictions. The current gameweek is shown first.'],
      ['Enter scores', 'Type a score for each fixture. You can do some now and the rest later.'],
      ['Save', 'Tap Save. The button changes to Update once saved, and you can change any fixture until it kicks off.'],
      ['See how everyone did', 'Predict → Gameweek Results, once fixtures have kicked off.'],
    ],
    notes: [
      ['Hidden until kick-off', 'Nobody sees your prediction before the fixture locks. Not other players, not your admin.'],
      ['Missed one?', 'If Saturday\'s early game has started, you can still predict Sunday\'s.'],
    ],
  },
  {
    key: 'points',
    icon: 'ti-star',
    title: 'Points and bonuses (football)',
    summary: 'Points for the right result, more for the exact score, and bonuses for a perfect gameweek. Your admin sets the values, so check your competition\'s Scoring for exact numbers.',
    notes: [
      ['Correct result', 'You called the win, draw or loss.'],
      ['Exact score', 'Both scores right. Added on top of the result points.'],
      ['Full house: results', 'Every result in the gameweek right. You must have predicted every fixture.'],
      ['Full house: scores', 'Every score exactly right. Rarer, and worth more.'],
      ['Voided fixture', 'A postponed fixture your admin voids counts for nothing and doesn\'t spoil a full house.'],
    ],
    tip: 'A common setup is 2 points for the result and 3 more for the exact score. Yours may differ.',
  },
  {
    key: 'triple',
    icon: 'ti-bolt',
    title: 'Triple Points',
    summary: 'A chip that triples everything you score in one football gameweek, bonuses included. You get two a season: one before 31 December and one after.',
    steps: [
      ['Predict every fixture', 'The chip only unlocks once the whole gameweek is predicted.'],
      ['Play it', 'Predict → My Predictions. Tap Triple Points 1 (due by 31 December) or Triple Points 2 (due by the end of the season) before the gameweek starts.'],
      ['Confirm', 'It can\'t be undone, and it uses that half of the season\'s chip.'],
    ],
    notes: [
      ['Blocked gameweeks', 'Your admin can block Triple Points for a gameweek. The button won\'t show.'],
      ['Use it or lose it', 'An unplayed chip scores nothing when its half of the season ends.'],
    ],
  },
  {
    key: 'season',
    icon: 'ti-calendar-star',
    title: 'Season predictions',
    summary: 'Calls you make once, before the season, scored at the end. Everything stays sealed until the deadline, then everyone can compare.',
    steps: [
      ['Open them', 'Football: Predict → Season. NFL: Predict → Season tab.'],
      ['Final league table (football)', 'Drag every team into the order you think they will finish. Points for each one in exactly the right place.'],
      ['Individual questions', 'Pick an answer for each one, such as league winner or Super Bowl winner. Each carries its own points.'],
      ['Beat the deadline', 'The countdown is on your Dashboard. After it, picks lock and open for everyone to see.'],
    ],
    tip: 'Season points go into a separate Season column, added to your total at the end of the season. See Standings → Season.',
  },
  {
    key: 'cups',
    icon: 'ti-tournament',
    title: 'Cup competitions',
    summary: 'A knockout played alongside the league. You don\'t predict separately: your normal gameweek predictions count for both.',
    notes: [
      ['How a tie works', 'You\'re drawn against another player for a gameweek. Whoever scores more that week goes through.'],
      ['Level scores', 'A replay in the next gameweek.'],
      ['Group + Knockout', 'A round-robin group stage first, then the top players go into the bracket.'],
    ],
    tip: 'Follow the draw under Standings → Cup.',
  },
  {
    key: 'standings',
    icon: 'ti-list-numbers',
    title: 'Standings and chat',
    summary: 'Everything about where you stand is under Standings. Live positions appear at the top while matches are being played.',
    notes: [
      ['Overall', 'The season-long league table.'],
      ['Monthly', 'Each month\'s table, by the gameweeks your admin assigns to it.'],
      ['Cup', 'The draw and results, if your competition has one.'],
      ['Season', 'Season prediction results once they\'re scored.'],
      ['Chat', 'The speech-bubble icon in the top bar. Each competition has its own chat, with replies and @mentions. Tap ⋯ on a message to reply, report it or block someone.'],
    ],
  },
  {
    key: 'reminders',
    icon: 'ti-bell',
    title: 'Reminders',
    summary: 'Push reminders so you never miss a gameweek. Deadline reminders only go to people who still have something to predict.',
    steps: [
      ['Switch them on', 'Settings → Push notifications. Do it on each device you want reminders on.'],
      ['Tap a reminder', 'It opens the right competition and sport, ready to predict.'],
    ],
    notes: [
      ['Gameweek open', 'When your admin opens a gameweek. Everyone gets this one.'],
      ['24 hours to go', 'Before the first kick-off, if you have predictions outstanding.'],
      ['1 hour to go', 'The final reminder. Only the first fixture locks then; later ones stay open until their own kick-off.'],
      ['Season predictions', 'When they open, then 24 hours and 1 hour before the deadline, if you haven\'t finished.'],
    ],
    tip: 'Reminders arriving twice, or not at all? Settings → Reset notifications clears every device on your account and sets this one up again.',
  },
]

const NFL = [
  {
    key: 'nfl-picks',
    icon: 'ti-ball-american-football',
    title: 'NFL picks',
    summary: 'Predict the score of every game each week. Points for the right winner, more for each team score you get exactly, more the closer your winning margin is, and the most for the exact score.',
    steps: [
      ['Switch to NFL', 'Tap the sport chooser in the top bar.'],
      ['Open the week', 'Predict → This week. Pick the week from the selector if you want a different one.'],
      ['Enter both scores', 'The margin you\'re calling shows underneath, for example "Kansas City by 7".'],
      ['Save', 'Each game locks at its own kick-off, from Thursday night to Monday.'],
    ],
    notes: [
      ['Scoring', 'Points add up. Right winner 2, plus 5 for each team whose score you get exactly, plus your margin: exact 12, within 2 is 10, within 4 is 8, within 7 is 6, within 10 is 4, within 14 is 2. An exact score is 24. Your league\'s own numbers are shown above the games.'],
      ['Wrong winner', 'Backing the wrong team scores 0, however close the score.'],
      ['Ties', 'Calling a tie that ends tied counts as the right winner.'],
      ['Overtime', 'Final scores include overtime.'],
      ['No chips', 'Triple Points and full house bonuses are football only.'],
    ],
  },
  {
    key: 'nfl-season',
    icon: 'ti-trophy',
    title: 'NFL season questions',
    summary: 'Call the season before it starts. Three questions are free in every NFL league. Others are added by an admin with Pro.',
    steps: [
      ['Open them', 'Predict → Season tab, in your NFL league.'],
      ['Make your picks', 'Choose a team for each question before the deadline.'],
    ],
    notes: [
      ['Free in every league', 'Super Bowl Winner, AFC Champion and NFC Champion.'],
      ['With Pro', 'NFL MVP, the division winners, and questions your admin writes.'],
    ],
    tip: 'Playing is free either way. Pro is only about which questions your admin can add.',
  },
  {
    key: 'nfl-reminders',
    icon: 'ti-bell-ringing',
    title: 'NFL reminders',
    summary: 'The same reminders as football, worded for the NFL: "games" and "picks", with the away team first (KC @ BUF).',
    notes: [
      ['When', 'When the week opens, 24 hours before the first game, and 1 hour before it, if you have picks to make.'],
      ['Where they go', 'Tapping one opens your NFL league, never football. Season reminders open the Season tab.'],
    ],
  },
]

const PLANS = [
  {
    key: 'pro',
    icon: 'ti-crown',
    title: 'Free and Pro',
    summary: 'Playing is always free, in as many competitions as you like, with no adverts. Pro is for admins who want to run more.',
    notes: [
      ['Free', 'Unlimited leagues, one cup, one final league table prediction, and the NFL Super Bowl, AFC and NFC champion questions.'],
      ['Pro', 'Unlimited cups, individual season predictions including questions you write yourself, NFL MVP and division winner questions, and a full archive of past seasons.'],
      ['Who pays', 'Only the admin. Everyone in a Pro admin\'s competitions gets what it unlocks, without paying.'],
      ['Price', '£29.99 a year, through the App Store. Settings → ALOTO Pro.'],
    ],
    tip: 'Changed phone or reinstalled? Settings → ALOTO Pro → Restore purchases.',
  },
]

const ADMIN = [
  {
    key: 'admin-setup',
    icon: 'ti-shield',
    title: 'Setting up a competition',
    summary: 'Admin is in the top bar on a tablet or computer, and in the top-right menu on a phone.',
    steps: [
      ['Choose the sport', 'Switch to football or NFL in the top bar first. A competition belongs to one sport.'],
      ['Create it', 'Admin → Competitions. League for a points table, Knockout or Group + Knockout for a cup.'],
      ['Set the points', 'Admin → Scoring.'],
      ['Invite people', 'Admin → Players. Share the six-character join code.'],
      ['Cups', 'Admin → Cup. A cup borrows its scoring from a league you nominate, so set the league up first.'],
    ],
    tip: 'Admin → Players shows who will actually receive reminders, so you know who to chase.',
  },
  {
    key: 'admin-fixtures',
    icon: 'ti-calendar',
    title: 'Gameweeks and fixtures',
    summary: 'Admin → Fixtures lists your gameweeks under Current, Upcoming and Done. Tap one to open it. Everything for that gameweek is on three tabs.',
    steps: [
      ['Add a gameweek', 'Tap + Gameweek and give it a label, such as 1, R16 or QF1.'],
      ['Fixtures tab', 'Tap Add fixtures to bring in matches. Results come in automatically; you can still enter or correct one.'],
      ['Predictions tab', 'See who has predicted and who hasn\'t.'],
      ['Settings tab', 'The month it counts towards, Block Triple Points, full house bonuses for this gameweek, and Also used in to share it with other competitions.'],
      ['Make it current', '⋯ → Set as current. This opens it and sends the "gameweek open" reminder.'],
    ],
    notes: [
      ['Gameweek ⋯ menu', 'Set as current or Mark completed, Share on WhatsApp, Delete gameweek.'],
      ['Fixture ⋯ menu', 'Correct result, Void (postponed) or Restore fixture, Delete fixture.'],
      ['Shared gameweeks', 'Predictions are shared between linked competitions. Each scores them with its own rules.'],
    ],
    tip: 'Void a postponed fixture rather than deleting it. It then counts for nothing and doesn\'t spoil anyone\'s full house.',
  },
  {
    key: 'admin-season',
    icon: 'ti-calendar-star',
    title: 'Season predictions setup',
    summary: 'Admin → Season. Set up the final table, the individual questions, and the deadline, then open them.',
    steps: [
      ['Final league table', 'Pick a league, paste the team list, set a deadline and open it.'],
      ['Questions', 'Add the questions and their points, and set a deadline.'],
      ['Check entries', 'The Season tab shows who has entered and who hasn\'t.'],
    ],
    notes: [
      ['NFL on the free plan', 'You can add Super Bowl Winner, AFC Champion and NFC Champion. Questions with a lock need Pro.'],
      ['If Pro lapses', 'Questions you\'ve already added stay. You just can\'t add more Pro ones.'],
    ],
  },
]

/* ========================================================================== */
/*  Layout                                                                    */
/* ========================================================================== */

function Guide({ guide }) {
  return (
    <>
      {guide.summary && <P>{guide.summary}</P>}
      {guide.steps && <Steps items={guide.steps}/>}
      {guide.notes && <Notes items={guide.notes}/>}
      {guide.tip && <Tip>{guide.tip}</Tip>}
    </>
  )
}

const P = ({ children }) => (
  <p className="text-sm mb-3" style={{ color: 'var(--txt-second)', lineHeight: 1.55 }}>{children}</p>
)

const Steps = ({ items }) => (
  <ol className="mb-3">
    {items.map(([term, desc], i) => (
      <li key={i} className="flex gap-3 mb-2.5">
        <span className="flex items-center justify-center flex-shrink-0 text-xs font-semibold rounded-full"
          style={{ width: 22, height: 22, marginTop: 1, background: 'var(--accent-dim)', color: 'var(--accent)', border: '0.5px solid var(--accent-line)' }}>
          {i + 1}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{term}</span>
          <span className="block text-sm" style={{ color: 'var(--txt-second)', lineHeight: 1.5 }}>{desc}</span>
        </span>
      </li>
    ))}
  </ol>
)

const Notes = ({ items }) => (
  <div className="mb-3">
    {items.map(([term, desc], i) => (
      <div key={i} className="mb-2">
        <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{term}</p>
        <p className="text-sm" style={{ color: 'var(--txt-second)', lineHeight: 1.5 }}>{desc}</p>
      </div>
    ))}
  </div>
)

const Tip = ({ children }) => (
  <div className="flex gap-2.5 rounded-lg px-3 py-2.5"
    style={{ background: 'var(--accent-dim)', border: '0.5px solid var(--accent-line)' }}>
    <i className="ti ti-bulb text-base flex-shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true"/>
    <p className="text-sm" style={{ color: 'var(--txt-second)', lineHeight: 1.5 }}>{children}</p>
  </div>
)
