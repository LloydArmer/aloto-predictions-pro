import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { Button, Input } from '../../ui'
import toast from 'react-hot-toast'

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}>
      <div className="mb-8 flex flex-col items-center gap-4">
        <img src="/logo.png" alt="ALOTO Prediction Pro" style={{ width: 300, maxWidth: '100%', height: 'auto' }} />
        <p className="text-sm" style={{ color: 'var(--txt-second)' }}>{subtitle}</p>
      </div>
      <div className="w-full max-w-sm rounded-xl p-6"
        style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-med)' }}>
        <h1 className="text-base font-medium mb-5" style={{ color: 'var(--txt-primary)' }}>{title}</h1>
        {children}
      </div>
      <p className="text-xs mt-5" style={{ color: 'var(--txt-muted)' }}>
        ALOTO Prediction Pro · Built by ALOTO
      </p>
    </div>
  )
}

/**
 * Sign in, forgotten password, and setting a new one — all on this screen.
 *
 * Three modes rather than three routes. Supabase's reset email sends the player
 * back with a recovery token in the URL, and handling it here means no new
 * route to register, no redirect URL to keep in step across two environments,
 * and no chance of the link landing somewhere that doesn't know what to do with
 * it.
 */
export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState('signin')   // 'signin' | 'forgot' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  // Detecting that the player has arrived from a reset email.
  //
  // Three ways, because none is reliable alone:
  //
  //   1. ?reset=1 — our own marker, added to redirectTo below. The only one
  //      fully under our control, so it's the one that actually works.
  //   2. #type=recovery — the older implicit flow. Supabase now uses PKCE and
  //      sends ?code=... in the query string instead, so this was missing it
  //      entirely and the player landed on an ordinary sign-in screen.
  //   3. The PASSWORD_RECOVERY event — correct when it fires, but it can fire
  //      before this component mounts, in which case the listener never hears
  //      it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const hash = window.location.hash || ''

    if (params.get('reset') === '1' || hash.includes('type=recovery')) {
      setMode('reset')
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('reset')
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  async function handleSignIn(e) {
    e.preventDefault()
    if (!email || !password) { toast.error('Enter email and password'); return }
    setLoading(true)
    try { await signIn(email, password); navigate('/') }
    catch (err) { toast.error(err.message || 'Sign in failed') }
    finally { setLoading(false) }
  }

  async function handleForgot(e) {
    e.preventDefault()
    if (!email) { toast.error('Enter your email address'); return }
    setLoading(true)
    try {
      // ?reset=1 is our own marker. Supabase's own indicators differ between
      // the implicit and PKCE flows and can be reformatted or dropped; this one
      // is ours and survives.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login?reset=1`,
      })
      if (error) throw error

      // Deliberately says "if there's an account" rather than confirming one
      // exists. Confirming it would let anyone check whether a given address is
      // registered.
      setSent(true)
    } catch (err) {
      toast.error(err.message || 'Could not send the reset email')
    } finally { setLoading(false) }
  }

  async function handleReset(e) {
    e.preventDefault()
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return }
    if (password !== confirm) { toast.error('The two passwords don\'t match'); return }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      toast.success('Password updated')
      // Clears the marker and any token out of the address bar, so a refresh
      // or a shared link doesn't reopen the reset form.
      window.history.replaceState(null, '', '/login')
      navigate('/')
    } catch (err) {
      toast.error(err.message || 'Could not update the password')
    } finally { setLoading(false) }
  }

  /* ---- Set a new password ---- */
  if (mode === 'reset') {
    return (
      <AuthShell title="Set a new password" subtitle="Almost there">
        <form onSubmit={handleReset}>
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>New password</label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Min 6 characters" autoComplete="new-password" required />
          </div>
          <div className="mb-5">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Confirm password</label>
            <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Type it again" autoComplete="new-password" required />
          </div>
          <Button variant="primary" className="w-full justify-center" type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Save and sign in'}
          </Button>
        </form>
      </AuthShell>
    )
  }

  /* ---- Forgotten password ---- */
  if (mode === 'forgot') {
    return (
      <AuthShell title="Reset your password" subtitle="We'll email you a link">
        {sent ? (
          <>
            <p className="text-sm mb-4" style={{ color: 'var(--txt-second)', lineHeight: 1.55 }}>
              If there's an account for <strong style={{ color: 'var(--txt-primary)' }}>{email}</strong>,
              a reset link is on its way. It's worth checking your spam folder.
            </p>
            <Button className="w-full justify-center"
              onClick={() => { setMode('signin'); setSent(false) }}>
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm mb-4" style={{ color: 'var(--txt-second)', lineHeight: 1.55 }}>
              Enter the email address you signed up with and we'll send you a link to set a new
              password.
            </p>
            <form onSubmit={handleForgot}>
              <div className="mb-5">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Email</label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email" required />
              </div>
              <Button variant="primary" className="w-full justify-center" type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
            <p className="text-xs text-center mt-4" style={{ color: 'var(--txt-muted)' }}>
              <button onClick={() => setMode('signin')} style={{ color: 'var(--accent)' }}>
                Back to sign in
              </button>
            </p>
          </>
        )}
      </AuthShell>
    )
  }

  /* ---- Sign in ---- */
  return (
    <AuthShell title="Sign in" subtitle="Score predictions · League tables · Leaderboards">
      <form onSubmit={handleSignIn}>
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Email</label>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </div>
        <div className="mb-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Password</label>
          <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
        </div>

        {/* Under the password field, where someone looks the moment they can't
            remember it. */}
        <p className="text-xs mb-5 text-right">
          <button type="button" onClick={() => setMode('forgot')} style={{ color: 'var(--accent)' }}>
            Forgotten your password?
          </button>
        </p>

        <Button variant="primary" className="w-full justify-center" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="text-xs text-center mt-4" style={{ color: 'var(--txt-muted)' }}>
        No account? <Link to="/signup" style={{ color: 'var(--accent)' }}>Create one</Link>
      </p>
    </AuthShell>
  )
}

export function Signup() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name || !email || !password) { toast.error('Fill in all fields'); return }
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return }
    setLoading(true)
    try {
      await signUp(email, password, name)
      toast.success('Account created! Check your email to confirm.')
      navigate('/login')
    } catch (err) { toast.error(err.message || 'Sign up failed') }
    finally { setLoading(false) }
  }

  return (
    <AuthShell title="Create account" subtitle="Join your predictions league">
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Display name</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jamie K" required />
        </div>
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Email</label>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </div>
        <div className="mb-5">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Password</label>
          <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters" autoComplete="new-password" required />
        </div>
        <Button variant="primary" className="w-full justify-center" type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="text-xs text-center mt-4" style={{ color: 'var(--txt-muted)' }}>
        Already have an account? <Link to="/login" style={{ color: 'var(--accent)' }}>Sign in</Link>
      </p>
    </AuthShell>
  )
}
