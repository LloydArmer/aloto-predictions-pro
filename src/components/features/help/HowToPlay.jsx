import { useState } from 'react'
import { Card, SectionLabel } from '../../ui'

/**
 * How to play.
 *
 * Collapsed sections rather than one long page: someone opening this wants one
 * answer, not a manual. Everything is closed to start so the whole thing fits a
 * phone screen and they can see what's covered before reading any of it.
 *
 * Deliberately vague about specific point values — every admin sets their own,
 * so quoting numbers here would be wrong for most leagues. It explains the
 * shape of the rules and says to check your own competition for the figures.
 */
export default function HowToPlay({ isAdmin = false }) {
  const [open, setOpen] = useState(null)

  const sections = [
    {
      key: 'basics',
      title: 'The basics',
      body: (
        <>
          <P>
            Predict the score of every fixture in a gameweek. Points for getting the result right,
            more for the exact score.
          </P>
          <P>
            Each fixture locks at its own kick-off — not at one weekly deadline. So if Saturday's
            early game has started, you can still edit Sunday's.
          </P>
          <P>
            Nobody sees your predictions until they lock. Not other players, not your admin.
          </P>
        </>
      ),
    },
    {
      key: 'points',
      title: 'Points and bonuses',
      body: (
        <>
          <P>
            Your admin sets the values, so check the Scoring section of your competition for exact
            numbers. A common setup is 2 points for the right result and 3 more for the exact score.
          </P>
          <Bullets items={[
            ['Correct result', 'You called the win, draw or loss.'],
            ['Exact score', 'Both scores right. Adds to the result points rather than replacing them.'],
            ['Full house — results', 'Every result in the gameweek correct. You must have predicted every fixture.'],
            ['Full house — scores', 'Every score exactly right. Rarer, and worth more.'],
          ]}/>
          <P>
            A postponed fixture can be voided by your admin. It then counts for nothing and doesn't
            spoil a full house.
          </P>
        </>
      ),
    },
    {
      key: 'triple',
      title: 'Triple Points',
      body: (
        <>
          <P>
            A chip that triples everything you score in one gameweek. Two per season — one before
            31 December, one after.
          </P>
          <P>
            You must have predicted every fixture in the gameweek to play it. Play it before the
            gameweek starts; you can't apply it retrospectively.
          </P>
          <P>
            Worth saving for a gameweek you feel confident about, but don't leave it so late you lose
            it — an unplayed chip scores nothing.
          </P>
        </>
      ),
    },
    {
      key: 'season',
      title: 'Season Predictions',
      body: (
        <>
          <P>Two separate things, both set before the season and scored at the end.</P>
          <Bullets items={[
            ['Final league table', 'Put every team in the order you think they will finish. Points for each one in exactly the right position.'],
            ['Individual Predictions', 'One-off calls — who wins the league, the cup, the golden boot. Each carries its own points.'],
          ]}/>
          <P>
            Both have a deadline, shown on your dashboard with a countdown. Once it passes they lock
            and everyone can see what everyone else picked.
          </P>
          <P>
            The points are added to your overall total as a separate Season column at the end of the
            season.
          </P>
        </>
      ),
    },
    {
      key: 'cups',
      title: 'Cup competitions',
      body: (
        <>
          <P>
            A knockout played alongside the league. You're drawn against another player for a given
            gameweek, and whoever scores more that week goes through.
          </P>
          <P>
            A draw means a replay in the next gameweek. Group and Knockout format adds a round-robin
            group stage first, with the top players progressing to the bracket.
          </P>
          <P>
            You don't predict separately for a cup — your normal gameweek predictions count for both.
          </P>
        </>
      ),
    },
    {
      key: 'reminders',
      title: 'Reminders',
      body: (
        <>
          <P>Three reminders, if you have them switched on in Settings:</P>
          <Bullets items={[
            ['A new gameweek opens', 'Everyone gets this one.'],
            ['24 hours before the first kick-off', 'Only if you still have predictions outstanding.'],
            ['1 hour before', 'A final nudge, again only if something is missing.'],
          ]}/>
          <P>
            If reminders stop working, Settings → Reset notifications clears every device on your
            account and sets this one up again.
          </P>
        </>
      ),
    },
    ...(isAdmin ? [{
      key: 'admin',
      title: 'Running a competition',
      body: (
        <>
          <Bullets items={[
            ['Create it', 'Admin → Competitions. League for a points table, Knockout or Group + Knockout for a cup.'],
            ['Invite people', 'Admin → Players. Share the six-character join code — they enter it and they\'re in.'],
            ['Set the points', 'Admin → Scoring. A gameweek can override the full house bonuses if it\'s unusually large.'],
            ['Add fixtures', 'Admin → Fixtures. Create a gameweek, add its matches, then enter results as they finish.'],
            ['Season predictions', 'Admin → Season. Pick a league, paste the team list, set a deadline and open it.'],
            ['Check who\'s missing', 'Admin → Players shows who will actually receive reminders, and the Season tab shows who has entered.'],
          ]}/>
          <P>
            A cup borrows its scoring from a league you nominate, so set the league up first.
          </P>
        </>
      ),
    }] : []),
  ]

  return (
    <div>
      <SectionLabel className="mb-2">How to play</SectionLabel>

      {sections.map(s => {
        const isOpen = open === s.key
        return (
          <Card key={s.key} className="mb-2 p-0 overflow-hidden">
            <button
              onClick={() => setOpen(isOpen ? null : s.key)}
              className="flex items-center justify-between w-full px-4 py-3 text-left gap-3">
              <span className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{s.title}</span>
              <i className={`ti ti-chevron-${isOpen ? 'up' : 'down'} text-base flex-shrink-0`}
                style={{ color: 'var(--txt-muted)' }} aria-hidden="true"/>
            </button>

            {isOpen && (
              <div className="px-4 pb-4" style={{ borderTop: '0.5px solid var(--border)' }}>
                <div className="pt-3">{s.body}</div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

const P = ({ children }) => (
  <p className="text-sm mb-2.5" style={{ color: 'var(--txt-second)', lineHeight: 1.55 }}>{children}</p>
)

const Bullets = ({ items }) => (
  <div className="mb-2.5">
    {items.map(([term, desc], i) => (
      <div key={i} className="mb-2">
        <p className="text-sm font-medium" style={{ color: 'var(--txt-primary)' }}>{term}</p>
        <p className="text-sm" style={{ color: 'var(--txt-second)', lineHeight: 1.5 }}>{desc}</p>
      </div>
    ))}
  </div>
)
