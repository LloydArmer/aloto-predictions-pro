import { LegalShell, H, P, List, Mail } from './Privacy'

/**
 * Support page.
 *
 * Apple requires a working support URL on the listing and checks it. Public, no
 * sign-in — a reviewer without an account has to be able to read it.
 *
 * Written to actually answer the questions people ask rather than just to
 * satisfy the requirement. The notification section in particular covers the
 * three real causes we found while building: permission denied, no device
 * registered, and a stale service worker.
 */
export default function Support() {
  return (
    <LegalShell title="Support" updated="August 2026">
      <P>
        Something not working, or a question about how the game runs? Email <Mail/> and you'll get a
        reply. Include your display name and which competition you're in — it saves a round trip.
      </P>

      <H>Getting started</H>
      <P>
        ALOTO Prediction Pro is for private leagues. You can't browse or join competitions at random:
        someone running one has to send you a join code.
      </P>
      <List items={[
        'Create an account with your email address.',
        'Your league admin sends you a six-character code.',
        'Enter it on the dashboard, or in Settings, and you\'re in.',
      ]}/>

      <H>How scoring works</H>
      <P>
        Each admin sets their own points, so check with yours. A common setup is 2 points for the
        right result and 3 more for the exact score, so an exact prediction is worth 5.
      </P>
      <List items={[
        'Full house bonuses — extra points for getting every result, or every score, right in a gameweek. You must have predicted every fixture to qualify.',
        'Triple Points — a chip that triples one gameweek. Two per season, and you must have predicted every fixture to play it.',
        'Season predictions — the final league table, and one-off calls like who wins the cup. Scored at the end of the season and added to your total.',
      ]}/>

      <H>When predictions lock</H>
      <P>
        Each fixture locks at its own kick-off, not at a single weekly deadline. You can keep editing
        the later games in a gameweek after the early ones have started.
      </P>
      <P>
        Nobody can see your predictions until they lock — not other players, not your admin.
      </P>

      <H>Reminders aren't arriving</H>
      <P>Almost always one of three things:</P>
      <List items={[
        'Reminders are off. Settings → Push notifications. If the switch is on but it says no device is registered, turn it off and on again.',
        'Permission was denied. iPhone: Settings app → ALOTO Prediction Pro → Notifications → Allow. Once denied, the app can\'t ask again — it has to be changed there.',
        'Something is stuck. Settings → Reset notifications clears every device on your account and registers this one afresh. This fixes duplicate and erratic reminders.',
      ]}/>
      <P>
        Do Not Disturb doesn't lose reminders — they arrive silently and wait in your notification
        centre. If notifications are switched off for the app entirely, anything sent while they were
        off is gone, and won't arrive later.
      </P>

      <H>I can't see my competition</H>
      <P>
        You only see competitions you've been added to. If yours is missing, ask your admin to check
        you're on the participant list, or to send you the join code again.
      </P>

      <H>I've forgotten my password</H>
      <P>Use the reset link on the sign-in screen. Check your spam folder if the email doesn't appear.</P>

      <H>Free and Pro</H>
      <P>
        Everything a player does is free. There is no charge to join a league, make predictions, or
        play in a cup.
      </P>
      <P>
        Pro is for people who run competitions. Free accounts can run unlimited leagues, one cup and
        one final league table; Pro removes those limits. Only the admin pays, and everyone in their
        competitions gets the benefit.
      </P>

      <H>Deleting your account</H>
      <P>
        Email <Mail/> and your account will be deleted along with your predictions and scores. Say
        which email address the account uses.
      </P>

      <H>Still stuck</H>
      <P>
        Email <Mail/> with your display name, your competition, and what you were doing when it went
        wrong. A screenshot helps.
      </P>
    </LegalShell>
  )
}
