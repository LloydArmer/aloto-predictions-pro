import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { SelectedCompetitionProvider } from './hooks/useSelectedCompetition'
import AppLayout from './components/layout/AppLayout'
import { Login, Signup } from './components/features/auth/Auth'
import Dashboard      from './components/features/dashboard/Dashboard'
import Predict        from './components/features/predict/Predict'
import Standings      from './components/features/standings/Standings'
import Admin          from './components/features/admin/Admin'
import Settings       from './components/features/settings/Settings'
import Privacy        from './components/features/legal/Privacy'
import Support        from './components/features/legal/Support'
import { Spinner }    from './components/ui'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
      <Spinner size="lg" />
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

function wrap(Page) {
  return (
    <Protected>
      <AppLayout>
        <Page />
      </AppLayout>
    </Protected>
  )
}

/**
 * Has this page been opened from a password reset email?
 *
 * The link carries ?reset=1 (our own marker) and a ?code= that has to be
 * exchanged for a session before it expires. A signed-in user is normally
 * bounced away from /login — but doing that here means the Login screen never
 * mounts to perform the exchange, and signing out afterwards destroys the
 * recovery session, so the link comes back as "no longer valid" every time.
 *
 * Read from window.location rather than a router hook because this decides
 * whether the route renders at all.
 */
function isPasswordReset() {
  const search = window.location.search || ''
  const hash = window.location.hash || ''
  return search.includes('reset=1') || search.includes('code=') || hash.includes('type=recovery')
}

function AppRoutes() {
  const { user } = useAuth()
  const resetting = isPasswordReset()

  return (
    <Routes>
      {/* Public, outside the auth wrapper on purpose: Apple's reviewer opens
          these links without an account, and a policy behind a login wall is a
          rejection. */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/support" element={<Support />} />

      {/* Signed-in users go to the app — unless they're here to set a new
          password, in which case Login has to render so the reset code can be
          exchanged. */}
      <Route path="/login"  element={(user && !resetting) ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <Signup />} />
      <Route path="/"             element={wrap(Dashboard)} />
      <Route path="/predict"      element={wrap(Predict)} />
      <Route path="/standings"    element={wrap(Standings)} />
      {/* Old paths kept as redirects: they're in people's history, and the
          dashboard cards linked to them. */}
      <Route path="/table"        element={<Navigate to="/standings" replace />} />
      <Route path="/leaderboards" element={<Navigate to="/standings" replace />} />
      <Route path="/bracket"      element={<Navigate to="/standings" replace />} />
      <Route path="/admin"        element={wrap(Admin)} />
      <Route path="/settings"     element={wrap(Settings)} />
      <Route path="*"             element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><SelectedCompetitionProvider><AppRoutes /></SelectedCompetitionProvider></AuthProvider>
}
