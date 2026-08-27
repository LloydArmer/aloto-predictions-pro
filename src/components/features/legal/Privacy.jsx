import { Link } from 'react-router-dom'

/**
 * Privacy policy.
 *
 * Deliberately public — no sign-in required. Apple's reviewer clicks this link
 * without an account, and a policy behind a login wall is a rejection.
 *
 * Written from what the app actually does rather than from a template. A
 * generic policy claiming to collect location, or to share data with
 * advertisers, would simply be untrue — and an inaccurate policy is worse than
 * a plain one.
 */
export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated="August 2026">
      <P>
        ALOTO Prediction Pro is a football prediction game for private leagues. This policy explains
        what it stores, why, and what you can do about it.
      </P>

      <H>What is collected</H>
      <P>When you create an account:</P>
      <List items={[
        'Your email address — used to sign in and to reset a forgotten password.',
        'A display name — shown to other people in your competitions.',
        'A password, stored only as an encrypted hash. Nobody can read it, including us.',
      ]}/>

      <P>While you use the app:</P>
      <List items={[
        'Your predictions, scores and competition memberships.',
        'A push notification token for each device you turn reminders on for. This identifies the device to Apple or Google so a reminder can reach it, and is not linked to anything else about you.',
        'A record of which reminders have been sent, so the same one is never sent twice.',
      ]}/>

      <H>What is not collected</H>
      <List items={[
        'No location data.',
        'No contacts, photos, camera or microphone access.',
        'No advertising identifiers, and no tracking across other apps or websites.',
        'No payment card details. If you buy a Pro upgrade, Apple handles the payment and we never see your card.',
      ]}/>

      <H>Who can see your information</H>
      <P>
        People in the same competition can see your display name, your predictions once they lock,
        and your scores. That is the point of a prediction league — but it is worth being explicit
        that other participants see those things.
      </P>
      <P>
        Predictions stay private until they lock. Gameweek predictions lock at each fixture's
        kick-off; season predictions lock at the deadline your admin sets. Before then nobody else
        can see them, including your league admin.
      </P>
      <P>Your email address is never shown to other participants.</P>

      <H>Who processes it</H>
      <P>These companies handle data on our behalf and for nothing else:</P>
      <List items={[
        'Supabase — stores the database and manages sign-in. Data is held in the EU.',
        'Netlify — serves the app.',
        'Google Firebase — delivers push notifications. It receives only the device token and the notification text.',
        'Apple — handles App Store purchases, if you buy anything.',
      ]}/>
      <P>Your information is not sold, rented or shared with anyone else.</P>

      <H>How long it is kept</H>
      <P>
        Account information is kept while your account exists. Delete your account and it is removed,
        along with your predictions and scores. Push tokens are deleted the moment you turn reminders
        off, and are removed automatically when a device stops responding.
      </P>

      <H>Your choices</H>
      <List items={[
        'Turn reminders off at any time in Settings. This deletes the token for that device.',
        'Use Reset notifications in Settings to clear every registered device and start again.',
        'Request a copy of your data, or ask for your account to be deleted, by emailing the address below.',
      ]}/>

      <H>Children</H>
      <P>
        The app is not aimed at children under 13, and accounts are not knowingly created for them.
      </P>

      <H>Changes</H>
      <P>
        If this policy changes in a way that matters, the date at the top changes and anyone affected
        is told in the app.
      </P>

      <H>Contact</H>
      <P>Questions about privacy, or a request to see or delete your data: <Mail/></P>
    </LegalShell>
  )
}

/* ---------------------------------------------------------------- */

export function LegalShell({ title, updated, children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <div className="max-w-2xl mx-auto px-5 py-8">
        <Link to="/" className="text-xs" style={{ color: 'var(--accent)' }}>← ALOTO Prediction Pro</Link>

        <h1 className="text-xl font-semibold mt-4 mb-1" style={{ color: 'var(--txt-primary)' }}>{title}</h1>
        <p className="text-xs mb-6" style={{ color: 'var(--txt-muted)' }}>Last updated {updated}</p>

        {children}

        <p className="text-xs mt-10 pt-6" style={{ color: 'var(--txt-muted)', borderTop: '0.5px solid var(--border)' }}>
          ALOTO Prediction Pro
        </p>
      </div>
    </div>
  )
}

export const H = ({ children }) => (
  <h2 className="text-sm font-semibold mt-6 mb-2" style={{ color: 'var(--txt-primary)' }}>{children}</h2>
)

export const P = ({ children }) => (
  <p className="text-sm mb-3" style={{ color: 'var(--txt-second)', lineHeight: 1.6 }}>{children}</p>
)

export const List = ({ items }) => (
  <ul className="mb-3" style={{ listStyle: 'disc', paddingLeft: 20 }}>
    {items.map((t, i) => (
      <li key={i} className="text-sm mb-1.5" style={{ color: 'var(--txt-second)', lineHeight: 1.6 }}>{t}</li>
    ))}
  </ul>
)

/** Change this in one place and both legal pages follow. */
export const SUPPORT_EMAIL = 'admin@alotopredictionpro.co.uk'

export const Mail = () => (
  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--accent)' }}>{SUPPORT_EMAIL}</a>
)
