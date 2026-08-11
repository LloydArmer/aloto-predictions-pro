import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import AppLayout from './components/layout/AppLayout'
import { Login, Signup } from './components/features/auth/Auth'
import Dashboard      from './components/features/dashboard/Dashboard'
import Predict        from './components/features/predict/Predict'
import Table          from './components/features/table/Table'
import Bracket        from './components/features/bracket/Bracket'
import Admin          from './components/features/admin/Admin'
import Settings       from './components/features/settings/Settings'
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

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login"  element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <Signup />} />
      <Route path="/"             element={wrap(Dashboard)} />
      <Route path="/predict"      element={wrap(Predict)} />
      <Route path="/table"        element={wrap(Table)} />
      <Route path="/leaderboards" element={<Navigate to="/table" replace />} />
      <Route path="/bracket"      element={wrap(Bracket)} />
      <Route path="/admin"        element={wrap(Admin)} />
      <Route path="/settings"     element={wrap(Settings)} />
      <Route path="*"             element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>
}
