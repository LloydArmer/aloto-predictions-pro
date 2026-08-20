import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { Card, Button, Input } from '../../ui'
import toast from 'react-hot-toast'

/**
 * Join a competition with a code an admin shared.
 *
 * The insert happens inside the join_competition_with_code database function,
 * not here. That function runs with elevated rights and checks the code first,
 * which is what makes the code the actual authorisation — the app can't add
 * anyone to a competition on its own say-so.
 */
export default function JoinCompetition({ onJoined, compact = false }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function join() {
    const entered = code.trim()
    if (entered.length < 4) { toast.error('Enter the code your league admin sent you'); return }

    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('join_competition_with_code', { p_code: entered })
      if (error) throw error

      if (!data?.ok) {
        const messages = {
          not_found: "That code didn't match any competition. Check it and try again.",
          completed: `"${data.name}" has finished, so it's not accepting new players.`,
          not_signed_in: 'Sign in first, then enter your code.',
        }
        toast.error(messages[data?.error] || 'Could not join with that code')
        return
      }

      if (data.already) {
        toast.success(`You're already in "${data.name}"`)
      } else {
        toast.success(`Joined "${data.name}"`)
      }
      setCode('')
      onJoined?.(data.competition_id)
    } catch {
      toast.error('Could not join — check your connection and try again')
    } finally { setBusy(false) }
  }

  return (
    <Card className="p-4">
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--txt-primary)' }}>Join a competition</p>
      <p className="text-xs mb-3" style={{ color: 'var(--txt-muted)' }}>
        Enter the code your league admin sent you.
      </p>
      <div className={compact ? 'flex gap-2' : 'flex gap-2 flex-wrap'}>
        <Input
          value={code}
          // Upper-cased as they type, and spaces stripped: the code gets read
          // off a WhatsApp message and people paste it with stray whitespace.
          onChange={e => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
          onKeyDown={e => e.key === 'Enter' && join()}
          placeholder="ABC123"
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: '1 1 120px', minWidth: 0, textAlign: 'center', letterSpacing: '3px', fontWeight: 600, fontSize: 16 }}
        />
        <Button variant="primary" onClick={join} disabled={busy || !code.trim()}>
          {busy ? 'Joining…' : 'Join'}
        </Button>
      </div>
    </Card>
  )
}
