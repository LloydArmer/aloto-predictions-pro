import { useState, useEffect, useMemo } from 'react'

/* ── Timings ──────────────────────────────────────────────────────────────
   BURST   when the ball pops and the confetti launches.
   HOLD    how long the finished logo sits still. THE READING TIME.
   FADE    the fade out.

   Total = BURST + HOLD + FADE, currently 4.7 seconds.
   Change HOLD if it feels rushed or drags — it is the only number that
   normally needs touching.
   ─────────────────────────────────────────────────────────────────────── */
const BURST = 1100
const HOLD  = 2900
const FADE  = 700

/** Club-scarf colours. Deliberately not just the app's purple — confetti in a
 *  single colour reads as a loading spinner rather than a celebration. */
const CONFETTI_COLOURS = [
  '#ffffff', '#f4d03f', '#e63946', '#48b7e8',
  '#2a9d4a', '#f4a72c', '#b07de0', '#ffffff',
]

/**
 * The animated launch screen.
 *
 * iOS's own launch screen is a static image and cannot be animated — what
 * looks like an animated splash elsewhere is a screen the app draws for itself
 * once it has started. This is that screen.
 *
 * The sequence: the ball breathes, bursts into confetti and scarves, and the
 * full wordmark is revealed behind it — goal frame, net, ALOTO with the ball
 * as its first O, PREDICTION PRO beneath.
 *
 * Everything is CSS and one PNG. No canvas, no animation library, nothing to
 * fetch — a splash that waits for a dependency defeats its own purpose.
 */
export default function SplashScreen({ onDone }) {
  // pulse — ball breathing alone, centred
  // burst — confetti flies, wordmark is revealed
  // out   — everything fades
  // gone  — unmounted
  const [phase, setPhase] = useState('pulse')

  // Generated once on mount. Regenerating each render would make the confetti
  // twitch as React re-renders mid-flight.
  const pieces = useMemo(() => {
    const out = []
    for (let i = 0; i < 46; i++) {
      // Spread around the circle with a little jitter, so it reads as a burst
      // rather than a starburst diagram.
      const angle = (i / 46) * Math.PI * 2 + (Math.random() - 0.5) * 0.35
      const distance = 140 + Math.random() * 200
      out.push({
        id: i,
        x: Math.cos(angle) * distance,
        // Biased downward at the end of flight, so gravity is implied without
        // simulating it.
        y: Math.sin(angle) * distance + 70 + Math.random() * 100,
        rotate: (Math.random() - 0.5) * 900,
        colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
        // A few long thin pieces among the squares — those read as scarves.
        scarf: i % 7 === 0,
        delay: Math.random() * 90,
        duration: 1000 + Math.random() * 700,
      })
    }
    return out
  }, [])

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('burst'), BURST),
      setTimeout(() => setPhase('out'), BURST + HOLD),
      setTimeout(() => { setPhase('gone'); onDone?.() }, BURST + HOLD + FADE),
    ]
    return () => timers.forEach(clearTimeout)
  }, [onDone])

  if (phase === 'gone') return null

  const burst = phase === 'burst' || phase === 'out'

  return (
    <div
      // aria-hidden: a screen reader announcing a decorative splash before the
      // app has loaded is noise, not information.
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        background: 'linear-gradient(160deg, #7438b2 0%, #3a1a68 100%)',
        opacity: phase === 'out' ? 0 : 1,
        transition: `opacity ${FADE}ms ease-out`,
        pointerEvents: phase === 'out' ? 'none' : 'auto',
      }}
    >
      <style>{`
        @keyframes aloto-breathe {
          0%, 100% { transform: scale(0.94); }
          50%      { transform: scale(1.06); }
        }
        /* One keyframe for all the confetti. Each piece sets its destination in
           CSS variables, so the browser animates them on the compositor rather
           than React re-rendering forty-six elements mid-flight. */
        @keyframes aloto-burst {
          0%   { transform: translate(-50%, -50%) rotate(0deg) scale(1); opacity: 1; }
          70%  { opacity: 1; }
          100% {
            transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty)))
                       rotate(var(--rot)) scale(0.85);
            opacity: 0;
          }
        }
      `}</style>

      {/* ---- Confetti ----
          Rendered from the start at zero opacity so the browser has already
          laid them out; creating forty-six elements at the instant of the
          burst is what makes this sort of animation stutter. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {pieces.map(p => (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              left: '50%', top: '47%',
              width: p.scarf ? 5 : 8,
              height: p.scarf ? 26 : 8,
              borderRadius: p.scarf ? 2 : 1,
              background: p.colour,
              opacity: 0,
              transform: 'translate(-50%, -50%)',
              '--tx': `${p.x}px`,
              '--ty': `${p.y}px`,
              '--rot': `${p.rotate}deg`,
              animation: burst
                ? `aloto-burst ${p.duration}ms cubic-bezier(0.12, 0.7, 0.3, 1) ${p.delay}ms forwards`
                : 'none',
            }}
          />
        ))}
      </div>

      {/* ---- The ball, before the burst ----
          Sits alone in the centre, breathing. It expands and fades at the
          burst, handing over to the wordmark behind it. */}
      {!burst && (
        <img
          src="/splash-ball.png"
          alt=""
          style={{
            position: 'absolute',
            width: '44vw', maxWidth: 260,
            animation: 'aloto-breathe 620ms ease-in-out infinite',
          }}
        />
      )}

      {/* ---- The wordmark, revealed by the burst ---- */}
      <div style={{
        textAlign: 'center',
        opacity: burst ? 1 : 0,
        transform: burst ? 'scale(1)' : 'scale(0.88)',
        transition: 'opacity 520ms ease-out 150ms, transform 700ms cubic-bezier(0.18, 1.15, 0.35, 1) 150ms',
      }}>
        <div style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'clamp(6px, 2.4vw, 18px)',
          padding: 'clamp(22px, 7vw, 40px) clamp(16px, 5vw, 34px)',
          // Three sides only — a goal has no bottom bar.
          borderTop: '4px solid #fff',
          borderLeft: '4px solid #fff',
          borderRight: '4px solid #fff',
          borderRadius: '3px 3px 0 0',
        }}>
          {/* The net: two crossing gradients rather than an image, so it
              scales to any screen and needs nothing to load. */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background:
              'repeating-linear-gradient(45deg, transparent 0 15px, rgba(255,255,255,0.20) 15px 16px),'
              + 'repeating-linear-gradient(-45deg, transparent 0 15px, rgba(255,255,255,0.20) 15px 16px)',
          }}/>

          <span style={LETTER}>A</span>
          <span style={LETTER}>L</span>

          {/* The ball stands in for the first O. Sized to the cap height of
              the letters rather than to itself — a circle set to the same
              nominal size as a letter reads as larger, so it takes the letter
              size and no more. */}
          <img src="/splash-ball.png" alt="" style={{
            width: O_SIZE, height: O_SIZE, display: 'block',
          }}/>

          <span style={LETTER}>T</span>

          {/* And a pitch for the second, as on the logo. Same size as the ball
              so the two O's match each other as well as the letters. */}
          <svg viewBox="0 0 100 100" style={{
            width: O_SIZE, height: O_SIZE, display: 'block',
          }}>
            <circle cx="50" cy="50" r="48" fill="#1f7a34"/>
            <g fill="none" stroke="#fff" strokeWidth="2.6" opacity="0.95">
              <circle cx="50" cy="50" r="48"/>
              <line x1="50" y1="2" x2="50" y2="98"/>
              <circle cx="50" cy="50" r="15"/>
              <rect x="2" y="30" width="14" height="40"/>
              <rect x="84" y="30" width="14" height="40"/>
            </g>
            <circle cx="50" cy="50" r="3" fill="#fff"/>
          </svg>
        </div>

        <p style={{
          margin: 'clamp(12px, 4vw, 20px) 0 0',
          fontSize: 'clamp(17px, 6.2vw, 34px)',
          fontWeight: 800,
          letterSpacing: '0.06em',
          color: '#fff',
        }}>
          PREDICTION PRO
        </p>
      </div>

      {/* ---- The credit ----
          Last to arrive, faintest of everything. If a sponsor ever backs the
          league, this is the line that changes. */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(9% + env(safe-area-inset-bottom, 0px))',
        textAlign: 'center',
        opacity: burst ? 1 : 0,
        transition: 'opacity 500ms ease-out 700ms',
      }}>
        <p style={{
          margin: 0, fontSize: 9, letterSpacing: '0.26em',
          textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', fontWeight: 500,
        }}>
          Presented by
        </p>
        <p style={{
          margin: '5px 0 0', fontSize: 19, letterSpacing: '0.04em',
          color: 'rgba(255,255,255,0.9)', fontWeight: 600,
        }}>
          ALOTO
        </p>
        <div style={{
          width: 62, height: 1.5, margin: '9px auto 0',
          background: 'rgba(255,255,255,0.55)',
        }}/>
      </div>
    </div>
  )
}

const LETTER_SIZE = 'clamp(42px, 16.5vw, 92px)'

/* The two O's are drawn, not typed, so they need an explicit size.
   0.78 of the letter size matches the cap height of the font — a capital A is
   not as tall as its nominal point size, and matching the nominal size makes
   the round shapes sit visibly proud of the letters beside them. */
const O_SIZE = 'clamp(33px, 12.9vw, 72px)'

const LETTER = {
  fontSize: LETTER_SIZE,
  fontWeight: 800,
  color: '#fff',
  lineHeight: 1,
}
