import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { Button, Input } from '../../ui'
import toast from 'react-hot-toast'

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}>
      <div className="mb-8 flex flex-col items-center gap-4">
        <img src="/logo.png" alt="ALOTO Prediction Pro" width={300} style={{ height: 'auto' }} />
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

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) { toast.error('Enter email and password'); return }
    setLoading(true)
    try { await signIn(email, password); navigate('/') }
    catch (err) { toast.error(err.message || 'Sign in failed') }
    finally { setLoading(false) }
  }

  return (
    <AuthShell title="Sign in" subtitle="Score predictions · League tables · Leaderboards">
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Email</label>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </div>
        <div className="mb-5">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-muted)' }}>Password</label>
          <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
        </div>
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
