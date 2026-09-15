import { useState, useEffect, useMemo } from 'react'

/* ── Timings ──────────────────────────────────────────────────────────────
   PULSE    the ball breathing in and out before the burst.
   BURST    the moment confetti launches and the ball pops.
   HOLD     how long the finished screen sits still. THE READING TIME.
   FADE     the fade out.

   Total = BURST + HOLD + FADE, currently 4.2 seconds.
   Change HOLD if it feels rushed or drags. It is the only number that
   normally needs touching.
   ─────────────────────────────────────────────────────────────────────── */
const BURST = 1100
const HOLD  = 2400
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
 * The sequence: the ball breathes twice, then bursts, throwing confetti and
 * scarves outward while the name appears. A football app opening should feel
 * like the moment a goal goes in, not like a progress bar.
 *
 * Everything is CSS. No canvas, no animation library, nothing to load — a
 * splash that waits for a dependency defeats its own purpose.
 */
export default function SplashScreen({ onDone }) {
  // pulse  — ball breathing, nothing else on screen
  // burst  — ball pops, confetti launches, text arrives
  // out    — everything fades
  // gone   — unmounted
  const [phase, setPhase] = useState('pulse')

  // Generated once, on mount. Regenerating on each render would make the
  // confetti twitch as React re-renders mid-flight.
  const pieces = useMemo(() => {
    const out = []
    for (let i = 0; i < 44; i++) {
      // Spread evenly around the circle with a little jitter, so it reads as a
      // burst rather than a starburst diagram.
      const angle = (i / 44) * Math.PI * 2 + (Math.random() - 0.5) * 0.35
      const distance = 130 + Math.random() * 190

      out.push({
        id: i,
        x: Math.cos(angle) * distance,
        // Biased downward at the end of flight, so gravity is implied without
        // simulating it.
        y: Math.sin(angle) * distance + 60 + Math.random() * 90,
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
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
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
        /* One keyframe for all 44 pieces. Each sets its own destination in CSS
           variables, so the browser animates them on the compositor rather
           than React re-rendering forty-four elements mid-flight. */
        @keyframes aloto-burst {
          0% {
            transform: translate(-50%, -50%) rotate(0deg) scale(1);
            opacity: 1;
          }
          70% { opacity: 1; }
          100% {
            transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty)))
                       rotate(var(--rot)) scale(0.85);
            opacity: 0;
          }
        }
      `}</style>

      {/* ---- The confetti ----
          Absolutely positioned at the centre and thrown outward. Rendered even
          before the burst, at zero opacity, so the browser has already laid
          them out — creating 44 elements at the exact moment of the burst is
          what makes this sort of animation stutter. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {pieces.map(p => (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              left: '50%', top: '46%',
              width: p.scarf ? 5 : 8,
              height: p.scarf ? 26 : 8,
              borderRadius: p.scarf ? 2 : 1,
              background: p.colour,
              // Invisible until the burst. The keyframe sets opacity itself.
              opacity: 0,
              transform: 'translate(-50%, -50%)',
              // Each piece's destination, read by the shared keyframe above.
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

      {/* ---- The ball ----
          Breathes, then expands and fades at the burst, as though it has
          scattered into the confetti. */}
      <img
        src="/splash-ball.png"
        alt=""
        style={{
          width: '44vw', maxWidth: 260,
          transform: burst ? 'scale(1.55)' : 'scale(1)',
          opacity: burst ? 0 : 1,
          animation: burst ? 'none' : 'aloto-breathe 620ms ease-in-out infinite',
          transition: burst
            ? 'transform 620ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 480ms ease-out'
            : 'none',
        }}
      />

      {/* ---- The name ----
          Arrives as the ball goes, so the burst hands over to it. */}
      <p style={{
        marginTop: 26,
        fontSize: 15,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: '#ffffff',
        fontWeight: 700,
        textAlign: 'center',
        opacity: burst ? 1 : 0,
        transform: burst ? 'scale(1)' : 'scale(0.9)',
        transition: 'opacity 520ms ease-out 240ms, transform 620ms cubic-bezier(0.18, 1.2, 0.35, 1) 240ms',
      }}>
        ALOTO Prediction Pro
      </p>

      {/* ---- The credit ---- */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(9% + env(safe-area-inset-bottom, 0px))',
        textAlign: 'center',
        opacity: burst ? 1 : 0,
        transition: 'opacity 500ms ease-out 620ms',
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
