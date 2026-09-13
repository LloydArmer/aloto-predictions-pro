import { useState, useEffect } from 'react'

/**
 * The animated launch screen.
 *
 * iOS's own launch screen is a static image and cannot be animated — what
 * looks like an animated splash in other apps is a screen the app draws itself
 * once it has started. This is that screen.
 *
 * The sequence is deliberately short. A splash is a held moment while the app
 * gets ready, not a title sequence; anything past about a second and a half
 * starts to feel like being made to wait.
 *
 * It covers everything until it fades, so nothing half-loaded shows through.
 */
export default function SplashScreen({ onDone }) {
  // in      — the ball grows and fades up
  // hold    — settled, the wordmark appears
  // out     — the whole screen fades away
  // gone    — unmounted
  const [phase, setPhase] = useState('in')

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('hold'), 620),
      setTimeout(() => setPhase('out'), 1500),
      setTimeout(() => { setPhase('gone'); onDone?.() }, 1950),
    ]
    return () => timers.forEach(clearTimeout)
  }, [onDone])

  if (phase === 'gone') return null

  return (
    <div
      // aria-hidden because a screen reader announcing a decorative splash
      // before the app has loaded is noise, not information.
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        // The same purple as the icon and the static splash, so the three
        // stages of launching the app look like one continuous thing.
        background: 'linear-gradient(160deg, #7438b2 0%, #3a1a68 100%)',
        opacity: phase === 'out' ? 0 : 1,
        transition: 'opacity 450ms ease-out',
        // Stops a tap during the fade reaching whatever is underneath.
        pointerEvents: phase === 'out' ? 'none' : 'auto',
      }}
    >
      <img
        // The bare ball on a transparent background, NOT the app icon. The
        // icon carries its own purple square, which showed through as a disc
        // behind the ball and made it look like a badge stuck on the screen
        // rather than the ball sitting on the gradient.
        src="/splash-ball.png"
        alt=""
        style={{
          width: '44vw', maxWidth: 260,
          // Slightly overshoots then settles — a straight linear grow looks
          // mechanical, this reads as the app arriving.
          transform: phase === 'in' ? 'scale(0.82)' : 'scale(1)',
          opacity: phase === 'in' ? 0 : 1,
          transition: 'transform 700ms cubic-bezier(0.18, 1.2, 0.35, 1), opacity 500ms ease-out',
          filter: 'drop-shadow(0 14px 44px rgba(0,0,0,0.32))',
        }}
      />

      <p style={{
        marginTop: 26,
        fontSize: 13,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.82)',
        fontWeight: 600,
        // Arrives after the ball has settled rather than with it — two things
        // moving at once reads as busy.
        opacity: phase === 'in' ? 0 : 1,
        transform: phase === 'in' ? 'translateY(8px)' : 'translateY(0)',
        transition: 'opacity 400ms ease-out 180ms, transform 400ms ease-out 180ms',
      }}>
        ALOTO Prediction Pro
      </p>

      {/* The credit line, sat near the bottom rather than under the title —
          the same placement ESPN uses for a sponsor. Last to arrive, faintest
          of the three, so the eye reaches it only after the name.

          If a sponsor ever backs the league, this is the line that changes. */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(9% + env(safe-area-inset-bottom, 0px))',
        textAlign: 'center',
        opacity: phase === 'in' ? 0 : 1,
        transition: 'opacity 500ms ease-out 420ms',
      }}>
        <p style={{
          margin: 0,
          fontSize: 9,
          letterSpacing: '0.26em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.45)',
          fontWeight: 500,
        }}>
          Presented by
        </p>
        <p style={{
          margin: '5px 0 0',
          fontSize: 19,
          letterSpacing: '0.04em',
          color: 'rgba(255,255,255,0.9)',
          fontWeight: 600,
        }}>
          ALOTO
        </p>
        {/* The rule under the name, as on the reference. Drawn rather than a
            border so its width is independent of the text. */}
        <div style={{
          width: 62, height: 1.5, margin: '9px auto 0',
          background: 'rgba(255,255,255,0.55)',
        }}/>
      </div>
    </div>
  )
}
