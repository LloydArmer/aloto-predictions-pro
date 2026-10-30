import { useState } from 'react'
import { Button, Card } from '../../ui'

/**
 * The house rules, shown once before anybody's first message.
 *
 * This is Apple's requirement that users agree to terms prohibiting
 * objectionable content and abusive behaviour. It is also the thing a reviewer
 * looks for, so it is a gate rather than a link: the composer does not exist
 * until this has been accepted.
 *
 * Deliberately short. Rules nobody reads protect nobody, and five lines in
 * plain English stand a better chance than a page of clauses.
 */
export default function HouseRules({ onAccept, competitionName }) {
  const [saving, setSaving] = useState(false)

  async function accept() {
    setSaving(true)
    await onAccept()
    setSaving(false)
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <i className="ti ti-messages text-xl" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        <h2 className="text-base font-medium" style={{ color: 'var(--txt-primary)' }}>
          Before you join the chat
        </h2>
      </div>

      <p className="text-sm mb-3" style={{ color: 'var(--txt-second)' }}>
        {competitionName ? `${competitionName} has` : 'Your league has'} a group chat for talking
        about the football. It is a small group of people who know each other, so the
        rules are short.
      </p>

      <ul className="text-sm mb-4 space-y-2" style={{ color: 'var(--txt-second)' }}>
        <Rule icon="ti-ban">
          No abuse, harassment, threats or hate. Nothing about someone's race, religion,
          sex, sexuality or disability.
        </Rule>
        <Rule icon="ti-eye-off">
          No sexual content, and nothing you would not want a reviewer, an admin or
          somebody's kid reading.
        </Rule>
        <Rule icon="ti-user-off">
          Don't post other people's private information.
        </Rule>
        <Rule icon="ti-flag">
          If someone breaks these rules, report the message. An admin will look at it
          within a day.
        </Rule>
        <Rule icon="ti-shield-check">
          Admins can remove messages and remove people from the chat. Being removed from
          a chat does not affect your predictions, your points or your place in the table.
        </Rule>
      </ul>

      <p className="text-xs mb-4" style={{ color: 'var(--txt-muted)' }}>
        Messages are filtered automatically, so some words will be rejected when you
        try to send them. You can block any player, which hides everything they post
        from you, in every league. They are not told.
      </p>

      <Button variant="primary" onClick={accept} disabled={saving}>
        {saving ? 'Saving…' : 'I agree — take me to the chat'}
      </Button>
    </Card>
  )
}

function Rule({ icon, children }) {
  return (
    <li className="flex gap-2">
      <i className={`ti ${icon} text-base flex-shrink-0`}
        style={{ color: 'var(--txt-muted)', marginTop: 2 }} aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}
