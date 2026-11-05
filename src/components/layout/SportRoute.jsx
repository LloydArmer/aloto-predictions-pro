import { useCompetitions } from '../../hooks/useCompetitions'

/**
 * Shows the screen for the sport the app is on.
 *
 *   <SportRoute football={Predict} nfl={NflPredict} />
 *
 * A sport without its own screen for this page gets football's. Nothing is
 * drawn until the competitions have loaded, so an NFL player never sees the
 * football screen flash up first.
 */
export default function SportRoute(screens) {
  const { activeSport, loading } = useCompetitions()
  if (loading) return null
  const Screen = screens[activeSport] || screens.football
  return <Screen />
}
