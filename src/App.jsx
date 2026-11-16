import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { SelectedCompetitionProvider } from './hooks/useSelectedCompetition'
import { SportProvider } from './hooks/useSport'
import AppLayout from './components/layout/AppLayout'
import { Login, Signup } from './components/features/auth/Auth'
import Dashboard      from './components/features/dashboard/Dashboard'
import Predict        from './components/features/predict/Predict'
import NflPredict     from './components/features/nfl/NflPredict'
import NflStandings   from './components/features/nfl/NflStandings'
import NflDashboard   from './components/features/nfl/NflDashboard'
import F1Predict      from './components/features/f1/F1Predict'
import F1Standings    from './components/features/f1/F1Standings'
import F1Dashboard    from './components/features/f1/F1Dashboard'
import SportRoute     from './components/layout/SportRoute'
import LastManStanding from './components/features/lms/LastManStanding'
import { useCompetitions } from './hooks/useCompetitions'
import { useSelectedCompetition } from './hooks/useSelectedCompetition'
import { isLms }      from './lib/lms'
import Standings      from './components/features/standings/Standings'
import Admin          from './components/features/admin/Admin'
import Settings       from './components/features/settings/Settings'
import Chat           from './components/features/chat/Chat'
import Privacy        from './components/features/legal/Privacy'
import Support        from './components/features/legal/Support'
import { Spinner }    from './components/ui'
import { useState }   from 'react'
import SplashScreen    from './components/ui/SplashScreen'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'transparent' }}>
      <Spinner size="lg" />
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

/**
 * A football page, unless the competition on screen is a Last Man Standing,
 * which has its own screen in place of Dashboard, Predict and Standings (it has
 * no gameweeks, predictions or table of its own). Each page opens it on the tab
 * that matches: Dashboard and Predict on the pick, Standings on the players.
 */
function orLastManStanding(Football, tab) {
  return function FootballPage() {
    const { competitions, loading } = useCompetitions()
    const [selected] = useSelectedCompetition(competitions)
    if (loading) return null
    return isLms(competitions.find(c => c.id === selected)) ? <LastManStanding initialTab={tab} /> : <Football />
  }
}
const FootballDashboard = orLastManStanding(Dashboard, 'pick')
const FootballPredict   = orLastManStanding(Predict, 'pick')
const FootballStandings = orLastManStanding(Standings, 'players')
// An NFL Last Man Standing (Brittany, 16 Nov 2026) shows the same screens.
const NflDashboardOrLms = orLastManStanding(NflDashboard, 'pick')
const NflPredictOrLms   = orLastManStanding(NflPredict, 'pick')
const NflStandingsOrLms = orLastManStanding(NflStandings, 'players')

// Pages that each sport draws its own way.
function PredictForSport() { return <SportRoute football={FootballPredict} nfl={NflPredictOrLms} f1={F1Predict} /> }
function DashboardForSport() { return <SportRoute football={FootballDashboard} nfl={NflDashboardOrLms} f1={F1Dashboard} /> }
function StandingsForSport() { return <SportRoute football={FootballStandings} nfl={NflStandingsOrLms} f1={F1Standings} /> }

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
      <Route path="/"             element={wrap(DashboardForSport)} />
      <Route path="/predict"      element={wrap(PredictForSport)} />
      <Route path="/standings"    element={wrap(StandingsForSport)} />
      <Route path="/chat"         element={wrap(Chat)} />
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
  // The animated launch screen sits over everything until it has finished.
  //
  // It runs ALONGSIDE the app loading rather than delaying it — by the time
  // the animation ends, auth has usually resolved and the first screen is
  // ready, so the two seconds are spent rather than wasted.
  //
  // sessionStorage, so it plays once when the app is opened rather than on
  // every navigation. Wrapped because some in-app browsers block storage
  // entirely, and a splash that throws is worse than one that replays.
  const [showSplash, setShowSplash] = useState(() => {
    try { return !window.sessionStorage.getItem('aloto_splash_seen') } catch { return true }
  })

  function splashDone() {
    try { window.sessionStorage.setItem('aloto_splash_seen', '1') } catch { /* blocked */ }
    setShowSplash(false)
  }

  return (
    <AuthProvider>
      <SelectedCompetitionProvider>
        <SportProvider>
          <AppRoutes />
          {showSplash && <SplashScreen onDone={splashDone} />}
        </SportProvider>
      </SelectedCompetitionProvider>
    </AuthProvider>
  )
}
