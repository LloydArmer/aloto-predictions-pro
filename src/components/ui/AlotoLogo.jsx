/**
 * AlotoLogo — approved ALOTO Prediction Pro brand mark
 *
 * Renders entirely as inline SVG / PIL-drawn elements described
 * as React props. No external image file dependency.
 *
 * The approved logo features:
 *  - Pitch green mowed-stripe background
 *  - White goalpost frame (crossbar + two posts + net grid)
 *  - Black A, L, T letterforms evenly spaced
 *  - Middle O = Premier League inspired ball (white, royal blue band, purple chevron)
 *  - Final O  = Pitch centre circle (dark green, white ring, green markings, no arch)
 *  - "PREDICTION PRO" sub-label in white below
 */

import { useId } from 'react'

/** Full horizontal wordmark — use in headers, splash screens, docs */
export function AlotoWordmark({ width = 420, className = '' }) {
  const id  = useId().replace(/:/g, '')
  const h   = Math.round(width * 0.314)   // keep 1400:440 aspect
  const s   = width / 1400               // scale factor

  const p   = v => Math.round(v * s)     // scale helper

  // Geometry (all at 1400×440 base)
  const MG  = 40;  const PT = 42;  const PB = 298; const PW = 16
  const IL  = MG+PW+30;  const IR = 1400-MG-PW-30
  const SW  = (IR-IL)/5
  const LT  = PT+PW+28;  const LB = LT+198
  const LMY = (LT+LB)/2; const TK = 28; const R = (LB-LT)/2

  const CX  = i => IL + SW*i + SW/2

  // Letter colours
  const BLK = '#0a0a0a'
  const WHT = '#ffffff'

  // PL ball colours
  const PLB  = '#003399'   // royal blue
  const PLP  = '#581ed2'   // purple

  // Pitch circle
  const DG   = '#0e5810'   // dark grass
  const MG2  = '#50c83c'   // marking green
  const MLB  = '#8cff64'   // marking bright

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 1400 ${440}`}
      width={width}
      height={h}
      className={className}
      role="img"
      aria-label="ALOTO Prediction Pro"
    >
      <title>ALOTO Prediction Pro</title>
      <defs>
        {/* Ball clip */}
        <clipPath id={`ball-${id}`}>
          <circle cx={CX(2)} cy={LMY} r={R}/>
        </clipPath>
        {/* Rounded rect clip for whole logo */}
        <clipPath id={`bg-${id}`}>
          <rect width="1400" height="440" rx="28" ry="28"/>
        </clipPath>
      </defs>

      <g clipPath={`url(#bg-${id})`}>
        {/* ── Pitch stripes ── */}
        {Array.from({length: 20}, (_,i) => (
          <rect key={i} x={i*72} y={0} width={72} height={440}
            fill={i%2===0 ? '#228b22' : '#1c7320'}/>
        ))}

        {/* ── Net grid ── */}
        {Array.from({length: 32}, (_,i) => {
          const nx = MG+PW + i*44
          return nx < 1400-MG-PW
            ? <line key={`nv${i}`} x1={nx} y1={PT+PW} x2={nx} y2={PB} stroke="#c8e8c8" strokeWidth="1" opacity="0.55"/>
            : null
        })}
        {Array.from({length: 8}, (_,i) => {
          const ny = PT+PW+36 + i*36
          return ny < PB
            ? <line key={`nh${i}`} x1={MG+PW} y1={ny} x2={1400-MG-PW} y2={ny} stroke="#c8e8c8" strokeWidth="1" opacity="0.45"/>
            : null
        })}

        {/* ── Goalpost frame ── */}
        <rect x={MG}       y={PT} width={PW}         height={PB-PT} fill={WHT}/>
        <rect x={1400-MG-PW} y={PT} width={PW}       height={PB-PT} fill={WHT}/>
        <rect x={MG}       y={PT} width={1400-MG*2}  height={PW}    fill={WHT}/>
        <line x1={MG} y1={PB} x2={1400-MG} y2={PB} stroke="#ddeedd" strokeWidth="4"/>

        {/* ══ LETTER A ══ */}
        {(() => {
          const cx=CX(0), hw=Math.round((LB-LT)*0.43)
          const t=TK
          return <>
            <polygon points={`${cx-t/2},${LT} ${cx+t/2},${LT} ${cx-hw+t},${LB} ${cx-hw},${LB}`} fill={BLK}/>
            <polygon points={`${cx-t/2},${LT} ${cx+t/2},${LT} ${cx+hw},${LB} ${cx+hw-t},${LB}`} fill={BLK}/>
            {(() => {
              const cyc=LT+Math.round((LB-LT)*0.57)
              const xat=Math.round(hw*(LB-cyc)/(LB-LT))
              return <rect x={cx-xat+t/2} y={cyc} width={(xat-t/2)*2} height={t} fill={BLK}/>
            })()}
          </>
        })()}

        {/* ══ LETTER L ══ */}
        {(() => {
          const cx=CX(1), xl=cx-R*0.55, xr=cx+R*0.50, t=TK
          return <>
            <rect x={xl}   y={LT} width={t}       height={LB-LT} fill={BLK}/>
            <rect x={xl}   y={LB-t} width={xr-xl} height={t}     fill={BLK}/>
          </>
        })()}

        {/* ══ PREMIER LEAGUE BALL (middle O) ══ */}
        {(() => {
          const cx=CX(2), cy=LMY, r=R
          const bh=Math.round(r*0.27)
          const pw2=Math.round(r*0.26)
          const ang=Math.round(r*0.707)
          return <>
            {/* White base */}
            <circle cx={cx} cy={cy} r={r} fill="#fdfdfe"/>
            {/* Blue band — clipped to ball */}
            <rect x={cx-r} y={cy-bh} width={r*2} height={bh*2}
              fill={PLB} clipPath={`url(#ball-${id})`}/>
            {/* Purple chevron — left arm */}
            <polygon
              points={`${cx-r*0.90},${cy-r*0.65} ${cx},${cy+r*0.05-pw2/2} ${cx},${cy+r*0.05+pw2/2} ${cx-r*0.90},${cy-r*0.65+pw2}`}
              fill={PLP} clipPath={`url(#ball-${id})`}/>
            {/* Purple chevron — right arm */}
            <polygon
              points={`${cx},${cy+r*0.05-pw2/2} ${cx+r*0.90},${cy-r*0.65} ${cx+r*0.90},${cy-r*0.65+pw2} ${cx},${cy+r*0.05+pw2/2}`}
              fill={PLP} clipPath={`url(#ball-${id})`}/>
            {/* Seam lines */}
            {[[cx,cy-r,cx,cy+r],[cx-r,cy,cx+r,cy],[cx-ang,cy-ang,cx+ang,cy+ang],[cx+ang,cy-ang,cx-ang,cy+ang]].map(([x1,y1,x2,y2],i)=>(
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="#d2d7e1" strokeWidth="3" clipPath={`url(#ball-${id})`}/>
            ))}
            {/* Ball outline */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={BLK} strokeWidth="4"/>
          </>
        })()}

        {/* ══ LETTER T ══ */}
        {(() => {
          const cx=CX(3), hw=R*0.60, t=TK
          return <>
            <rect x={cx-hw}  y={LT}   width={hw*2} height={t}     fill={BLK}/>
            <rect x={cx-t/2} y={LT}   width={t}    height={LB-LT} fill={BLK}/>
          </>
        })()}

        {/* ══ PITCH CENTRE CIRCLE (final O) — NO ARCH ══ */}
        {(() => {
          const cx=CX(4), cy=LMY, r=R, ri=Math.round(r*0.52)
          return <>
            <circle cx={cx} cy={cy} r={r}  fill={DG}/>
            <circle cx={cx} cy={cy} r={ri} fill="none" stroke={MG2} strokeWidth="4"/>
            <line x1={cx-r+6} y1={cy} x2={cx+r-6} y2={cy} stroke={MG2} strokeWidth="4"/>
            <circle cx={cx} cy={cy} r={8}  fill={MLB}/>
            {/* White O ring — the letterform */}
            <circle cx={cx} cy={cy} r={r}  fill="none" stroke={WHT} strokeWidth="14"/>
          </>
        })()}

        {/* ══ PREDICTION PRO label ══ */}
        <text
          x={700} y={PB+38}
          fontFamily="'Inter','Arial',sans-serif"
          fontWeight="700"
          fontSize="26"
          letterSpacing="5"
          fill={WHT}
          textAnchor="middle"
        >PREDICTION PRO</text>

        {/* by ALOTO micro tag */}
        <text
          x={1380} y={430}
          fontFamily="'Inter','Arial',sans-serif"
          fontSize="16"
          fill="rgba(255,255,255,0.35)"
          textAnchor="end"
        >by ALOTO</text>
      </g>
    </svg>
  )
}

/** Small icon mark — goalpost + ball, for nav and favicon contexts */
export function AlotoMark({ size = 28, className = '' }) {
  const c = size / 2
  return (
    <svg width={size} height={size} viewBox="0 0 32 32"
      fill="none" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="7" fill="#228B22"/>
      <rect x="2"  y="5"  width="2.5" height="20" fill="white"/>
      <rect x="27.5" y="5" width="2.5" height="20" fill="white"/>
      <rect x="2"  y="5"  width="28" height="2.5" fill="white"/>
      <circle cx="16" cy="18" r="6.5" fill="#fdfdfe"/>
      <clipPath id="fc">
        <circle cx="16" cy="18" r="6.5"/>
      </clipPath>
      <rect x="9.5" y="15.8" width="13" height="3.5" fill="#003399" clipPath="url(#fc)"/>
      <circle cx="16" cy="18" r="6.5" fill="none" stroke="#111" strokeWidth="0.8"/>
    </svg>
  )
}

export default AlotoWordmark
